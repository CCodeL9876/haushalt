// Supabase Edge Function „calendar“: bringt ein ToDo in den Apple-Kalender.
//
// Das iPhone bietet „Zum Kalender hinzufügen“ nur an, wenn eine Kalenderdatei (.ics) von einem Server kommt –
// eine in der App erzeugte Datei behandelt Safari als gewöhnlichen Download. Darum zwei Schritte:
//  1. POST (von der App, mit Haushalt-Schlüssel und Zugangscode): { ics } → { url }. Die Kalenderdatei wird
//     verschlüsselt in die Adresse gepackt (AES-GCM, gültig 10 Minuten) – so stehen Titel und Notiz nirgends lesbar
//     in Adressen oder Protokollen, und nur der eigene Haushalt kann solche Adressen erzeugen.
//  2. GET ?t=… (die App öffnet diese Adresse): entschlüsseln und als text/calendar zurückgeben → Safari zeigt die
//     Vorschau mit „Hinzufügen“.
// Gespeichert wird nichts. Der Schlüssel für die Verschlüsselung wird aus dem Secret SUPABASE_SERVICE_ROLE_KEY
// abgeleitet, das Supabase jeder Funktion mitgibt (oder aus CALENDAR_SECRET, falls gesetzt).
// Einrichtung: ANLEITUNG.md, Abschnitt „Apple-Kalender“ (JWT-Prüfung aus – die Adresse in Schritt 2 öffnet Safari
// ohne Zusatzangaben).

const VALID_MS = 10 * 60 * 1000;
const MAX_ICS = 8000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hh-key, x-hh-code',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let keyPromise = null;
function secretKey() {
  keyPromise ||= (async () => {
    const secret = Deno.env.get('CALENDAR_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret) throw new Error('kein Secret');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('haushalt-calendar'), info: new Uint8Array() },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  })();
  return keyPromise;
}

// Stimmen Schlüssel und Code? Dieselbe Prüfung wie bei der Anmeldung in der App (household_login, schema.sql).
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

async function createLink(req) {
  if (!(await householdOk(req))) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);
  let ics = '';
  try {
    ics = String((await req.json())?.ics || '');
  } catch {
    return json({ error: 'ungültige Anfrage' }, 400);
  }
  if (!ics.startsWith('BEGIN:VCALENDAR') || !ics.trimEnd().endsWith('END:VCALENDAR') || ics.length > MAX_ICS) {
    return json({ error: 'Das ist keine gültige Kalenderdatei.' }, 400);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ ics, exp: Date.now() + VALID_MS }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretKey(), plain));
  const token = b64url(new Uint8Array([...iv, ...ct]));
  return json({ url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/calendar?t=${token}` });
}

async function serveIcs(token) {
  let data;
  try {
    const raw = fromB64url(token);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await secretKey(), raw.slice(12));
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return text('Dieser Kalender-Link ist ungültig.', 400);
  }
  if (!data?.ics || Date.now() > data.exp) return text('Dieser Kalender-Link ist abgelaufen – in der App nochmals „In Apple-Kalender eintragen“ wählen.', 410);
  return new Response(data.ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="termin.ics"',
      'Cache-Control': 'no-store',
    },
  });
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'POST') return await createLink(req);
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('t') || '';
      return token.length > 20 && token.length < 20000 ? await serveIcs(token) : text('Kein Termin angegeben.', 400);
    }
    return json({ error: 'nicht erlaubt' }, 405);
  } catch {
    return json({ error: 'In Supabase fehlt ein Secret für die Verschlüsselung (ANLEITUNG.md).' }, 500);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(handle);
