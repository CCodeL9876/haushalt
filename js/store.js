// Daten des Haushalts. Die Ansichten arbeiten nur mit state, update() und subscribe() – wo die Daten liegen,
// entscheidet diese Datei:
//  - lokal: nur in diesem Browser (localStorage), solange Supabase nicht eingerichtet ist (js/config.js)
//  - gemeinsam: in Supabase (js/remote.js). Nach jeder Änderung werden nur die geänderten Einträge
//    hochgeladen; was andere Geräte geändert haben, holt pull() regelmässig ab.
//
// Aufbau des Datensatzes:
//   members   [{ id, name, color, createdAt }]
//   shopping  [{ id, name, qty?, meals?, note, done, doneAt?, addedAt, star? }]   star: als wichtig markiert (steht zuoberst)
//             qty: Menge („2×“, „500 g“), doneAt: wann abgehakt (nach 30 Tagen gelöscht, js/cleanup.js)
//             meals?: [{ day, title }] Menüs im Wochenplan, für die der Artikel gebraucht wird (ausblenden bis …)
//   terms     [{ id, name, count, lastUsed, aisle?, bought?, snooze? }]   Begriffe für die Vorschläge beim Einkauf: jeder Artikel, der
//             einmal auf der Liste war; id = Name klein geschrieben (termKey), damit jeder Begriff nur einmal vorkommt.
//             aisle: von Hand gewählte Abteilung im Laden (sonst am Namen erkannt, siehe js/aisles.js)
//             bought: Zeitpunkte der letzten 6 Einkäufe, snooze: „Wieder mal?“ weggetippt bis (js/views/einkauf.js)
//   ideas     [{ id, title, ingredients: [text], steps?: [text], tags: [text], note, url? }]   url: Link zum Rezept (Einlesen: js/recipes.js)
//   plan      { 'JJJJ-MM-TT': { mittag: { title, ideaId, away? }, abend: { … } } }   away: Platzhalter „Nicht zuhause“ (kein Kochen)
//   expenses  [{ id, kind: 'expense' | 'transfer', title, note?, amount (Rappen/Cent), payerId, splitIds, method?, category, date, createdAt? }]
//             Rechnung (expense): payerId hat bezahlt, splitIds tragen es. Zahlung (transfer): payerId zahlt splitIds[0].
//             method: Zahlungsart (Twint, Neon …), note: was die Rechnung/Zahlung beinhaltet (js/views/abrechnung.js)
//   settings  { currency, categories, methods, aisleOrder?, fridgeDays?, wasteOut? }   methods: Zahlungsarten in der Abrechnung   aisleOrder: Reihenfolge der Abteilungen im Laden
//             fridgeDays: { 'pesto': 5 } zuletzt gewählte Haltbarkeit im Kühlschrank (js/fridge.js)
//             wasteOut: 'JJJJ-MM-TT' Abfuhr dieses Tages ist rausgestellt („Jetzt wichtig“ auf der Startseite)
//   todolists [{ id, name, createdAt }]                 geteilte ToDo-Listen (persönliche: js/personal.js, nie hier)
//   todos     [{ id, listId, title, note, done, doneAt?, due?, time?, assignee?, addedAt }]   due 'JJJJ-MM-TT', time 'HH:MM', assignee = members.id
//             doneAt: wann abgehakt (nach 2 Tagen ausgeblendet, nach 30 Tagen gelöscht)
//             repeat?: { every, unit } oder { dates }, remind?: am Vortag erinnern (js/repeat.js)
//             order?: selbst gewählte Reihenfolge in der Liste (sonst nach Datum), alarm?: Minuten vorher erinnern
//   fridge    [{ id, name, useBy, addedAt, from?, idea? }]   Reste im Kühlschrank: useBy 'JJJJ-MM-TT' = aufbrauchen bis, from = Gericht, idea = Menüidee (Morgen-Mitteilung)
// In der Datenbank ist jeder Eintrag eine Zeile (collection + id); plan je Tag, settings als eine Zeile „main“.

import { todayKey } from './dates.js';
import { AccessError } from './remote.js';

const LOCAL_KEY = 'haushalt.v1';
const CACHE_PREFIX = 'haushalt.cache.';
const LIST_COLLECTIONS = ['members', 'shopping', 'terms', 'ideas', 'expenses', 'todolists', 'todos', 'fridge'];

// Dunkle Töne aus Lila, Oliv und Lavendel – weisse Initialen bleiben darauf lesbar
export const MEMBER_COLORS = ['#8A35C2', '#6B6728', '#4B2F80', '#5E5AB8', '#55531F', '#A23FB0'];
export const DEFAULT_METHODS = ['Twint', 'Neon', 'Banküberweisung', 'Bar'];
export const DEFAULT_CATEGORIES = ['Lebensmittel', 'Haushalt', 'Wohnen', 'Freizeit', 'Sonstiges'];

// Schlüssel eines Begriffs: klein geschrieben, ohne Leerzeichen am Rand (höchstens 64 Zeichen, siehe schema.sql)
export const termKey = (name) => String(name || '').trim().toLowerCase().slice(0, 64);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function empty() {
  return {
    members: [],
    shopping: [],
    terms: [],
    ideas: [],
    plan: {},
    expenses: [],
    todolists: [],
    todos: [],
    fridge: [],
    settings: { currency: 'CHF', categories: [...DEFAULT_CATEGORIES], methods: [...DEFAULT_METHODS] },
  };
}

// Ohne Supabase beim allerersten Start ein paar Beispiele, damit jede Ansicht etwas zeigt.
function sample() {
  const data = empty();
  const a = { id: uid(), name: 'Anna', color: MEMBER_COLORS[0], createdAt: Date.now() };
  const b = { id: uid(), name: 'Ben', color: MEMBER_COLORS[1], createdAt: Date.now() + 1 };
  data.members = [a, b];
  data.shopping = ['Milch', 'Brot', 'Äpfel'].map((name) => ({ id: uid(), name, note: '', done: false, addedAt: Date.now() }));
  data.terms = ['Milch', 'Brot', 'Äpfel', 'Butter', 'Eier', 'Kaffee', 'Bananen', 'Joghurt']
    .map((name, i) => ({ id: termKey(name), name, count: 8 - i, lastUsed: Date.now() - i * 86400000 }));
  data.ideas = [
    { id: uid(), title: 'Spaghetti Bolognese', ingredients: ['Spaghetti', 'Hackfleisch', 'Tomaten passiert', 'Zwiebel', 'Parmesan'], tags: ['Pasta', 'Klassiker'], note: '' },
    { id: uid(), title: 'Gemüsecurry', ingredients: ['Kokosmilch', 'Currypaste', 'Reis', 'Peperoni', 'Zucchetti'], tags: ['Vegi', 'Schnell'], note: '' },
    { id: uid(), title: 'Älplermagronen', ingredients: ['Magronen', 'Kartoffeln', 'Rahm', 'Käse', 'Apfelmus'], tags: ['Klassiker'], note: 'Mit Röstzwiebeln!' },
  ];
  const today = todayKey();
  const list = { id: uid(), name: 'Haushalt', createdAt: Date.now() };
  data.todolists = [list];
  data.todos = [
    { id: uid(), listId: list.id, title: 'Altpapier rausstellen', note: '', done: false, due: today, time: '', addedAt: Date.now() },
    { id: uid(), listId: list.id, title: 'Steuererklärung', note: '', done: false, due: '', time: '', addedAt: Date.now() - 1 },
  ];
  data.expenses = [
    { id: uid(), kind: 'expense', title: 'Wocheneinkauf', note: 'Wocheneinkauf', amount: 8640, payerId: a.id, splitIds: [a.id, b.id], method: 'Twint', category: 'Lebensmittel', date: today },
    { id: uid(), kind: 'expense', title: 'Putzmittel', note: 'Putzmittel', amount: 1890, payerId: b.id, splitIds: [a.id, b.id], method: 'Bar', category: 'Haushalt', date: today },
  ];
  return data;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Fehlende Felder (ältere oder importierte Stände) mit leeren Werten auffüllen.
function normalize(saved) {
  const base = empty();
  if (!saved || typeof saved !== 'object') return base;
  return {
    members: Array.isArray(saved.members) ? saved.members : base.members,
    shopping: Array.isArray(saved.shopping) ? saved.shopping : base.shopping,
    terms: Array.isArray(saved.terms) ? saved.terms : base.terms,
    ideas: Array.isArray(saved.ideas) ? saved.ideas : base.ideas,
    plan: saved.plan && typeof saved.plan === 'object' ? saved.plan : base.plan,
    expenses: Array.isArray(saved.expenses) ? saved.expenses : base.expenses,
    todolists: Array.isArray(saved.todolists) ? saved.todolists : base.todolists,
    todos: Array.isArray(saved.todos) ? saved.todos : base.todos,
    fridge: Array.isArray(saved.fridge) ? saved.fridge : base.fridge,
    settings: { ...base.settings, ...(saved.settings || {}) },
  };
}

// JSON mit sortierten Schlüsseln: Die Datenbank (jsonb) ordnet Schlüssel um, der Vergleich soll das ignorieren.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function toRows(data) {
  const rows = new Map();
  for (const c of LIST_COLLECTIONS) for (const item of data[c]) rows.set(`${c}/${item.id}`, { collection: c, id: item.id, data: item });
  for (const [day, entry] of Object.entries(data.plan)) rows.set(`plan/${day}`, { collection: 'plan', id: day, data: entry });
  rows.set('settings/main', { collection: 'settings', id: 'main', data: data.settings });
  return rows;
}

function fromRows(rows) {
  const data = empty();
  for (const r of rows) {
    if (LIST_COLLECTIONS.includes(r.collection)) data[r.collection].push(r.data);
    else if (r.collection === 'plan') data.plan[r.id] = r.data;
    else if (r.collection === 'settings') data.settings = { ...data.settings, ...r.data };
  }
  // Die Datenbank liefert ohne feste Reihenfolge
  data.members.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name, 'de'));
  data.shopping.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  data.todolists.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return data;
}

const signatures = (data) => new Map([...toRows(data)].map(([k, r]) => [k, stable(r.data)]));
const sameSignatures = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

// ---------- Zustand ----------

export const state = empty();
// mode: 'local' | 'shared'; offline: letzter Abgleich mit der Datenbank fehlgeschlagen
export const session = { mode: 'local', key: null, name: 'Haushalt', offline: false };

let remote = null;
let synced = new Map(); // Stand, den die Datenbank kennt: 'collection/id' → stable(data)
let queue = Promise.resolve(true);
let version = 0; // zählt lokale Änderungen – ein Abgleich, der währenddessen lief, wird verworfen
let onSyncError = () => {};
// Wer alle Zeilen der Datenbank sehen will (z. B. verschlüsselte persönliche Listen, js/personal.js)
let onRows = () => {};
export const setRowsListener = (fn) => { onRows = fn; };
// Direkter Zugriff auf die Datenbank für Zeilen ausserhalb von state (nur im gemeinsamen Haushalt)
export const sharedRemote = () => (session.mode === 'shared' && !session.offline ? remote : null);
export const setSyncErrorHandler = (fn) => { onSyncError = fn; };

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);

// Neu zeichnen. source: 'local' (eigene Änderung) oder 'remote' (Änderung von einem anderen Gerät)
export const refresh = (source = 'local') => listeners.forEach((l) => l(source));

export function startLocal() {
  const saved = readJson(LOCAL_KEY);
  Object.assign(state, saved ? normalize(saved) : sample());
  if (!saved) writeJson(LOCAL_KEY, state);
  session.mode = 'local';
}

const cacheKey = () => CACHE_PREFIX + session.key;
const saveCache = () => writeJson(cacheKey(), { name: session.name, state, synced: [...synced] });
export const hasCache = (key) => Boolean(readJson(CACHE_PREFIX + key));
export const cachedName = (key) => readJson(CACHE_PREFIX + key)?.name || 'Haushalt';

// Gemeinsamer Haushalt: Daten aus der Datenbank laden (offline: letzter gespeicherter Stand dieses Geräts).
export async function startShared(r, name, { offline = false } = {}) {
  remote = r;
  Object.assign(session, { mode: 'shared', key: r.key, name, offline });
  if (offline) {
    const cached = readJson(cacheKey());
    Object.assign(state, normalize(cached?.state));
    synced = new Map(cached?.synced || []);
    return;
  }
  const rows = await remote.loadAll();
  Object.assign(state, fromRows(rows));
  synced = signatures(state);
  saveCache();
  onRows(rows);
}

// Lokale Änderungen hochladen (nacheinander, nie zwei gleichzeitig). Ergibt true, wenn alles oben ist.
function flush() {
  queue = queue.then(async () => {
    const now = toRows(state);
    const nowSig = new Map([...now].map(([k, r]) => [k, stable(r.data)]));
    const upserts = [...now].filter(([k]) => synced.get(k) !== nowSig.get(k)).map(([, r]) => r);
    const removals = {};
    for (const k of synced.keys()) {
      if (nowSig.has(k)) continue;
      const [collection, ...id] = k.split('/');
      (removals[collection] ||= []).push(id.join('/'));
    }
    if (!upserts.length && !Object.keys(removals).length) return true;
    try {
      // Neuere Sammlungen (ToDo, Kühlschrank) in eigener Anfrage zuletzt: Ist die Datenbank noch nicht auf dem
      // neuen Stand (schema.sql), scheitert nur diese – alles andere ist dann schon oben
      const late = (r) => ['todolists', 'todos', 'fridge'].includes(r.collection);
      await remote.upsert(upserts.filter((r) => !late(r)));
      await remote.upsert(upserts.filter(late));
      await remote.remove(removals);
      synced = nowSig;
      session.offline = false;
      saveCache();
      return true;
    } catch (err) {
      // Nicht als hochgeladen markieren: Die nächste Änderung oder der nächste Abgleich versucht es erneut
      session.offline = true;
      saveCache();
      onSyncError(err);
      return false;
    }
  });
  return queue;
}

// Warten, bis eigene Änderungen oben sind (z. B. bevor die App eine andere Adresse öffnet und laufende
// Anfragen abbrechen würde). Lokal sofort fertig.
export const flushNow = () => (session.mode === 'shared' ? flush() : Promise.resolve(true));

// Jede Änderung läuft hierüber: ändern, speichern, Ansicht neu zeichnen.
export function update(fn) {
  fn(state);
  version += 1;
  if (session.mode === 'local') {
    if (!writeJson(LOCAL_KEY, state)) console.warn('Haushalt: Speichern im Browser fehlgeschlagen');
  } else {
    saveCache();
    flush();
  }
  refresh('local');
}

// Änderungen der anderen Geräte holen. Eigene, noch nicht hochgeladene Änderungen gehen vorher hoch.
export async function pull() {
  if (session.mode !== 'shared') return;
  if (!(await flush())) return;
  const before = version;
  let rows;
  try {
    rows = await remote.loadAll();
    // Ohne gültigen Code liefert die Datenbank einfach nichts – also prüfen, bevor alles leer erscheint
    if (!rows.length && synced.size > 1) await remote.login();
  } catch (err) {
    if (err instanceof AccessError) return onSyncError(err); // Code wurde auf einem anderen Gerät geändert
    session.offline = true;
    return;
  }
  session.offline = false;
  onRows(rows);
  if (version !== before) return; // inzwischen lokal geändert → beim nächsten Abgleich
  const next = fromRows(rows);
  const nextSig = signatures(next);
  const changed = !sameSignatures(nextSig, signatures(state));
  synced = nextSig;
  if (!changed) return;
  Object.assign(state, next);
  saveCache();
  refresh('remote');
}

// keepEndpoint: Push-Adresse dieses Geräts – bleibt für Mitteilungen angemeldet, alle anderen nicht
export const changeCode = (newCode, keepEndpoint) => remote.setCode(newCode, keepEndpoint);

export function replaceAll(data) {
  update((s) => Object.assign(s, normalize(data)));
}

export const resetAll = () => replaceAll(empty());

export const memberById = (id) => state.members.find((m) => m.id === id);
