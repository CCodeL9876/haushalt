// Push-Mitteilungen auf diesem Gerät (z. B. Erinnerungen an Reste im Kühlschrank).
// Einschalten: Erlaubnis fragen → beim Push-Dienst des Browsers anmelden („Abo“) → Abo in Supabase speichern
// (push_subscribe, schema.sql). Verschickt wird von der Supabase-Funktion „push“; angezeigt vom Service Worker (sw.js).
// Am iPhone nur in der App vom Home-Bildschirm (ab iOS 16.4), nicht in Safari selbst.

import { PUSH_PUBLIC_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { session } from './store.js';
import { loadSession } from './session.js';

const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Im gemeinsamen Haushalt mit eingerichtetem Schlüssel
export const pushConfigured = () => Boolean(PUSH_PUBLIC_KEY && SUPABASE_URL && SUPABASE_ANON_KEY && session.mode === 'shared');
// Kann dieser Browser überhaupt Push?
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

function headers() {
  const { key, code } = loadSession();
  const h = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-hh-key': key || '', 'x-hh-code': code || '' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  return h;
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (res.status === 404) throw new Error('Die Datenbank kennt Mitteilungen noch nicht – schema.sql nochmals ausführen (ANLEITUNG.md).');
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `Fehler ${res.status}`);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const save = (sub, memberId) => {
  const j = sub.toJSON();
  return rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_member: memberId || '' });
};

// Muss direkt aus einem Antippen kommen (sonst fragt das iPhone nicht nach der Erlaubnis)
export async function enablePush(memberId) {
  const answer = await Notification.requestPermission();
  if (answer !== 'granted') {
    throw new Error(answer === 'denied'
      ? 'Mitteilungen sind für diese App ausgeschaltet. Am iPhone: Einstellungen → Mitteilungen → Haushalt → erlauben.'
      : 'Mitteilungen wurden nicht erlaubt.');
  }
  // Ohne Service Worker (z. B. nicht über https) würde ready nie fertig
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Die App ist noch nicht bereit – bitte neu laden und nochmals versuchen.')), 15000)),
  ]);
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(PUSH_PUBLIC_KEY) }));
  try {
    await save(sub, memberId);
  } catch (err) {
    // Supabase kennt das Gerät nicht → auch hier wieder abmelden, sonst stünde „eingeschaltet“ da
    if (!existing) await sub.unsubscribe().catch(() => {});
    throw err;
  }
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await rpc('push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

// Probe-Mitteilung an dieses Gerät
export async function testPush() {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Mitteilungen sind auf diesem Gerät nicht eingeschaltet.');
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/push`, { method: 'POST', headers: headers(), body: JSON.stringify({ test: true, endpoint: sub.endpoint }), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('Keine Verbindung – später nochmals versuchen.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 && !data?.error) throw new Error('Die Funktion „push“ ist in Supabase noch nicht eingerichtet (ANLEITUNG.md).');
  if (res.status === 401) throw new Error('Supabase lehnt ab – bei „push“ die JWT-Prüfung ausschalten (ANLEITUNG.md).');
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
}

// Beim Start: Ist dieses Gerät angemeldet, das Abo in Supabase auffrischen (falls es dort fehlt oder der
// Browser es erneuert hat). Still – Fehler stören hier nicht.
export async function refreshPush(memberId) {
  if (!pushConfigured() || permission() !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (sub) await save(sub, memberId);
  } catch { /* beim nächsten Start wieder */ }
}
