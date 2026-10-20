// Supabase Edge Function „push“: verschickt Push-Mitteilungen an die Geräte eines Haushalts.
//
//  - POST { run: 'reminders' } – vom Zeitplan (supabase/push-cron.sql), alle 5 Minuten:
//    · Morgen-Erinnerung: pro Gerät zur gewählten Uhrzeit und an den gewählten Wochentagen die offenen ToDos einer
//      Liste (fällig bis heute oder ohne Datum). Ist nichts offen, kommt keine Mitteilung.
//    · Kühlschrank: ab 17 Uhr (Schweizer Zeit) Reste am Vortag („bis morgen aufbrauchen“) und am letzten Tag („heute“).
//    Jede Erinnerung nur einmal (Tabelle push_sent). Ohne Fälliges passiert nichts – darum ohne Anmeldung.
//  - POST { test: true, endpoint, kind? } – von der App (mit Haushalt-Schlüssel und Zugangscode): Probe an dieses
//    Gerät; kind 'todo' schickt die Morgen-Erinnerung so, wie sie jetzt aussähe.
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

async function reminders() {
  return { todo: await todoReminders(), fridge: await fridgeReminders() };
}

async function test(req) {
  const household = await householdOk(req);
  if (!household) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);
  const body = await req.json().catch(() => ({}));
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

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nicht erlaubt' }, 405);
  try {
    if (req.headers.get('x-hh-key')) return await test(req);
    const body = await req.json().catch(() => ({}));
    if (body?.run === 'reminders') return json(await reminders());
    return json({ error: 'unbekannter Auftrag' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(handle);
