// Supabase Edge Function „calendar-feed“: liest einen abonnierten Kalender und gibt die Termine eines Zeitraums
// zurück – für die Zeitleiste „Dein Tag“ auf der Startseite (js/calendars.js).
//
// Quelle ist der Link „Öffentlicher Kalender“ aus der Apple-Kalender-App (webcal://…icloud.com/published/…), oder
// jede andere Kalender-Datei im .ics-Format (z. B. die geheime iCal-Adresse von Google). Der Browser darf fremde
// Seiten nicht selbst abrufen – darum diese Funktion.
//
//   POST { url, from: 'JJJJ-MM-TT', to: 'JJJJ-MM-TT' }  (mit Haushalt-Schlüssel und Zugangscode)
//   → { name, events: [{ title, location, allDay, start, end }] }
//     start/end: ganztägig 'JJJJ-MM-TT' (end = Tag danach), sonst Zeitpunkt in UTC (ISO)
//
// Wiederholungen (RRULE: täglich, wöchentlich, monatlich, jährlich mit INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY,
// BYMONTH, BYSETPOS), Ausnahmen (EXDATE), geänderte Einzeltermine (RECURRENCE-ID) und Zeitzonen (TZID) werden
// berücksichtigt. Speichert und protokolliert nichts. Einrichtung: ANLEITUNG.md, „Kalender auf der Startseite“
// (JWT-Prüfung aus). Bewusst eine einzige Datei in reinem JavaScript (gültiges TypeScript) zum Einfügen im Dashboard;
// eventsInRange() hat keine Abhängigkeiten und lässt sich im Browser testen.

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const MAX_SPAN_DAYS = 31;
const MAX_EVENTS = 300;
const DEFAULT_TZ = 'Europe/Zurich';

// ---------- Zeit ----------

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const DAY_MS = 86400000;

// Datum rechnen ohne Zeitzonen: Tage als UTC-Mitternacht
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / DAY_MS;
function fromDayNum(n) {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = So
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const tzOk = new Map();
function validTz(tz) {
  if (!tz) return DEFAULT_TZ;
  if (!tzOk.has(tz)) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); tzOk.set(tz, true); } catch { tzOk.set(tz, false); }
  }
  return tzOk.get(tz) ? tz : DEFAULT_TZ; // z. B. Windows-Namen von Outlook: dann Schweizer Zeit annehmen
}

const fmtCache = new Map();
function tzOffset(ms, tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  }
  const p = Object.fromEntries(fmtCache.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

// Uhrzeit an einem Ort → Zeitpunkt (UTC-Millisekunden), Sommer-/Winterzeit richtig
function zonedToUtc(y, m, d, h, mi, s, tz) {
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  let utc = wall - tzOffset(wall, tz);
  utc = wall - tzOffset(utc, tz);
  return utc;
}

// ---------- ICS lesen ----------

function unescapeText(v) {
  return String(v || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

// „20261026T173000“ mit TZID, „…Z“ (UTC), „20261026“ (ganztägig)
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (!m[4] || params.VALUE === 'DATE') return { allDay: true, y, m: mo, d };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] || 0)];
  const tz = m[7] ? 'UTC' : validTz(params.TZID);
  return { allDay: false, y, m: mo, d, h, mi, s, tz };
}

function toUtc(t) {
  return t.tz === 'UTC' ? Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi, t.s) : zonedToUtc(t.y, t.m, t.d, t.h, t.mi, t.s, t.tz);
}

// Schlüssel eines Vorkommens (für EXDATE und RECURRENCE-ID): ganztägig das Datum, sonst der Zeitpunkt
const occKey = (t) => (t.allDay ? dateStr(t.y, t.m, t.d) : String(toUtc(t)));

// „P1D“, „PT1H30M“, „P1W“ → Millisekunden
function duration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60000 + +(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

export function parseCalendar(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let name = '';
  let ev = null;
  let depth = 0; // VALARM u. Ä. innerhalb eines Termins überspringen
  for (const line of lines) {
    if (line.startsWith('BEGIN:')) {
      if (line === 'BEGIN:VEVENT') { ev = { exdates: new Set() }; depth = 0; } else if (ev) depth += 1;
      continue;
    }
    if (line.startsWith('END:')) {
      if (line === 'END:VEVENT' && ev) { if (ev.start) events.push(ev); ev = null; } else if (ev) depth -= 1;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [rawName, ...rawParams] = line.slice(0, colon).split(';');
    const key = rawName.toUpperCase();
    const value = line.slice(colon + 1);
    if (!ev) {
      if (key === 'X-WR-CALNAME') name = unescapeText(value).slice(0, 60);
      continue;
    }
    if (depth > 0) continue;
    const params = Object.fromEntries(rawParams.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, '')]; }));
    if (key === 'SUMMARY') ev.title = unescapeText(value).slice(0, 120);
    else if (key === 'LOCATION') ev.location = unescapeText(value).slice(0, 120);
    else if (key === 'UID') ev.uid = value.trim();
    else if (key === 'STATUS') ev.status = value.trim().toUpperCase();
    else if (key === 'DTSTART') ev.start = parseDate(value, params);
    else if (key === 'DTEND') ev.end = parseDate(value, params);
    else if (key === 'DURATION') ev.duration = duration(value);
    else if (key === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    else if (key === 'EXDATE') for (const v of value.split(',')) { const t = parseDate(v, params); if (t) ev.exdates.add(occKey(t)); }
    else if (key === 'RECURRENCE-ID') ev.recurrenceId = parseDate(value, params);
  }
  return { name, events };
}

// ---------- Wiederholungen ----------

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const list = (v) => String(v || '').split(',').filter(Boolean);

// „2MO“ → { n: 2, wd: 1 }; „MO“ → { n: 0, wd: 1 }
const byDay = (v) => list(v).map((x) => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.toUpperCase()); return m && m[2] in WD ? { n: +(m[1] || 0), wd: WD[m[2]] } : null; }).filter(Boolean);

// Tage eines Monats nach BYDAY (mit/ohne Nummer) bzw. BYMONTHDAY
function daysInMonthBy(y, m, rule, startDay) {
  const dim = daysInMonth(y, m);
  let days;
  const bd = byDay(rule.BYDAY);
  if (bd.length) {
    days = [];
    for (const { n, wd } of bd) {
      const all = [];
      for (let d = 1; d <= dim; d++) if (weekday(y, m, d) === wd) all.push(d);
      if (!n) days.push(...all);
      else { const pick = n > 0 ? all[n - 1] : all[all.length + n]; if (pick) days.push(pick); }
    }
  } else if (rule.BYMONTHDAY) {
    days = list(rule.BYMONTHDAY).map(Number).map((x) => (x < 0 ? dim + 1 + x : x)).filter((x) => x >= 1 && x <= dim);
  } else {
    days = startDay <= dim ? [startDay] : [];
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.BYSETPOS) {
    const pos = list(rule.BYSETPOS).map(Number);
    days = pos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter(Boolean).sort((a, b) => a - b);
  }
  return days;
}

// Alle Starttage (Datum vor Ort) einer Serie bis zum Tag lastDay – in Reihenfolge
function* seriesDates(s, rule, lastDay) {
  const freq = String(rule.FREQ || '').toUpperCase();
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const first = dayNum(s.y, s.m, s.d);
  const filterWd = byDay(rule.BYDAY).map((x) => x.wd);
  const months = list(rule.BYMONTH).map(Number);
  let guard = 0;
  if (freq === 'DAILY') {
    for (let n = first; n <= lastDay && guard++ < 40000; n += interval) {
      const t = fromDayNum(n);
      if (filterWd.length && !filterWd.includes(weekday(t.y, t.m, t.d))) continue;
      if (months.length && !months.includes(t.m)) continue;
      yield t;
    }
  } else if (freq === 'WEEKLY') {
    const wkst = WD[String(rule.WKST || 'MO').toUpperCase()] ?? 1;
    const startWd = weekday(s.y, s.m, s.d);
    const weekStart = first - ((startWd - wkst + 7) % 7);
    const days = (filterWd.length ? filterWd : [startWd]).map((wd) => (wd - wkst + 7) % 7).sort((a, b) => a - b);
    for (let w = weekStart; w <= lastDay && guard++ < 10000; w += 7 * interval) {
      for (const off of days) {
        const n = w + off;
        if (n < first || n > lastDay) continue;
        yield fromDayNum(n);
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; guard++ < 3000; i += interval) {
      const mm = s.m - 1 + i;
      const y = s.y + Math.floor(mm / 12);
      const m = (mm % 12) + 1;
      if (dayNum(y, m, 1) > lastDay) return;
      if (months.length && !months.includes(m)) continue;
      for (const d of daysInMonthBy(y, m, rule, s.d)) {
        const n = dayNum(y, m, d);
        if (n >= first && n <= lastDay) yield { y, m, d };
      }
    }
  } else if (freq === 'YEARLY') {
    for (let y = s.y; guard++ < 300; y += interval) {
      if (dayNum(y, 1, 1) > lastDay) return;
      for (const m of months.length ? months : [s.m]) {
        const r = rule.BYDAY || rule.BYMONTHDAY ? rule : {};
        for (const d of daysInMonthBy(y, m, r, s.d)) {
          const n = dayNum(y, m, d);
          if (n >= first && n <= lastDay) yield { y, m, d };
        }
      }
    }
  } else {
    yield { y: s.y, m: s.m, d: s.d };
  }
}

// ---------- Termine eines Zeitraums ----------

function endOf(ev, startUtcOrDay) {
  if (ev.start.allDay) {
    if (ev.end?.allDay) return startUtcOrDay + (dayNum(ev.end.y, ev.end.m, ev.end.d) - dayNum(ev.start.y, ev.start.m, ev.start.d));
    if (ev.duration != null) return startUtcOrDay + Math.max(1, Math.round(ev.duration / DAY_MS));
    return startUtcOrDay + 1;
  }
  if (ev.end && !ev.end.allDay) return startUtcOrDay + (toUtc(ev.end) - toUtc(ev.start));
  if (ev.duration != null) return startUtcOrDay + ev.duration;
  return startUtcOrDay;
}

// from/to: 'JJJJ-MM-TT' (beide Tage eingeschlossen), Schweizer Zeit
export function eventsInRange(parsed, from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const firstDay = dayNum(fy, fm, fd);
  const lastDay = dayNum(ty, tm, td);
  const winStart = zonedToUtc(fy, fm, fd, 0, 0, 0, DEFAULT_TZ);
  const after = fromDayNum(lastDay + 1);
  const winEnd = zonedToUtc(after.y, after.m, after.d, 0, 0, 0, DEFAULT_TZ);
  const out = [];
  const push = (ev, t) => {
    if (ev.start.allDay) {
      const s = dayNum(t.y, t.m, t.d);
      const e = endOf(ev, s);
      if (s <= lastDay && e > firstDay) {
        const ed = fromDayNum(e);
        out.push({ title: ev.title || 'Termin', location: ev.location || '', allDay: true, start: dateStr(t.y, t.m, t.d), end: dateStr(ed.y, ed.m, ed.d) });
      }
      return;
    }
    const s = toUtc({ ...ev.start, y: t.y, m: t.m, d: t.d });
    const e = Math.max(s, endOf(ev, s));
    if (s < winEnd && (e > winStart || (e === s && s >= winStart))) {
      out.push({ title: ev.title || 'Termin', location: ev.location || '', allDay: false, start: new Date(s).toISOString(), end: new Date(e).toISOString() });
    }
  };
  // Geänderte Einzeltermine: ersetzen das ursprüngliche Vorkommen der Serie
  const overrides = new Map();
  for (const ev of parsed.events) if (ev.recurrenceId && ev.uid) overrides.set(`${ev.uid}|${occKey(ev.recurrenceId)}`, ev);
  for (const ev of parsed.events) {
    if (ev.status === 'CANCELLED' && !ev.recurrenceId) continue;
    if (ev.recurrenceId) { if (ev.status !== 'CANCELLED') push(ev, ev.start); continue; }
    if (!ev.rrule) { push(ev, ev.start); continue; }
    const rule = ev.rrule;
    const count = +rule.COUNT || 0;
    const until = rule.UNTIL ? parseDate(rule.UNTIL, {}) : null;
    // Ende der Serie: bei ganztägigen Terminen oder Ende ohne Uhrzeit nach Tagen vergleichen, sonst nach Zeitpunkt
    const byDays = until && (ev.start.allDay || until.allDay);
    const untilAt = !until ? null : byDays ? (until.allDay ? dayNum(until.y, until.m, until.d) : Math.floor(toUtc(until) / DAY_MS)) : toUtc(until);
    let n = 0;
    for (const t of seriesDates(ev.start, rule, lastDay)) {
      n += 1;
      if (count && n > count) break;
      const occ = ev.start.allDay ? { ...t, allDay: true } : { ...ev.start, ...t };
      if (untilAt != null && (byDays ? dayNum(t.y, t.m, t.d) : toUtc(occ)) > untilAt) break;
      // Ältere Vorkommen überspringen (mehrtägige dürfen bis zu zwei Wochen vorher beginnen)
      if (dayNum(t.y, t.m, t.d) < firstDay - 14) continue;
      const key = occKey(occ);
      if (ev.exdates.has(key) || (ev.uid && overrides.has(`${ev.uid}|${key}`))) continue;
      push(ev, t);
      if (out.length > MAX_EVENTS * 2) break;
    }
  }
  return out
    .sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    .slice(0, MAX_EVENTS);
}

// ---------- Abruf ----------

// Nur öffentliche Webseiten: keine internen Adressen, IPs oder ungewöhnlichen Ports
function allowedUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim().replace(/^webcals?:\/\//i, 'https://')); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null; // IP-Adressen
  return url;
}

class BlockedRedirect extends Error {}

async function fetchFeed(start) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'User-Agent': 'Haushalt-App Kalender' } });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    let next = null;
    try { next = allowedUrl(new URL(location.replace(/^webcals?:\/\//i, 'https://'), url).href); } catch { /* ungültig */ }
    if (!next) throw new BlockedRedirect();
    url = next;
  }
  throw new BlockedRedirect();
}

async function readLimited(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.min(c.length, all.length - offset)); all.set(part, offset); offset += part.length; }
  return new TextDecoder('utf-8').decode(all);
}

// Stimmen Schlüssel und Code? Wie bei der Anmeldung in der App (household_login, schema.sql).
async function householdOk(req) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  const hhKey = req.headers.get('x-hh-key') || '';
  const hhCode = req.headers.get('x-hh-code') || '';
  if (!url || !key || !/^[a-f0-9]{32,128}$/i.test(hhKey) || !hhCode) return false;
  const headers = { apikey: key, 'Content-Type': 'application/json', 'x-hh-key': hhKey, 'x-hh-code': hhCode };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/household_login`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(10000) });
    return res.ok && (await res.json())?.status === 'ok';
  } catch {
    return false;
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hh-key, x-hh-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);
  if (!(await householdOk(req))) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);
  const body = await req.json().catch(() => ({}));
  const { from, to } = body || {};
  if (!isDay(from) || !isDay(to) || to < from || (Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_SPAN_DAYS) {
    return json({ error: 'ungültiger Zeitraum' }, 400);
  }
  const url = String(body.url || '').length <= 2000 ? allowedUrl(body.url) : null;
  if (!url) return json({ error: 'Bitte den Link des Kalenders einfügen (webcal://… oder https://…).' }, 400);
  let res;
  try {
    res = await fetchFeed(url);
  } catch (err) {
    if (err instanceof BlockedRedirect) return json({ error: 'Weiterleitung auf eine nicht erlaubte Adresse.' }, 400);
    return json({ error: 'Der Kalender antwortet nicht.' }, 502);
  }
  if (res.status === 404 || res.status === 410 || res.status === 403) {
    await res.body?.cancel().catch(() => {});
    return json({ error: 'Kalender nicht gefunden – ist er in der Kalender-App noch als „Öffentlicher Kalender“ freigegeben?' }, 404);
  }
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return json({ error: `Der Kalender meldet Fehler ${res.status}.` }, 502); }
  const text = await readLimited(res);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return json({ error: 'Unter diesem Link ist kein Kalender.' }, 422);
  const parsed = parseCalendar(text);
  return json({ name: parsed.name, events: eventsInRange(parsed, from, to) });
}

// Nur auf dem Server starten – im Browser (Test) werden nur parseCalendar und eventsInRange gebraucht
if (typeof Deno !== 'undefined') Deno.serve(handle);
