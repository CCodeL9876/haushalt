// Supabase Edge Function „push“: verschickt Push-Mitteilungen an die Geräte eines Haushalts.
//
//  - POST { run: 'reminders' } – vom Zeitplan (supabase/push-cron.sql), alle 5 Minuten:
//    · Morgen-Erinnerung: pro Gerät zur gewählten Uhrzeit und an den gewählten Wochentagen die offenen ToDos einer
//      Liste (fällig bis heute oder ohne Datum). Ist nichts offen, kommt keine Mitteilung.
//    · Kühlschrank: ab 17 Uhr (Schweizer Zeit) Reste am Vortag („bis morgen aufbrauchen“) und am letzten Tag („heute“).
//    · Vortag: ab 18 Uhr an alle Geräte des Haushalts, wenn ein geteiltes ToDo mit „am Vortag erinnern“ (remind)
//      morgen fällig ist – z. B. Altpapier oder Grüngut aus dem Abfuhrplan.
//    · Erinnerung vor einem ToDo (Datum, Uhrzeit, „Erinnern“): kurz vor dem gewählten Zeitpunkt (Tabelle push_alarms).
//    · Abfuhrkalender: ab 17 Uhr (wie „Jetzt wichtig“ auf Heute) an alle Geräte des Haushalts, wenn morgen eine
//      Abfuhr mit Glocke ansteht (Haushalt → Abfuhrkalender, settings.waste) – nicht, wenn schon „draussen“ getippt.
//    · Mitnehmen: ab 6:45 an die Person, die Reste mit „Morgen mitnehmen“ markiert hat (sonst an alle) –
//      „Gemüsecurry aus dem Kühlschrank mitnehmen“ (fridge: take = heute, takeFor).
//    · Menü (wie „Jetzt wichtig“): ab 15 Uhr, wenn fürs Menü von heute Zutaten fehlen (nicht, wenn als gekocht
//      abgehakt), und am Tag vor Sonntag/Feiertag, wenn für die Menüs dann Zutaten fehlen („Läden zu“).
//    Jede Erinnerung nur einmal (Tabelle push_sent). Ohne Fälliges passiert nichts – darum ohne Anmeldung.
//  - POST { test: true, endpoint, kind? } – von der App (mit Haushalt-Schlüssel und Zugangscode): Probe an dieses
//    Gerät; kind 'todo' schickt die Morgen-Erinnerung so, wie sie jetzt aussähe.
//  - POST { assigned: todoId, by: memberId } – von der App, nachdem jemand ein ToDo einer Person zugewiesen hat:
//    Mitteilung an die Geräte dieser Person. Titel, Liste und Person liest die Funktion selbst aus der Datenbank.
//
// Geräte stehen in push_subscriptions (schema.sql). Verschickt wird nach dem Web-Push-Standard: Inhalt
// verschlüsselt für das Gerät (RFC 8291, aes128gcm), Absender ausgewiesen mit VAPID (RFC 8292). Alles mit WebCrypto,
// ohne Zusatzbibliothek. Secret: VAPID_PRIVATE_KEY (ANLEITUNG.md, „Push-Mitteilungen“); der öffentliche Schlüssel
// steht hier und in js/config.js (PUSH_PUBLIC_KEY) – beide müssen zusammenpassen.

const VAPID_PUBLIC_KEY = 'BJvU0TeuBTa-QQLamVufZ_ck7Skh8gAA1SCzb5vcN-u6MgRoN2nGa5hgsEfs1FinZn9Hd8v77yjfBArWCi_u_Ig';
// Kontakt für die Push-Dienste (Apple verlangt eine https- oder mailto-Adresse)
const VAPID_SUBJECT = 'https://ccodel9876.github.io/haushalt/';
const TIME_ZONE = 'Europe/Zurich';
const REMIND_HOUR = 17;
const EVE_HOUR = 18;
const IDEA_MORNING = 7 * 60 + 15; // Mo–Fr 7:15: Menüidee im Kühlschrank
const TAKE_MORNING = 6 * 60 + 45; // Reste mitnehmen: vor dem Aus-dem-Haus-Gehen
const MEAL_HOUR = 15; // Menü: Zutaten fehlen / morgen Läden zu – Zeit genug, noch einzukaufen
const MEAL_UNTIL = 20; // danach nicht mehr nachholen

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hh-key, x-hh-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// ---------- Datenbank (REST mit dem Service-Schlüssel, umgeht die Zugriffsregeln) ----------

function db(path, { method = 'GET', body, prefer } = {}) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) };
  if (key?.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return fetch(`${url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Datenbank ${res.status}: ${await res.text()}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    });
}

// Stimmen Schlüssel und Code? Wie bei der Anmeldung in der App (household_login, schema.sql).
async function householdOk(req) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  const hhKey = req.headers.get('x-hh-key') || '';
  const hhCode = req.headers.get('x-hh-code') || '';
  if (!url || !key || !/^[a-f0-9]{32,128}$/i.test(hhKey) || !hhCode) return null;
  const headers = { apikey: key, 'Content-Type': 'application/json', 'x-hh-key': hhKey, 'x-hh-code': hhCode };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/household_login`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(10000) });
    return res.ok && (await res.json())?.status === 'ok' ? hhKey : null;
  } catch {
    return null;
  }
}

// ---------- Web Push ----------

let vapidKey = null;
function vapidPrivateKey() {
  vapidKey ||= (() => {
    const d = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!d) throw new Error('In Supabase fehlt das Secret VAPID_PRIVATE_KEY (ANLEITUNG.md).');
    const pub = fromB64url(VAPID_PUBLIC_KEY);
    const jwk = { kty: 'EC', crv: 'P-256', d: d.trim(), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  })();
  return vapidKey;
}

// Ausweis für den Push-Dienst: signiertes JWT (ES256), gültig 12 Stunden
async function vapidHeader(endpoint) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidPrivateKey(), enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

const hkdf = async (salt, ikm, info, bytes) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
};

// Inhalt für ein Gerät verschlüsseln (RFC 8291, ein einziger Datensatz)
async function encrypt(sub, payload) {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(JSON.stringify(payload)), new Uint8Array([2])); // 2 = letzter Datensatz
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // Datensatzgrösse 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Gibt true zurück, wenn der Dienst die Mitteilung angenommen hat. Abgelaufene Abos werden gelöscht.
async function send(sub, payload) {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: await encrypt(sub, payload),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 410) {
      await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
    } else if (!res.ok) {
      console.error('Push abgelehnt', res.status, await res.text());
    }
    return res.ok;
  } catch (err) {
    console.error('Push fehlgeschlagen', err);
    return false;
  }
}

// ---------- Erinnerungen ----------

// Datum, Uhrzeit und Wochentag (1 = Montag … 7 = Sonntag) in der Schweiz (Sommer-/Winterzeit richtig)
function local(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  return { day, hour: Number(p.hour), minutes: Number(p.hour) * 60 + Number(p.minute), weekday };
}
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0]);

async function fridgeReminders() {
  const now = local();
  if (now.hour < REMIND_HOUR) return { skipped: 'vor 17 Uhr' };
  const today = now.day;
  const tomorrow = nextDay(today);
  const items = await db(`items?collection=eq.fridge&select=household_key,id,data`);
  // Fällige Reste je Haushalt: heute aufbrauchen, oder bis morgen (nicht, wenn erst heute erfasst – das weiss man noch)
  const due = new Map();
  for (const it of items || []) {
    const f = it.data || {};
    const added = f.addedAt ? local(new Date(f.addedAt)).day : '';
    const kind = f.useBy === today ? 'heute' : f.useBy === tomorrow && added < today ? 'morgen' : null;
    if (!kind || !f.name) continue;
    if (!due.has(it.household_key)) due.set(it.household_key, []);
    due.get(it.household_key).push({ ref: `fridge:${it.id}:${f.useBy}:${kind}`, name: String(f.name).slice(0, 60), kind });
  }
  let sent = 0;
  for (const [household, entries] of due) {
    const refs = entries.map((e) => `"${e.ref.replace(/"/g, '')}"`).join(',');
    const done = new Set((await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=in.(${encodeURIComponent(refs)})&select=ref`)).map((r) => r.ref));
    const open = entries.filter((e) => !done.has(e.ref));
    if (!open.length) continue;
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs.length) continue;
    // Alle fälligen nennen, nicht nur die neuen: Eine spätere Mitteilung am selben Tag ersetzt die frühere (gleiches tag)
    const todayNames = entries.filter((e) => e.kind === 'heute').map((e) => e.name);
    const tomorrowNames = entries.filter((e) => e.kind === 'morgen').map((e) => e.name);
    const body = [
      todayNames.length ? `Heute aufbrauchen: ${list(todayNames)}.` : '',
      tomorrowNames.length ? `Bis morgen aufbrauchen: ${list(tomorrowNames)}.` : '',
    ].filter(Boolean).join(' ');
    const payload = { title: 'Kühlschrank', body, url: '#kuehlschrank', tag: `fridge-${today}` };
    const results = await Promise.all(subs.map((s) => send(s, payload)));
    if (!results.some(Boolean)) continue; // später nochmals versuchen
    await db('push_sent', { method: 'POST', body: open.map((e) => ({ household_key: household, ref: e.ref })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  // Alte Einträge aufräumen
  await db(`push_sent?sent_at=lt.${new Date(Date.now() - 30 * 86400000).toISOString()}`, { method: 'DELETE' });
  return { households: sent };
}

// ---------- Am Morgen: Reste mitnehmen (fridge.take, js/fridge.js setTake) ----------
// Je Haushalt und Person eine Mitteilung; nur bis 11 Uhr nachholen
async function takeReminders() {
  const now = local();
  if (now.minutes < TAKE_MORNING || now.hour >= 11) return { skipped: 'nicht am Morgen' };
  const items = await db(`items?collection=eq.fridge&data->>take=eq.${now.day}&select=household_key,id,data`);
  const groups = new Map();
  for (const it of items || []) {
    const f = it.data || {};
    if (!f.name) continue;
    const key = `${it.household_key}|${f.takeFor || ''}`;
    if (!groups.has(key)) groups.set(key, { household: it.household_key, member: f.takeFor || '', entries: [] });
    groups.get(key).entries.push({ ref: `take:${it.id}:${now.day}`, name: clip(f.name, 60) });
  }
  // Zahlen für die Fehlersuche: gefunden, schon verschickt, ohne Gerät, Versand abgelehnt
  let sent = 0, already = 0, noDevice = 0, failed = 0;
  for (const { household, member, entries } of groups.values()) {
    const refs = entries.map((e) => `"${e.ref.replace(/"/g, '')}"`).join(',');
    const done = new Set((await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=in.(${encodeURIComponent(refs)})&select=ref`)).map((r) => r.ref));
    const open = entries.filter((e) => !done.has(e.ref));
    if (!open.length) { already += 1; continue; }
    const who = member ? `&member_id=eq.${encodeURIComponent(member)}` : '';
    let subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}${who}&select=endpoint,p256dh,auth`);
    // Person ohne Mitteilungen: dann an alle im Haushalt
    if (!subs?.length && member) subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs?.length) { noDevice += 1; continue; }
    const payload = { title: '🥡 Mitnehmen', body: `${list(entries.map((e) => e.name))} aus dem Kühlschrank – nicht vergessen!`, url: '#heute', tag: `take-${now.day}` };
    const results = await Promise.all(subs.map((s) => send(s, payload)));
    if (!results.some(Boolean)) { failed += 1; continue; } // später nochmals versuchen
    await db('push_sent', { method: 'POST', body: open.map((e) => ({ household_key: household, ref: e.ref })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  return { found: items?.length || 0, sent, already, noDevice, failed };
}

// ---------- Mo–Fr am Morgen: Menüidee im Kühlschrank ----------
// Einträge, die als Menüidee erfasst wurden (idea), einmal pro Tag und Haushalt; nur bis 11 Uhr nachholen
async function ideaReminders() {
  const now = local();
  if (now.minutes < IDEA_MORNING || now.hour >= 11) return { skipped: 'nicht am Morgen' };
  const expired = await expiredReminders(now);
  if (now.weekday > 5) return { skipped: 'Wochenende', expired };
  const items = await db(`items?collection=eq.fridge&select=household_key,data`);
  const byHousehold = new Map();
  for (const it of items || []) {
    const f = it.data || {};
    if (!f.idea || !f.name || (f.useBy && f.useBy < now.day) || f.take === now.day) continue; // Mitnehmen: eigene Mitteilung
    if (!byHousehold.has(it.household_key)) byHousehold.set(it.household_key, []);
    byHousehold.get(it.household_key).push(clip(f.name, 60));
  }
  let sent = 0;
  for (const [household, names] of byHousehold) {
    const ref = `idea:${now.day}`;
    const done = await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=eq.${encodeURIComponent(ref)}&select=ref`);
    if (done?.length) continue;
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs?.length) continue;
    const payload = { title: 'Kühlschrank', body: `Nicht vergessen – ${list(names)} im Kühlschrank`, url: '#kuehlschrank', tag: `idea-${now.day}` };
    const results = await Promise.all(subs.map((s) => send(s, payload)));
    if (!results.some(Boolean)) continue;
    await db('push_sent', { method: 'POST', body: [{ household_key: household, ref }], prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  return { households: sent, expired };
}

// Am Morgen nach dem Ablauf (jeden Tag, 7:15): einmal „… ist abgelaufen – anschauen und entsorgen“
async function expiredReminders(now) {
  const yesterday = new Date(Date.parse(`${now.day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const items = await db(`items?collection=eq.fridge&select=household_key,id,data`);
  const byHousehold = new Map();
  for (const it of items || []) {
    const f = it.data || {};
    if (f.useBy !== yesterday || !f.name) continue;
    if (!byHousehold.has(it.household_key)) byHousehold.set(it.household_key, []);
    byHousehold.get(it.household_key).push(clip(f.name, 60));
  }
  let sent = 0;
  for (const [household, names] of byHousehold) {
    const ref = `expired:${now.day}`;
    const done = await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=eq.${encodeURIComponent(ref)}&select=ref`);
    if (done?.length) continue;
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs?.length) continue;
    const body = `${list(names)} ${names.length > 1 ? 'sind' : 'ist'} abgelaufen – anschauen und entsorgen`;
    const results = await Promise.all(subs.map((s) => send(s, { title: 'Kühlschrank', body, url: '#kuehlschrank', tag: `expired-${now.day}` })));
    if (!results.some(Boolean)) continue;
    await db('push_sent', { method: 'POST', body: [{ household_key: household, ref }], prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  return { households: sent };
}

// ---------- Morgen-Erinnerung an eine ToDo-Liste ----------

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Offene ToDos, die heute dran sind: fällig bis heute (Überfälliges zuerst) oder ohne Datum
function dueToday(todos, today) {
  return todos
    .filter((t) => t && !t.done && clip(t.title, 120) && (!t.due || t.due <= today))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || (a.addedAt || 0) - (b.addedAt || 0));
}

// Liste und ToDos eines Geräts: geteilte aus der Datenbank, persönliche aus todo_items (von der App hinterlegt)
async function todoContent(sub, cache) {
  if (sub.todo_scope === 'personal') {
    return { name: clip(sub.todo_name, 80) || 'ToDo', todos: Array.isArray(sub.todo_items) ? sub.todo_items : [] };
  }
  const key = `${sub.household_key}/${sub.todo_list}`;
  if (!cache.has(key)) {
    const hh = encodeURIComponent(sub.household_key);
    const list = encodeURIComponent(sub.todo_list);
    const [lists, todos] = await Promise.all([
      db(`items?household_key=eq.${hh}&collection=eq.todolists&id=eq.${list}&select=data`),
      db(`items?household_key=eq.${hh}&collection=eq.todos&data->>listId=eq.${list}&select=data`),
    ]);
    // Liste gelöscht: nichts schicken
    cache.set(key, lists?.length ? { name: clip(lists[0].data?.name, 80) || 'ToDo', todos: todos.map((t) => t.data) } : null);
  }
  return cache.get(key);
}

function todoPayload(sub, content, today) {
  const open = dueToday(content.todos, today);
  if (!open.length) return null;
  const line = (t) => `${clip(t.title, 60)}${t.due && t.due < today ? ' (überfällig)' : t.due === today && t.time ? ` (${t.time})` : ''}`;
  const shown = open.slice(0, 4).map(line);
  if (open.length > 4) shown.push(`+${open.length - 4} weitere`);
  return {
    title: `${content.name}: heute zu tun (${open.length})`,
    body: shown.join(' · '),
    url: `#todo/${sub.todo_scope}/${sub.todo_list}`,
    tag: `todo-${sub.todo_list}`,
  };
}

const sha = async (text) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))).slice(0, 22);

async function todoReminders() {
  const now = local();
  const subs = await db('push_subscriptions?todo_list=not.is.null&select=endpoint,p256dh,auth,household_key,todo_scope,todo_list,todo_name,todo_time,todo_days,todo_items');
  const cache = new Map();
  let sent = 0;
  for (const sub of subs || []) {
    const days = String(sub.todo_days || '').split(',').map(Number);
    const [h, m] = String(sub.todo_time || '').split(':').map(Number);
    const at = h * 60 + m;
    // Zur gewählten Zeit (der Zeitplan läuft alle 5 Minuten; eine Stunde Spielraum, falls ein Lauf ausfällt)
    if (!days.includes(now.weekday) || !(now.minutes >= at && now.minutes < at + 60)) continue;
    const ref = `todo:${await sha(sub.endpoint)}:${now.day}`;
    const done = await db(`push_sent?household_key=eq.${encodeURIComponent(sub.household_key)}&ref=eq.${encodeURIComponent(ref)}&select=ref`);
    if (done?.length) continue;
    const content = await todoContent(sub, cache);
    const payload = content && todoPayload(sub, content, now.day);
    if (payload && !(await send(sub, payload))) continue; // nicht angenommen: beim nächsten Lauf nochmals
    if (payload) sent += 1;
    // Auch ohne Mitteilung (leere Liste) als erledigt merken: später am Morgen kommt nichts mehr nach
    await db('push_sent', { method: 'POST', body: [{ household_key: sub.household_key, ref }], prefer: 'resolution=ignore-duplicates,return=minimal' });
  }
  return { sent };
}

// ---------- Vortag: geteilte ToDos mit remind, die morgen fällig sind ----------

async function eveReminders() {
  const now = local();
  if (now.hour < EVE_HOUR) return { skipped: 'vor 18 Uhr' };
  const tomorrow = nextDay(now.day);
  const items = await db(`items?collection=eq.todos&data->>remind=eq.true&data->>due=eq.${tomorrow}&select=household_key,id,data`);
  const due = new Map();
  for (const it of items || []) {
    const t = it.data || {};
    if (t.done || !clip(t.title, 120)) continue;
    if (!due.has(it.household_key)) due.set(it.household_key, []);
    due.get(it.household_key).push({ ref: `eve:${it.id}:${tomorrow}`, title: clip(t.title, 60), time: t.time || '', listId: t.listId });
  }
  let sent = 0;
  for (const [household, entries] of due) {
    const refs = entries.map((e) => `"${e.ref.replace(/"/g, '')}"`).join(',');
    const done = new Set((await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=in.(${encodeURIComponent(refs)})&select=ref`)).map((r) => r.ref));
    const open = entries.filter((e) => !done.has(e.ref));
    if (!open.length) continue;
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs.length) continue;
    // Alle für morgen nennen; eine spätere Mitteilung am selben Abend ersetzt die frühere (gleiches tag)
    const names = entries.map((e) => `${e.title}${e.time ? ` (${e.time})` : ''}`);
    const payload = {
      title: `Morgen: ${list(names)}`,
      body: 'Erinnerung für morgen – antippen öffnet die Liste.',
      url: `#todo/shared/${entries[0].listId}`,
      tag: `eve-${tomorrow}`,
    };
    const results = await Promise.all(subs.map((s) => send(s, payload)));
    if (!results.some(Boolean)) continue; // später nochmals versuchen
    await db('push_sent', { method: 'POST', body: open.map((e) => ({ household_key: household, ref: e.ref })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  return { households: sent };
}

// ---------- Abfuhrkalender: am Vortag ab 17 Uhr (settings.waste, js/waste.js) ----------

async function wasteReminders() {
  const now = local();
  if (now.hour < REMIND_HOUR) return { skipped: 'vor 17 Uhr' };
  const tomorrow = nextDay(now.day);
  const rows = await db('items?collection=eq.settings&id=in.(main,wasteOut)&select=household_key,id,data');
  // „Draussen“ steht in einer eigenen Zeile (settings/wasteOut, js/store.js), bei älteren Ständen noch in main
  const outBy = new Map(rows.filter((r) => r.id === 'wasteOut').map((r) => [r.household_key, r.data?.value]));
  let sent = 0;
  for (const row of (rows || []).filter((r) => r.id === 'main')) {
    if ((outBy.get(row.household_key) ?? row.data?.wasteOut) === tomorrow) continue; // auf Heute schon „Draussen“ getippt
    const kinds = (row.data?.waste?.kinds || []).filter((k) => k?.remind && Array.isArray(k.dates) && k.dates.includes(tomorrow));
    if (!kinds.length) continue;
    const household = row.household_key;
    const entries = kinds.map((k) => ({ ref: `waste:${clip(k.id, 40)}:${tomorrow}`, name: clip(k.short || k.name, 40) }));
    const refs = entries.map((e) => `"${e.ref.replace(/"/g, '')}"`).join(',');
    const done = new Set((await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=in.(${encodeURIComponent(refs)})&select=ref`)).map((r) => r.ref));
    const open = entries.filter((e) => !done.has(e.ref));
    if (!open.length) continue;
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth`);
    if (!subs.length) continue;
    const payload = {
      title: `Morgen: ${list(entries.map((e) => e.name))} rausstellen`,
      body: 'Abfuhr morgen früh – am besten heute Abend rausstellen.',
      url: '#heute',
      tag: `waste-${tomorrow}`,
    };
    const results = await Promise.all(subs.map((s) => send(s, payload)));
    if (!results.some(Boolean)) continue; // später nochmals versuchen
    await db('push_sent', { method: 'POST', body: open.map((e) => ({ household_key: household, ref: e.ref })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    sent += 1;
  }
  return { households: sent };
}

// ---------- Aus der App übernommen (js/ingredients.js, js/dates.js) – bei Änderungen dort hier nachführen ----------
// Hier hineinkopiert statt importiert: Der Editor im Supabase-Dashboard lädt keine Dateien von anderen Adressen.

const UNITS = [
  'kg', 'g', 'mg', 'l', 'dl', 'cl', 'ml', 'el', 'tl', 'msp', 'essl[öo]ffel', 'teel[öo]ffel', 'prisen?', 'st[üu]ck', 'stk',
  'bund', 'dosen?', 'packungen?', 'pack', 'pck', 'p[äa]ckchen', 'beutel', 'becher', 'gl[äa]ser', 'glas', 'tassen?',
  'zehen?', 'scheiben?', 'zweige?', 'handvoll', 'w[üu]rfel', 'bl[äa]tter', 'blatt', 'stiele?', 'stangen?', 'k[öo]pfe?',
  'tropfen', 'spritzer', 'schuss', 'portionen?', 'flaschen?', 'kugeln?', 'knollen?', 'tranchen?',
];
const NUMBER = '(?:\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|[½¼¾⅓⅔⅛])(?:\\s*[½¼¾⅓⅔])?';
const AMOUNT = new RegExp(`^\\s*(${NUMBER}(?:\\s*(?:-|–|bis)\\s*${NUMBER})?)\\s*(?:(${UNITS.join('|')})\\.?(?=[\\s,]|$))?[\\s,]*`, 'i');
// Ungefähre Mengen ohne Zahl: „wenig Pfeffer“, „etwas Butter“, „1 Prise Salz“
const VAGUE = /^\s*(wenig|etwas|einige|ein paar|nach belieben|evtl\.?|eventuell|n\.\s?b\.|nach bedarf)\s+/i;
const QUALIFIER = /^(gestr\.|gestrichen|geh\.|gehäuft|knapp|gross|groß|klein|mittelgrosse?|mittelgroße?)\s+/i;

// → { name, amount }: amount enthält Menge, Einheit und Zusätze („gehackt“, Klammertexte)
function splitIngredient(line) {
  let rest = String(line || '').trim();
  const extras = [];
  let amount = '';
  const m = AMOUNT.exec(rest);
  if (m && m[0].trim()) {
    amount = [m[1], m[2]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    rest = rest.slice(m[0].length);
  } else {
    const v = VAGUE.exec(rest);
    if (v) {
      amount = v[1];
      rest = rest.slice(v[0].length);
    }
  }
  const q = QUALIFIER.exec(rest);
  if (q) {
    extras.push(q[1]);
    rest = rest.slice(q[0].length);
  }
  // Klammertexte und alles nach dem ersten Komma sind Zusätze, kein Teil des Artikels
  rest = rest.replace(/\(([^)]*)\)/g, (all, inner) => {
    if (/^(n|e|en|s|er|es)$/i.test(inner)) return ''; // „Zwiebel(n)“ → „Zwiebel“
    extras.push(inner.trim());
    return '';
  });
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    extras.push(rest.slice(comma + 1).trim());
    rest = rest.slice(0, comma);
  }
  const name = rest.replace(/\s+/g, ' ').trim() || String(line || '').trim();
  return { name, amount: [amount, ...extras.filter(Boolean)].join(' · ') };
}

const STAPLES = ['salz', 'pfeffer', 'wasser', 'zucker', 'mehl', 'öl', 'oel', 'olivenöl', 'rapsöl', 'sonnenblumenöl',
  'essig', 'muskat', 'muskatnuss', 'bratbutter', 'eiswasser', 'pfeffer aus der mühle', 'salz und pfeffer', 'salz, pfeffer'];

// Grundzutat, die man meist zu Hause hat?
function isStaple(name) {
  const n = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return STAPLES.includes(n) || /^(salz|pfeffer|wasser)\b/.test(n);
}

// ---------- Glutenfrei einkaufen (Menüidee mit „Glutenfrei einkaufen“) ----------
// Glutenhaltige Zutaten bekommen auf der Einkaufsliste den Zusatz „glutenfrei“ („Spaghetti“ → „Spaghetti glutenfrei“),
// von Natur aus glutenfreie bleiben, wie sie sind. Erkannt über Stichwörter im Namen; Mais-, Reis-, Buchweizen- usw.
// sind schon glutenfrei.
const GLUTEN = ['spaghetti', 'nudel', 'pasta', 'penne', 'fusilli', 'farfalle', 'tagliatelle', 'linguine', 'rigatoni', 'lasagne',
  'makkaroni', 'maccheroni', 'magronen', 'hörnli', 'hornli', 'spätzli', 'spätzle', 'knöpfli', 'gnocchi', 'ravioli', 'tortellini',
  'teigwaren', 'couscous', 'bulgur', 'mehl', 'brösel', 'brot', 'toast', 'brötchen', 'weggli', 'zopf', 'baguette', 'ciabatta',
  'pita', 'wrap', 'tortilla', 'gipfeli', 'croissant', 'teig', 'biskuit', 'keks', 'guetzli', 'cracker', 'zwieback', 'griess',
  'hafer', 'müesli', 'muesli', 'cornflakes', 'bier', 'bouillon', 'brühe', 'panade', 'paniert'];
const NATURALLY_FREE = /^(reis|mais|glas|buchweizen|kichererbsen|linsen|erbsen|kartoffel|mandel|kokos|hirse|quinoa|amaranth|tapioka|maniok|soja)/i;
const SOY_SAUCE = /^soja\s*-?\s*(sauce|soße|sosse)$/i;

function glutenFree(name) {
  const n = String(name || '').trim();
  const low = n.toLowerCase();
  if (!n || /gluten\s*-?\s*frei|ohne gluten/.test(low)) return n;
  if (SOY_SAUCE.test(n)) return 'Tamari (glutenfreie Sojasauce)';
  const first = low.split(/[\s-]+/)[0];
  if (NATURALLY_FREE.test(first)) return n;
  // Weiss-, Halbweiss-, Ruch-, Dinkel-, Zopfmehl usw.: im Laden gibt es einfach „Mehl glutenfrei“
  if (/mehl$/.test(low) && !/paniermehl$/.test(low)) return 'Mehl glutenfrei';
  return GLUTEN.some((w) => low.includes(w)) ? `${n} glutenfrei` : n;
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Feiertage, an denen die Läden in der Schweiz (fast überall) zu sind. Berchtolds- und Stephanstag gelten nicht in
// allen Kantonen – lieber einmal zu oft an den Einkauf erinnern als einmal zu wenig.
function easter(year) { // Ostersonntag (Gauss, gregorianisch)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return new Date(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

const holidayCache = new Map();
function holidays(year) {
  if (!holidayCache.has(year)) {
    const e = easter(year);
    holidayCache.set(year, new Map([
      [`${year}-01-01`, 'Neujahr'], [`${year}-01-02`, 'Berchtoldstag'],
      [dateKey(addDays(e, -2)), 'Karfreitag'], [dateKey(e), 'Ostern'], [dateKey(addDays(e, 1)), 'Ostermontag'],
      [dateKey(addDays(e, 39)), 'Auffahrt'], [dateKey(addDays(e, 49)), 'Pfingsten'], [dateKey(addDays(e, 50)), 'Pfingstmontag'],
      [`${year}-08-01`, '1. August'], [`${year}-12-25`, 'Weihnachten'], [`${year}-12-26`, 'Stephanstag'],
    ]));
  }
  return holidayCache.get(year);
}

const holidayName = (date) => holidays(date.getFullYear()).get(dateKey(date)) || '';
// Läden zu: Sonntag oder Feiertag
const shopsClosed = (date) => date.getDay() === 0 || Boolean(holidayName(date));

// ---------- Menü wie „Jetzt wichtig“ (js/views/heute.js): Zutaten fehlen, morgen Läden zu ----------
// Gleiche Rechnung wie in der App: fehlend = keine Grundzutat, nicht offen auf der Einkaufsliste, nicht in den
// letzten 7 Tagen gekauft (abgehakt) und nicht im Kühlschrank; bei „Glutenfrei einkaufen“ die glutenfreie Variante.

const termKey = (name) => String(name || '').trim().toLowerCase().slice(0, 64);
const RECENT_DAYS = 7;

// Wer anders isst (others) oder „noch offen“: das Menü, das jemand kocht (wie cookedMeal in js/views/wochenplan.js)
function cookedMeal(meal, members) {
  if (!meal?.away && !meal?.undecided) return meal;
  const other = Object.entries(meal.others || {}).filter(([id]) => members.has(id)).map(([, c]) => c).find((c) => !c?.away);
  return other || meal;
}

function missingFor(meal, h, now = Date.now()) {
  const idea = h.ideas.find((i) => i.id === meal?.ideaId);
  const have = new Set([
    ...h.shopping.filter((i) => !i.done).map((i) => termKey(i.name)),
    ...h.shopping.filter((i) => i.done && (i.doneAt || 0) > now - RECENT_DAYS * 86400000).map((i) => termKey(i.name)),
    ...h.fridge.map((f) => termKey(f.name)),
  ]);
  return (idea?.ingredients || []).filter((line) => {
    const { name } = splitIngredient(line);
    return !isStaple(name) && !have.has(termKey(idea.glutenfree ? glutenFree(name) : name));
  }).map((line) => clip(splitIngredient(line).name, 40));
}
const titleOf = (meal, h) => clip(h.ideas.find((i) => i.id === meal?.ideaId)?.title || meal?.title || 'Menü', 60);

// Schweizer Tag als Datum (Mittag UTC: getDay und die Feiertage stimmen auch in UTC)
const asDate = (day) => new Date(`${day}T12:00:00Z`);

async function mealReminders() {
  const now = local();
  if (now.hour < MEAL_HOUR || now.hour >= MEAL_UNTIL) return { skipped: 'nicht zwischen 15 und 20 Uhr' };
  const subs = await db('push_subscriptions?select=household_key,endpoint,p256dh,auth');
  const byHousehold = new Map();
  for (const s of subs || []) {
    if (!byHousehold.has(s.household_key)) byHousehold.set(s.household_key, []);
    byHousehold.get(s.household_key).push(s);
  }
  if (!byHousehold.size) return { households: 0 };
  // Heute und die nächsten 4 Tage (Läden zu über mehrere Tage, z. B. Weihnachten)
  const days = Array.from({ length: 5 }, (_, i) => dateKey(addDays(asDate(now.day), i)));
  const keys = [...byHousehold.keys()].map((k) => `"${k.replace(/"/g, '')}"`).join(',');
  const rows = await db(`items?household_key=in.(${encodeURIComponent(keys)})&or=(collection.in.(ideas,shopping,fridge,members),and(collection.eq.plan,id.in.(${days.join(',')})))&select=household_key,collection,id,data`);
  const data = new Map();
  for (const r of rows || []) {
    if (!data.has(r.household_key)) data.set(r.household_key, { ideas: [], shopping: [], fridge: [], members: new Set(), plan: {} });
    const h = data.get(r.household_key);
    if (r.collection === 'plan') h.plan[r.id] = r.data || {};
    else if (r.collection === 'members') h.members.add(r.id);
    else h[r.collection].push(r.data || {});
  }
  let sent = 0;
  for (const [household, h] of data) {
    const messages = [];
    // Menü von heute (am Nachmittag: Abend, sonst Mittag)
    const entry = h.plan[now.day] || {};
    const slot = entry.abend ? 'abend' : entry.mittag ? 'mittag' : null;
    const meal = slot ? cookedMeal(entry[slot], h.members) : null;
    if (meal && !meal.undecided && !meal.away && !entry[slot].cooked) {
      const missing = missingFor(meal, h);
      if (missing.length) {
        messages.push({ ref: `meal:${now.day}:${slot}`, payload: {
          title: `${slot === 'abend' ? 'Znacht' : 'Zmittag'}: ${titleOf(meal, h)}`,
          body: `Es ${missing.length === 1 ? 'fehlt' : 'fehlen'}: ${list(missing.slice(0, 6))}${missing.length > 6 ? ' …' : ''}`,
          url: '#heute', tag: `meal-${now.day}`,
        } });
      }
    }
    // Morgen Sonntag/Feiertag (heute nicht): Menüs dieser Tage
    if (!shopsClosed(asDate(now.day))) {
      const closed = [];
      for (const d of days.slice(1)) { if (shopsClosed(asDate(d))) closed.push(d); else break; }
      if (closed.length) {
        const meals = closed.flatMap((d) => ['mittag', 'abend'].map((s) => h.plan[d]?.[s])).filter((m) => m && !m.away);
        const missing = [...new Set(meals.flatMap((m) => missingFor(m, h)))];
        const unknown = meals.filter((m) => !h.ideas.find((i) => i.id === m.ideaId)?.ingredients?.length);
        const name = (d) => holidayName(asDate(d)) || new Intl.DateTimeFormat('de-CH', { weekday: 'long', timeZone: 'UTC' }).format(asDate(d));
        const names = closed.length === 1 ? name(closed[0]) : `${name(closed[0])} bis ${name(closed.at(-1))}`;
        if (missing.length || unknown.length) {
          messages.push({ ref: `closed:${closed[0]}`, payload: {
            title: `Morgen ${names} · Läden zu`,
            body: missing.length ? `Heute noch einkaufen: ${list(missing.slice(0, 6))}${missing.length > 6 ? ' …' : ''}` : `An den Einkauf denken: ${list(meals.map((m) => titleOf(m, h)))}`,
            url: '#heute', tag: `closed-${closed[0]}`,
          } });
        }
      }
    }
    if (!messages.length) continue;
    const refs = messages.map((m) => `"${m.ref}"`).join(',');
    const done = new Set((await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=in.(${encodeURIComponent(refs)})&select=ref`)).map((r) => r.ref));
    for (const m of messages.filter((x) => !done.has(x.ref))) {
      const results = await Promise.all(byHousehold.get(household).map((s) => send(s, m.payload)));
      if (!results.some(Boolean)) continue; // später nochmals versuchen
      await db('push_sent', { method: 'POST', body: [{ household_key: household, ref: m.ref }], prefer: 'resolution=ignore-duplicates,return=minimal' });
      sent += 1;
    }
  }
  return { sent };
}

// ---------- Erinnerung vor einem ToDo (push_alarms, js/alarms.js) ----------
// Der Zeitplan läuft alle 5 Minuten: Was in den nächsten 4 Minuten fällig ist, geht jetzt raus – so kommt die
// Mitteilung höchstens ein paar Minuten zu früh statt zu spät. Älter als eine Stunde: verpasst, nicht mehr schicken.

async function alarmReminders() {
  const now = Date.now();
  const due = await db(`push_alarms?sent=eq.false&at=lte.${encodeURIComponent(new Date(now + 4 * 60000).toISOString())}&at=gte.${encodeURIComponent(new Date(now - 3600000).toISOString())}&select=household_key,id,member_id,title,body,url&limit=200`);
  let sent = 0;
  for (const a of due || []) {
    const member = a.member_id ? `&member_id=eq.${encodeURIComponent(a.member_id)}` : '';
    const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(a.household_key)}${member}&select=endpoint,p256dh,auth`);
    const payload = { title: `⏰ ${clip(a.title, 80)}`, body: clip(a.body, 120), url: /^#[a-z]+(\/[a-z]+\/[a-z0-9]+)?$/i.test(a.url || '') ? a.url : '#todo', tag: `alarm-${a.id}` };
    const results = subs?.length ? await Promise.all(subs.map((s) => send(s, payload))) : [];
    // Kein Gerät angemeldet: trotzdem als erledigt merken, sonst würde es bei jedem Lauf wieder versucht
    if (subs?.length && !results.some(Boolean)) continue;
    await db(`push_alarms?household_key=eq.${encodeURIComponent(a.household_key)}&id=eq.${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { sent: true }, prefer: 'return=minimal' });
    if (results.some(Boolean)) sent += 1;
  }
  // Verschickte nach einer Woche löschen (bei persönlichen ToDos stehen Titel drin)
  await db(`push_alarms?sent=eq.true&at=lt.${encodeURIComponent(new Date(now - 7 * 86400000).toISOString())}`, { method: 'DELETE' });
  return { sent };
}

async function reminders() {
  return { alarm: await alarmReminders(), todo: await todoReminders(), eve: await eveReminders(), waste: await wasteReminders(), meal: await mealReminders(), fridge: await fridgeReminders(), take: await takeReminders(), idea: await ideaReminders() };
}

async function test(household, body) {
  const endpoint = String(body?.endpoint || '');
  const subs = await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&household_key=eq.${encodeURIComponent(household)}&select=endpoint,p256dh,auth,household_key,todo_scope,todo_list,todo_name,todo_items`);
  if (!subs?.length) return json({ error: 'Dieses Gerät ist für Mitteilungen nicht angemeldet.' }, 404);
  if (body?.kind === 'todo') {
    // Morgen-Erinnerung jetzt, so wie sie heute aussähe
    const sub = subs[0];
    if (!sub.todo_list) return json({ error: 'Die Morgen-Erinnerung ist auf diesem Gerät nicht eingerichtet.' }, 400);
    const content = await todoContent(sub, new Map());
    if (!content) return json({ error: 'Die gewählte Liste gibt es nicht mehr.' }, 404);
    const payload = todoPayload(sub, content, local().day);
    if (!payload) return json({ empty: true });
    return (await send(sub, payload)) ? json({ ok: true }) : json({ error: 'Der Push-Dienst hat die Mitteilung nicht angenommen.' }, 502);
  }
  const ok = await send(subs[0], { title: 'Haushalt', body: 'Mitteilungen funktionieren 🎉', url: '#kuehlschrank', tag: 'test' });
  return ok ? json({ ok: true }) : json({ error: 'Der Push-Dienst hat die Mitteilung nicht angenommen.' }, 502);
}

// ---------- ToDo zugewiesen ----------

const ASSIGN_PAUSE_MS = 10 * 60 * 1000; // dasselbe ToDo an dieselbe Person höchstens alle 10 Minuten melden
const fmtDay = (day) => new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

async function item(household, collection, id) {
  if (!id) return null;
  const rows = await db(`items?household_key=eq.${encodeURIComponent(household)}&collection=eq.${collection}&id=eq.${encodeURIComponent(id)}&select=data`);
  return rows?.[0]?.data || null;
}

async function assigned(household, body) {
  const todoId = String(body?.assigned || '').slice(0, 64);
  const byId = String(body?.by || '').slice(0, 64);
  const todo = await item(household, 'todos', todoId);
  if (!todo?.assignee || todo.done) return json({ skipped: 'nicht (mehr) zugewiesen' });
  if (todo.assignee === byId) return json({ skipped: 'sich selbst zugewiesen' });
  const ref = `assign:${todoId}:${todo.assignee}`;
  const recent = await db(`push_sent?household_key=eq.${encodeURIComponent(household)}&ref=eq.${encodeURIComponent(ref)}&sent_at=gt.${new Date(Date.now() - ASSIGN_PAUSE_MS).toISOString()}&select=ref`);
  if (recent?.length) return json({ skipped: 'eben schon gemeldet' });
  const subs = await db(`push_subscriptions?household_key=eq.${encodeURIComponent(household)}&member_id=eq.${encodeURIComponent(todo.assignee)}&select=endpoint,p256dh,auth`);
  if (!subs?.length) return json({ skipped: 'Person hat keine Mitteilungen eingeschaltet' });
  const [by, list] = await Promise.all([item(household, 'members', byId), item(household, 'todolists', todo.listId)]);
  const when = todo.due ? ` · ${fmtDay(todo.due)}${todo.time ? `, ${todo.time}` : ''}` : '';
  const payload = {
    title: list?.name ? `ToDo · ${String(list.name).slice(0, 40)}` : 'ToDo',
    body: `${by?.name ? `${String(by.name).slice(0, 30)} hat dir` : 'Dir wurde'} „${String(todo.title || '').slice(0, 80)}“ zugewiesen${when}`,
    url: /^[a-z0-9]+$/i.test(todo.listId || '') ? `#todo/shared/${todo.listId}` : '#todo', // öffnet die Liste
    tag: `assign-${todoId}`,
  };
  const results = await Promise.all(subs.map((s) => send(s, payload)));
  if (!results.some(Boolean)) return json({ error: 'Der Push-Dienst hat die Mitteilung nicht angenommen.' }, 502);
  await db('push_sent', { method: 'POST', body: [{ household_key: household, ref, sent_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
  return json({ ok: true });
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nicht erlaubt' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    // Aufrufe aus der App: nur mit Haushalt-Schlüssel und richtigem Zugangscode
    if (req.headers.get('x-hh-key')) {
      const household = await householdOk(req);
      if (!household) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);
      if (body?.assigned) return await assigned(household, body);
      return await test(household, body);
    }
    if (body?.run === 'reminders') return json(await reminders());
    return json({ error: 'unbekannter Auftrag' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(handle);
