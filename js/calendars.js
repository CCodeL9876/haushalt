// Kalender auf der Startseite („Dein Tag“, js/views/heute.js): Termine aus dem Apple-Kalender (oder einem anderen
// Kalender mit .ics-Link). Eine Web-App darf nicht direkt in den Kalender des iPhones schauen – darum abonniert sie
// den Link „Öffentlicher Kalender“ eines Kalenders.
//   gemeinsame Kalender: state.settings.calendars [{ id, name, url, color, small?, symbol? }] – für alle im Haushalt
//   persönliche:         nur auf diesem Gerät (localStorage, pro Haushalt) – z. B. „Arbeit“
// „Klein“ (small, z. B. abonnierte Sportkalender) erscheint nicht in „Dein Tag“, sondern als schmale Leiste
// „Sport diese Woche“ mit Symbol (symbol: Name aus SYMBOLS).
// Die Termine holt die Supabase-Funktion „calendar-feed“ (der Browser darf fremde Seiten nicht abrufen) für heute
// und die nächsten Tage. Sie liegen auf dem Gerät zwischengespeichert und werden alle 15 Minuten erneuert.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { refresh, session, state, uid, update } from './store.js';
import { loadSession } from './session.js';
import { addDays, dateKey, todayKey } from './dates.js';
import { closeSheet, esc, icon, openSheet, toast } from './ui.js';

// Farben wie in der Kalender-App (gut sichtbar hell und dunkel)
export const CAL_COLORS = ['#3B82F6', '#22A06B', '#F59E0B', '#E5484D', '#8E4EC6', '#12A594'];
// Symbole für „Klein“-Kalender (Namen aus js/ui.js)
export const SYMBOLS = [['football', 'Fussball'], ['hockey', 'Eishockey'], ['flag', 'Motorsport'], ['tennis', 'Tennis'], ['mountain', 'Wintersport'], ['trophy', 'Anderes']];
const DAYS_AHEAD = 7;
const FRESH_MS = 15 * 60 * 1000;

export const calendarsAvailable = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && session.mode === 'shared');

// ---------- Welche Kalender ----------

const mineKey = () => `haushalt.mycalendars.${session.key}`;
const cacheKey = (id) => `haushalt.calcache.${id}`;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* privates Fenster: dann eben ohne Merken */ }
}

const myCalendars = () => (session.key ? readJson(mineKey(), []) : []);

export function allCalendars() {
  if (!calendarsAvailable()) return [];
  return [
    ...(state.settings.calendars || []).map((c) => ({ ...c, scope: 'shared' })),
    ...myCalendars().map((c) => ({ ...c, scope: 'personal' })),
  ];
}

const clean = (cal) => ({
  id: cal.id, name: cal.name.slice(0, 40), url: cal.url.slice(0, 2000), color: cal.color,
  ...(cal.small ? { small: true, symbol: SYMBOLS.some(([k]) => k === cal.symbol) ? cal.symbol : 'trophy' } : {}),
});

function saveCalendar(cal, scope) {
  const entry = clean(cal);
  if (scope === 'personal') writeJson(mineKey(), [...myCalendars(), entry]);
  else update((s) => { s.settings.calendars = [...(s.settings.calendars || []), entry]; });
}

// Name, Farbe, Darstellung ändern (Link bleibt)
function changeCalendar(id, scope, patch) {
  const apply = (list) => list.map((c) => (c.id === id ? clean({ ...c, ...patch }) : c));
  if (scope === 'personal') writeJson(mineKey(), apply(myCalendars()));
  else update((s) => { s.settings.calendars = apply(s.settings.calendars || []); });
}

function removeCalendar(id, scope) {
  if (scope === 'personal') writeJson(mineKey(), myCalendars().filter((c) => c.id !== id));
  else update((s) => { s.settings.calendars = (s.settings.calendars || []).filter((c) => c.id !== id); });
  writeJson(cacheKey(id), null);
}

// ---------- Termine holen ----------

async function fetchEvents(url, from, to) {
  const { key, code } = loadSession();
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-hh-key': key || '', 'x-hh-code': code || '' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/calendar-feed`, { method: 'POST', headers, body: JSON.stringify({ url, from, to }), signal: AbortSignal.timeout(25000) });
  } catch {
    throw new Error('Keine Verbindung – später nochmals versuchen.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 && !data?.error) throw new Error('Die Funktion „calendar-feed“ ist in Supabase noch nicht eingerichtet (ANLEITUNG.md).');
  if (res.status === 401) throw new Error('Supabase lehnt ab – bei „calendar-feed“ die JWT-Prüfung ausschalten (ANLEITUNG.md).');
  if (!res.ok || !Array.isArray(data?.events)) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

const range = () => ({ from: todayKey(), to: dateKey(addDays(new Date(), DAYS_AHEAD)) });

let running = null;

// Alle Kalender erneuern, deren Zwischenspeicher älter als 15 Minuten ist (force: alle). Zeichnet danach neu.
export function refreshCalendars({ force = false } = {}) {
  if (running) return running;
  const cals = allCalendars();
  if (!cals.length) return Promise.resolve();
  const { from, to } = range();
  running = (async () => {
    let changed = false;
    await Promise.all(cals.map(async (c) => {
      const cache = readJson(cacheKey(c.id), null);
      if (!force && cache && cache.url === c.url && cache.from === from && Date.now() - cache.at < FRESH_MS) return;
      try {
        const data = await fetchEvents(c.url, from, to);
        writeJson(cacheKey(c.id), { url: c.url, from, to, at: Date.now(), events: data.events });
      } catch (err) {
        // Alte Termine behalten, Fehler merken (unter Haushalt → Kalender sichtbar)
        writeJson(cacheKey(c.id), { ...(cache || { events: [] }), url: c.url, error: err.message, at: cache?.at || 0 });
      }
      changed = true;
    }));
    if (changed) refresh('remote');
  })().finally(() => { running = null; });
  return running;
}

// Zwischengespeicherte Termine der Kalender (normal oder „Klein“); start/end bei Terminen mit Uhrzeit als Date
function cachedEvents(small) {
  const out = [];
  for (const c of allCalendars()) {
    if (Boolean(c.small) !== small) continue;
    const cache = readJson(cacheKey(c.id), null);
    if (!cache || cache.url !== c.url) continue;
    const cal = { name: c.name, color: c.color, scope: c.scope, symbol: c.symbol };
    for (const e of cache.events || []) out.push(e.allDay ? { ...e, cal } : { ...e, start: new Date(e.start), end: new Date(e.end), cal });
  }
  return out;
}

// Termine eines Tages aus den normalen Kalendern: { title, location, allDay, start, end, cal: { name, color } }
export function eventsOn(day) {
  const dayStart = new Date(`${day}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);
  const out = cachedEvents(false).filter((e) => (e.allDay
    ? e.start <= day && e.end > day
    : e.start < dayEnd && (e.end > dayStart || +e.end === +e.start && e.start >= dayStart)));
  return out.sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.allDay ? a.title.localeCompare(b.title, 'de') : a.start - b.start));
}

// „Klein“-Kalender (Sport): was jetzt läuft und in den nächsten 7 Tagen kommt, nach Beginn sortiert
export function upcomingSmall() {
  const now = new Date();
  const today = todayKey();
  const at = (e) => (e.allDay ? new Date(`${e.start}T00:00:00`) : e.start);
  return cachedEvents(true)
    .filter((e) => (e.allDay ? e.end > today : e.end > now || (+e.end === +e.start && e.start > now)))
    .sort((a, b) => at(a) - at(b) || a.title.localeCompare(b.title, 'de'));
}

const status = (c) => {
  const cache = readJson(cacheKey(c.id), null);
  if (cache?.error) return `<span class="amount-minus">${esc(cache.error)}</span>`;
  if (!cache?.at) return 'noch nicht geladen';
  const min = Math.round((Date.now() - cache.at) / 60000);
  return `geladen ${min < 1 ? 'eben' : min < 60 ? `vor ${min} Min.` : `vor ${Math.round(min / 60)} Std.`}`;
};

// ---------- Haushalt → Kalender ----------

export function openCalendars() {
  const cals = allCalendars();
  openSheet({
    title: 'Kalender',
    body: `
      <p class="muted small" style="margin:0 0 12px">Termine aus der Kalender-App erscheinen auf der Startseite unter „Dein Tag“. Gemeinsame Kalender sehen alle im Haushalt, persönliche nur dieses Gerät. Antippen zum Ändern, z. B. „Klein“ für Sportkalender.</p>
      ${cals.length ? `<ul class="list cal-list">${cals.map((c) => `
        <li><span class="cal-swatch" style="background:${esc(c.color)}" aria-hidden="true"></span>
          <button type="button" class="list-main cal-edit" data-sheet-action="edit" data-id="${esc(c.id)}" aria-label="${esc(c.name)} bearbeiten">${esc(c.name)}<small>${c.small ? `${icon(c.symbol || 'trophy', 'icon-xs')} klein · ` : ''}${c.scope === 'personal' ? `${icon('lock', 'icon-xs')} nur dieses Gerät` : `${icon('users', 'icon-xs')} für alle`} · ${status(c)}</small></button>
          <button type="button" class="icon-btn" data-sheet-action="remove" data-id="${esc(c.id)}" data-scope="${c.scope}" aria-label="${esc(c.name)} entfernen">${icon('trash', 'icon-sm')}</button>
        </li>`).join('')}</ul>` : '<p class="muted small" style="text-align:center;padding:8px 0 16px">Noch kein Kalender eingetragen.</p>'}`,
    footer: `<button type="button" class="btn btn-primary btn-block" data-sheet-action="add">${icon('plus', 'icon-sm')} Kalender hinzufügen</button>
      ${cals.length ? `<button type="button" class="btn btn-block" data-sheet-action="reload">${icon('refresh', 'icon-sm')} Jetzt neu laden</button>` : ''}`,
    actions: {
      add() { addCalendarSheet(); },
      edit(btn) {
        const c = cals.find((x) => x.id === btn.dataset.id);
        if (c) editCalendarSheet(c);
      },
      async reload(btn) {
        btn.disabled = true;
        await refreshCalendars({ force: true });
        openCalendars();
      },
      remove(btn) {
        const c = cals.find((x) => x.id === btn.dataset.id);
        if (!c || !confirm(`„${c.name}“ entfernen?${c.scope === 'shared' ? ' Gilt für alle im Haushalt.' : ''}`)) return;
        removeCalendar(c.id, c.scope);
        openCalendars();
      },
    },
  });
}

// Darstellung, Symbol und Farbe – beim Hinzufügen und Bearbeiten gleich
const styleFields = ({ small = false, symbol = 'football', color }) => `
  <div class="field"><span>Darstellung</span>
    <div class="seg seg-wide" role="radiogroup">
      <label class="seg-btn seg-radio"><input type="radio" name="small" value="" ${small ? '' : 'checked'}>Normal</label>
      <label class="seg-btn seg-radio"><input type="radio" name="small" value="1" ${small ? 'checked' : ''}>Klein (Sport)</label>
    </div>
  </div>
  <div class="field cal-symbols"><span>Symbol</span>
    <div class="chips">${SYMBOLS.map(([k, label]) => `<label class="cal-symbol"><input type="radio" name="symbol" value="${k}" ${k === symbol ? 'checked' : ''} aria-label="${label}">${icon(k, 'icon-sm')}</label>`).join('')}</div>
    <small class="muted">Klein: nicht in „Dein Tag“, sondern als schmale Leiste „Sport diese Woche“.</small>
  </div>
  <div class="field"><span>Farbe</span>
    <div class="chips">${CAL_COLORS.map((c) => `<label class="cal-color" style="background:${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="Farbe ${c}"></label>`).join('')}</div>
  </div>`;

const styleOf = (data) => ({
  small: data.get('small') === '1',
  symbol: String(data.get('symbol') || 'trophy'),
  color: String(data.get('color') || CAL_COLORS[0]),
});

function editCalendarSheet(c) {
  openSheet({
    title: c.name,
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" maxlength="40" required autocomplete="off" value="${esc(c.name)}">
      </label>
      ${styleFields(c)}
      ${c.scope === 'shared' ? '<p class="muted small" style="margin:0">Gilt für alle im Haushalt.</p>' : ''}`,
    submitLabel: 'Speichern',
    onSubmit(data) {
      changeCalendar(c.id, c.scope, { name: String(data.get('name')).trim() || c.name, ...styleOf(data) });
      refresh();
      openCalendars();
      return false;
    },
  });
}

function addCalendarSheet() {
  const used = new Set(allCalendars().map((c) => c.color));
  const color = CAL_COLORS.find((c) => !used.has(c)) || CAL_COLORS[0];
  const form = openSheet({
    title: 'Kalender hinzufügen',
    body: `
      <details class="cal-help" open>
        <summary>So kommst du zum Link (iPhone)</summary>
        <ol class="small">
          <li>Kalender-App öffnen → unten <strong>Kalender</strong>.</li>
          <li>Beim gewünschten Kalender auf <strong>ⓘ</strong> tippen.</li>
          <li>Ganz unten <strong>Öffentlicher Kalender</strong> einschalten → <strong>Link teilen …</strong> → <strong>Kopieren</strong>.</li>
          <li>Hier einfügen. Geht nur bei iCloud-Kalendern.</li>
        </ol>
        <p class="small" style="margin:8px 0 0">Abonnierter Kalender (z. B. Sport): den Link nehmen, mit dem du ihn abonniert hast (beginnt meist mit webcal://) und „Klein (Sport)“ wählen.</p>
      </details>
      <label class="field"><span>Link</span>
        <input class="input" name="url" required inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="webcal://p…-caldav.icloud.com/published/…">
      </label>
      <label class="field"><span>Name</span>
        <input class="input" name="name" maxlength="40" autocomplete="off" placeholder="z. B. Familie, Arbeit (sonst Name aus dem Kalender)">
      </label>
      <div class="field"><span>Für wen?</span>
        <div class="seg seg-wide" role="radiogroup">
          <label class="seg-btn seg-radio"><input type="radio" name="scope" value="shared" checked>Alle im Haushalt</label>
          <label class="seg-btn seg-radio"><input type="radio" name="scope" value="personal">Nur dieses Gerät</label>
        </div>
      </div>
      ${styleFields({ color })}
      <p class="muted small" style="margin:0">Wer den Link kennt, kann den Kalender lesen – nicht weitergeben. Den Link eines gemeinsamen Kalenders sehen alle im Haushalt.</p>
      <p class="small amount-minus cal-error" aria-live="polite"></p>`,
    submitLabel: 'Prüfen und hinzufügen',
    onSubmit(data, f) {
      const url = String(data.get('url')).trim();
      const name = String(data.get('name')).trim();
      const scope = data.get('scope') === 'personal' ? 'personal' : 'shared';
      const btn = f.querySelector('button[type="submit"]');
      const error = f.querySelector('.cal-error');
      btn.disabled = true;
      btn.textContent = 'Wird geprüft …';
      error.textContent = '';
      const { from, to } = range();
      fetchEvents(url, from, to)
        .then((res) => {
          const cal = { id: uid(), name: name || res.name || 'Kalender', url, ...styleOf(data) };
          saveCalendar(cal, scope);
          writeJson(cacheKey(cal.id), { url, from, to, at: Date.now(), events: res.events });
          closeSheet();
          refresh();
          toast(`„${cal.name}“ hinzugefügt – ${res.events.length} ${res.events.length === 1 ? 'Termin' : 'Termine'} in den nächsten ${DAYS_AHEAD} Tagen`);
        })
        .catch((err) => {
          error.textContent = err.message;
          btn.disabled = false;
          btn.textContent = 'Prüfen und hinzufügen';
        });
      return false;
    },
  });
  form.elements.url.focus();
}
