// Persönliche ToDo-Listen: liegen auf diesem Gerät (localStorage), getrennt pro Haushalt und pro Person
// („Wer bist du?“), damit jemand anderes, der sich am selben Gerät anmeldet, sie nicht sieht. Nie in der Sicherung.
//   lists [{ id, name, createdAt }]
//   todos [{ id, listId, title, note, done, due?, time?, addedAt }]
//
// Auf mehreren eigenen Geräten abgleichen (freiwillig, nur im gemeinsamen Haushalt): Die Listen gehen dann
// verschlüsselt in die Datenbank – als eine Zeile (collection 'private', id 'p_<Person>'). Verschlüsselt wird hier
// im Browser mit einem eigenen Passwort (PBKDF2 → AES-GCM, Web Crypto); die Datenbank und die anderen im Haushalt
// sehen nur unlesbaren Text. Das Passwort selbst wird nirgends gespeichert, nur der daraus abgeleitete Schlüssel
// auf den eigenen Geräten (dort liegen die Listen ohnehin lesbar). Bei gleichzeitigen Änderungen auf zwei
// Geräten gilt die zuletzt gespeicherte Fassung.

import { refresh, session, setRowsListener, sharedRemote } from './store.js';
import { myMemberId } from './session.js';

const PREFIX = 'haushalt.personal.';
const SYNC_PREFIX = 'haushalt.personalSync.';
const COLLECTION = 'private';
const ITERATIONS = 310000;

const owner = () => (session.mode === 'shared' ? `${session.key}.${myMemberId(session.key) || 'ohne-person'}` : 'local');
const storageKey = () => PREFIX + owner();
const syncKey = () => SYNC_PREFIX + owner();
const rowId = () => `p_${myMemberId(session.key)}`.slice(0, 64);

let loadedKey = null;
let data = { lists: [], todos: [] };

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn('Haushalt: persönliche Daten konnten nicht gespeichert werden');
  }
}

const clean = (saved) => ({
  lists: Array.isArray(saved?.lists) ? saved.lists : [],
  todos: Array.isArray(saved?.todos) ? saved.todos : [],
});

function load() {
  const key = storageKey();
  if (key === loadedKey) return;
  loadedKey = key;
  data = clean(readJson(key));
}

// Immer über diese Funktion lesen: nach einem Personenwechsel gehört der Speicher jemand anderem
export function personal() {
  load();
  return data;
}

export function updatePersonal(fn) {
  load();
  fn(data);
  writeJson(loadedKey, data);
  refresh('local');
  if (syncSettings()) scheduleUpload();
}

// ---------- Verschlüsselter Abgleich ----------

// { key: Base64 (AES-Schlüssel), salt: Base64, syncedAt: Zeitpunkt der zuletzt übernommenen/hochgeladenen Fassung }
const syncSettings = () => (session.mode === 'shared' && myMemberId(session.key) ? readJson(syncKey()) : null);
export const syncEnabled = () => Boolean(syncSettings());
export const syncAvailable = () => session.mode === 'shared' && Boolean(myMemberId(session.key));

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
const importKey = (b64) => crypto.subtle.importKey('raw', fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function encrypt(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function decrypt(key, row) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(row.iv) }, key, fromB64(row.ct));
  return clean(JSON.parse(new TextDecoder().decode(plain)));
}

let syncLost = false; // Abgleich wurde wegen neuem Passwort beendet → Hinweis in der Ansicht
export const syncWasLost = () => syncLost;
let latestRow = null; // zuletzt aus der Datenbank gesehene eigene Zeile
let uploadTimer = null;
let dirty = false;

async function upload() {
  const settings = syncSettings();
  const remote = sharedRemote();
  if (!settings || !remote) return; // offline: die nächste Änderung oder der nächste Abgleich versucht es erneut
  load();
  const updatedAt = Date.now();
  const box = await encrypt(await importKey(settings.key), data);
  try {
    await remote.upsert([{ collection: COLLECTION, id: rowId(), data: { v: 1, salt: settings.salt, ...box, updatedAt } }]);
    dirty = false;
    writeJson(syncKey(), { ...settings, syncedAt: updatedAt });
  } catch {
    // z. B. Datenbank noch ohne 'private' (schema.sql) – bleibt markiert und wird später nochmals versucht
  }
}

function scheduleUpload() {
  dirty = true;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(upload, 800);
}

// Bei jedem Abgleich mit der Datenbank: neuere Fassung von einem anderen Gerät übernehmen
setRowsListener(async (rows) => {
  if (!syncAvailable()) return;
  latestRow = rows.find((r) => r.collection === COLLECTION && r.id === rowId())?.data || null;
  const settings = syncSettings();
  if (!settings) return;
  if (dirty) return upload();
  if (!latestRow || latestRow.updatedAt <= (settings.syncedAt || 0)) {
    if (!latestRow) scheduleUpload(); // Zeile fehlt (z. B. erst jetzt schema.sql ausgeführt): hochladen
    return;
  }
  try {
    const next = await decrypt(await importKey(settings.key), latestRow);
    load();
    data = next;
    writeJson(loadedKey, data);
    writeJson(syncKey(), { ...settings, syncedAt: latestRow.updatedAt });
    refresh('remote');
  } catch {
    // Passwort wurde auf einem anderen Gerät neu gesetzt: hier nicht mehr lesbar → Abgleich auf diesem Gerät aus
    writeJson(syncKey(), null);
    syncLost = true;
    refresh('local');
  }
});

// Abgleich einschalten. Gibt es schon eine Fassung von einem anderen Gerät, muss das Passwort dazu passen;
// die Listen beider Geräte werden dann zusammengeführt. replace: true = alte Fassung verwerfen (Passwort vergessen).
export async function enableSync(password, { replace = false } = {}) {
  const remote = sharedRemote();
  if (!remote) throw new Error('Gerade keine Verbindung – später nochmals versuchen.');
  const rows = await remote.loadAll();
  const row = rows.find((r) => r.collection === COLLECTION && r.id === rowId())?.data;
  load();
  if (row && !replace) {
    const key = await deriveKey(password, fromB64(row.salt));
    let other;
    try {
      other = await decrypt(key, row);
    } catch {
      const err = new Error('Das Passwort passt nicht zu den Listen auf deinem anderen Gerät.');
      err.wrongPassword = true;
      throw err;
    }
    // Zusammenführen: alles von beiden Geräten, bei gleichen Einträgen gilt dieses Gerät
    const merge = (mine, theirs) => [...mine, ...theirs.filter((x) => !mine.some((y) => y.id === x.id))];
    data = { lists: merge(data.lists, other.lists), todos: merge(data.todos, other.todos) };
    writeJson(loadedKey, data);
    writeJson(syncKey(), { key: toB64(await crypto.subtle.exportKey('raw', key)), salt: row.salt, syncedAt: 0 });
  } else {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    writeJson(syncKey(), { key: toB64(await crypto.subtle.exportKey('raw', key)), salt: toB64(salt), syncedAt: 0 });
  }
  syncLost = false;
  dirty = true;
  await upload();
  if (dirty) throw new Error('Hochladen fehlgeschlagen – ist supabase/schema.sql auf dem neuesten Stand (ANLEITUNG.md)?');
  refresh('local');
}

// Abgleich ausschalten: Listen bleiben auf diesem Gerät; removeRemote löscht die verschlüsselte Fassung in der Datenbank
export async function disableSync({ removeRemote = false } = {}) {
  clearTimeout(uploadTimer);
  dirty = false;
  if (removeRemote) await sharedRemote()?.remove({ [COLLECTION]: [rowId()] });
  writeJson(syncKey(), null);
  refresh('local');
}

// Gibt es schon eine Fassung von einem anderen Gerät? (für den Text im Einrichten-Fenster)
export const remoteCopyExists = () => Boolean(latestRow);
