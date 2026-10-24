// Persönliche Finanzplanung (Geld → Planung): Kosten, Rechnungen, Abos und Einnahmen.
// Datenschutz: liegt NUR auf diesem Gerät – nie in Supabase, nie im Abgleich, nie in der Haushalts-Sicherung.
// Getrennt pro Haushalt und Person (wie die persönlichen ToDo-Listen, js/personal.js), damit jemand anderes, der
// sich am selben Gerät anmeldet, sie nicht sieht.
//
// Doppelt abgelegt: localStorage und IndexedDB (fällt eins weg, kommt es aus dem anderen zurück); dazu wird das
// iPhone gebeten, die Daten nicht aufzuräumen (navigator.storage.persist). Gegen das Löschen der App hilft nur die
// Sicherungsdatei: verschlüsselt (PBKDF2 → AES-GCM) mit einem eigenen Passwort, über „Teilen“ z. B. in iCloud Drive.
// Das Passwort wird nicht gespeichert, nur der daraus abgeleitete Schlüssel auf diesem Gerät – so braucht eine neue
// Sicherung nur ein Antippen. Laden auf einem anderen Gerät: mit dem Passwort.
//
//   costs    [{ id, name, amount, kind: 'fix' | 'repeat', rhythm?: 'q' | 'h' | 'y' }]   Beträge in Rappen
//   abos     [{ id, name, amount, rhythm: 'm' | 'y' }]
//   bills    [{ id, name, amount, rate?, payments: [{ id, date, amount }], doneAt?, addedAt }]
//   incomes  [{ id, name, amount, kind: 'm' | 'once', month? ('JJJJ-MM', bei einmaligen) }]
//   active   { 'JJJJ-MM': [ids] }   nicht monatliche Kosten/Abos, die in diesem Monat zählen
//   payees   [{ name, amount }]      gemerkte Rechnungssteller (zuletzt verwendete zuerst)
//   backup   { at, changedAt }       letzte Sicherung, letzte Änderung (für die Erinnerung)

import { refresh, uid } from './store.js';
import { owner } from './personal.js';
import { monthKey, todayKey } from './dates.js';

const PREFIX = 'haushalt.planung.';
const KEY_PREFIX = 'haushalt.planungKey.';
const DB_NAME = 'haushalt-planung';
const FORMAT = 'haushalt-planung';
const ITERATIONS = 310000;
export const BACKUP_DAYS = 14;
const PAID_KEEP_DAYS = 30;

const storageKey = () => PREFIX + owner();
const empty = () => ({ costs: [], abos: [], bills: [], incomes: [], active: {}, payees: [], backup: {} });
const arr = (x) => (Array.isArray(x) ? x : []);
const clean = (d) => ({
  costs: arr(d?.costs), abos: arr(d?.abos), bills: arr(d?.bills), incomes: arr(d?.incomes),
  active: d?.active && typeof d.active === 'object' ? d.active : {}, payees: arr(d?.payees),
  backup: d?.backup && typeof d.backup === 'object' ? d.backup : {},
});

let loadedKey = null;
let data = empty();

// ---------- Ablage: localStorage + IndexedDB ----------

// Eine Verbindung für alles: so laufen die Schreibvorgänge in der Reihenfolge der Änderungen
let dbPromise = null;
function idb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('plans');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve) => {
    const req = db.transaction('plans').objectStore('plans').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
async function idbPut(key, value) {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction('plans', 'readwrite');
    if (value == null) tx.objectStore('plans').delete(key);
    else tx.objectStore('plans').put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { console.warn('Haushalt: Planung konnte nicht im localStorage gespeichert werden'); }
  idbPut(key, value).catch(() => {});
}

function load() {
  const key = storageKey();
  if (key === loadedKey) return;
  loadedKey = key;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* beschädigt: aus IndexedDB */ }
  data = clean(saved);
  sweep();
  // Zweite Ablage: fehlt die erste (gelöscht, beschädigt), von dort zurückholen; sonst die zweite nachführen
  idbGet(key).then((copy) => {
    if (key !== loadedKey) return;
    if (!saved && copy && isFilled(copy)) {
      data = clean(copy);
      write(key, data);
      refresh();
    } else if (saved && !copy) idbPut(key, data).catch(() => {});
  }).catch(() => {});
}

const isFilled = (d) => ['costs', 'abos', 'bills', 'incomes'].some((k) => arr(d?.[k]).length);

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

// Immer über diese Funktion lesen (nach einem Personenwechsel gehört der Speicher jemand anderem)
export function plan() {
  load();
  return data;
}

export function updatePlan(fn) {
  load();
  fn(data);
  data.backup.changedAt = Date.now();
  write(storageKey(), data);
  askPersist();
  refresh();
}

// Alles weg (Haushalt → „Alles zurücksetzen“)
export function wipePlan() {
  load();
  data = empty();
  write(storageKey(), null);
  try { localStorage.removeItem(KEY_PREFIX + owner()); } catch { /* egal */ }
}

// Ganz bezahlte Rechnungen nach 30 Tagen weg, Aktivierungen älter als zwei Jahre weg
function sweep() {
  const limit = Date.now() - PAID_KEEP_DAYS * 86400000;
  const bills = data.bills.filter((b) => !b.doneAt || b.doneAt >= limit);
  const old = monthKey(new Date(new Date().getFullYear() - 2, new Date().getMonth(), 1));
  const months = Object.keys(data.active).filter((m) => m < old);
  if (bills.length === data.bills.length && !months.length) return;
  data.bills = bills;
  for (const m of months) delete data.active[m];
  write(storageKey(), data);
}

// ---------- Rechnen ----------

export const paidOf = (bill, until = '9999-12-31') => arr(bill.payments).filter((p) => p.date <= until).reduce((s, p) => s + p.amount, 0);
export const openOf = (bill, until) => Math.max(0, bill.amount - paidOf(bill, until));

export const curMonth = () => todayKey().slice(0, 7);
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}
export const monthsBetween = (from, to) => {
  const [a, b] = [from, to].map((x) => x.split('-').map(Number));
  return (b[0] - a[0]) * 12 + (b[1] - a[1]);
};

// Ratenplan: erste noch fällige Rate – ist die Rate dieses Monats schon bezahlt, erst im nächsten Monat
function rateStart(bill) {
  const thisMonth = arr(bill.payments).filter((p) => p.date.startsWith(curMonth())).reduce((s, p) => s + p.amount, 0);
  return thisMonth >= bill.rate ? addMonths(curMonth(), 1) : curMonth();
}

// Ratenplan: wie viele Raten noch, fertig in welchem Monat (null ohne Plan)
export function rateInfo(bill) {
  if (!bill.rate) return null;
  const open = openOf(bill);
  if (!open) return { left: 0, end: null };
  const left = Math.ceil(open / bill.rate);
  return { left, end: addMonths(rateStart(bill), left - 1) };
}

const isActive = (month, id) => arr(data.active[month]).includes(id);
export const notMonthly = () => [
  ...plan().costs.filter((c) => c.kind === 'repeat').map((c) => ({ ...c, src: 'cost' })),
  ...plan().abos.filter((a) => a.rhythm === 'y').map((a) => ({ ...a, src: 'abo' })),
];

// Ein Monat (Standard, ohne Multiplizieren): Einnahmen, Fixkosten, Abos, Aktiviertes, Rechnungen
export function monthSums(month) {
  const d = plan();
  const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
  return {
    income: sum(d.incomes.filter((i) => i.kind === 'm' || i.month === month)),
    fix: sum(d.costs.filter((c) => c.kind === 'fix')),
    abos: sum(d.abos.filter((a) => a.rhythm !== 'y')),
    active: sum(notMonthly().filter((x) => isActive(month, x.id))),
    bills: d.bills.reduce((s, b) => s + billInMonth(b, month), 0),
  };
}

// Was von einer Rechnung im Monat anfällt:
//  - vergangene Monate: was tatsächlich bezahlt wurde
//  - dieser Monat: schon Bezahltes plus was noch ansteht (mit Ratenplan bis zur Rate, sonst der ganze offene Betrag)
//  - spätere Monate: mit Ratenplan die Rate, solange noch etwas offen ist (angenommen, die Raten davor sind bezahlt);
//    ohne Plan nichts mehr (der offene Betrag zählt im laufenden Monat)
export function billInMonth(b, month) {
  const now = curMonth();
  const paidIn = arr(b.payments).filter((p) => p.date.startsWith(month)).reduce((s, p) => s + p.amount, 0);
  if (month < now) return paidIn;
  const open = openOf(b);
  if (month === now) return paidIn + (b.rate ? Math.min(open, Math.max(0, b.rate - paidIn)) : open);
  if (!b.rate || !open) return 0;
  const before = Math.max(0, monthsBetween(rateStart(b), month)); // Raten zwischen jetzt und diesem Monat
  return Math.min(b.rate, Math.max(0, open - before * b.rate));
}

// Zusatz „Bis …“: vom laufenden Monat bis und mit `end` – Monatliches × Monate, Aktiviertes in diesen Monaten,
// Rechnungen: ganzer offener Betrag, mit Ratenplan höchstens die Raten bis dahin
export function untilSums(end) {
  const d = plan();
  const start = curMonth();
  const n = Math.max(1, monthsBetween(start, end) + 1);
  const months = Array.from({ length: n }, (_, i) => addMonths(start, i));
  const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
  const monthly = (list) => sum(list) * n;
  const bills = d.bills.filter((b) => openOf(b) > 0).reduce((s, b) => {
    if (!b.rate) return s + openOf(b);
    const rates = Math.max(0, monthsBetween(rateStart(b), end) + 1);
    return s + Math.min(openOf(b), rates * b.rate);
  }, 0);
  return {
    months: n,
    income: monthly(d.incomes.filter((i) => i.kind === 'm')) + sum(d.incomes.filter((i) => i.kind === 'once' && months.includes(i.month))),
    fix: monthly(d.costs.filter((c) => c.kind === 'fix')),
    abos: monthly(d.abos.filter((a) => a.rhythm !== 'y')),
    active: months.reduce((s, m) => s + sum(notMonthly().filter((x) => isActive(m, x.id))), 0),
    bills,
  };
}

export function toggleActive(month, id) {
  updatePlan((d) => {
    const set = new Set(arr(d.active[month]));
    if (set.has(id)) set.delete(id);
    else set.add(id);
    if (set.size) d.active[month] = [...set];
    else delete d.active[month];
  });
}

// Rechnungssteller merken (Name und letzter Betrag), neueste zuerst, höchstens 60
export function rememberPayee(d, name, amount) {
  d.payees = [{ name, amount }, ...d.payees.filter((p) => p.name.toLowerCase() !== name.toLowerCase())].slice(0, 60);
}

export function addPayment(billId, amount, date = todayKey()) {
  updatePlan((d) => {
    const b = d.bills.find((x) => x.id === billId);
    if (!b) return;
    b.payments = [...arr(b.payments), { id: uid(), date, amount }].sort((x, y) => x.date.localeCompare(y.date));
    if (paidOf(b) >= b.amount) b.doneAt ||= Date.now();
  });
}

export function removePayment(billId, paymentId) {
  updatePlan((d) => {
    const b = d.bills.find((x) => x.id === billId);
    if (!b) return;
    b.payments = arr(b.payments).filter((p) => p.id !== paymentId);
    if (paidOf(b) < b.amount) delete b.doneAt;
  });
}

// ---------- Sicherung ----------

// In Stücken, sonst bricht String.fromCharCode(...) bei grossen Sicherungen ab (zu viele Argumente)
function b64(bytes) {
  const all = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < all.length; i += 0x8000) text += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return btoa(text);
}
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

function savedKey() {
  try { return JSON.parse(localStorage.getItem(KEY_PREFIX + owner()) || 'null'); } catch { return null; }
}
export const hasBackupPassword = () => Boolean(savedKey()?.key);

export async function setBackupPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const raw = await crypto.subtle.exportKey('raw', key);
  try { localStorage.setItem(KEY_PREFIX + owner(), JSON.stringify({ salt: b64(salt), key: b64(raw) })); } catch { /* privates Fenster */ }
}

// Sicherung fällig: Daten vorhanden, seit der letzten Sicherung geändert und diese älter als 14 Tage (oder nie)
export function backupDue() {
  const d = plan();
  if (!isFilled(d)) return false;
  const { at = 0, changedAt = 0 } = d.backup;
  return changedAt > at && Date.now() - at > BACKUP_DAYS * 86400000;
}

// Verschlüsselte Datei (Text) mit dem gespeicherten Schlüssel
export async function backupText() {
  const saved = savedKey();
  if (!saved) throw new Error('Noch kein Passwort für die Sicherung festgelegt');
  const key = await crypto.subtle.importKey('raw', unb64(saved.key), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { backup, ...content } = plan();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(content)));
  return JSON.stringify({ format: FORMAT, version: 1, created: new Date().toISOString(), iterations: ITERATIONS, salt: saved.salt, iv: b64(iv), data: b64(ct) });
}

export function markBackedUp() {
  load();
  data.backup.at = Date.now();
  write(storageKey(), data);
  refresh();
}

export const isPlanFile = (file) => file?.format === FORMAT;

// Datei + Passwort → Inhalt; falsches Passwort: verständlicher Fehler
export async function readBackup(file, password) {
  if (![file?.salt, file?.iv, file?.data].every((x) => typeof x === 'string')) throw new Error('Die Sicherungsdatei ist unvollständig');
  const iterations = Math.min(Math.max(Number(file.iterations) || ITERATIONS, 100000), 2000000);
  const key = await deriveKey(password, unb64(file.salt), iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
  } catch {
    throw new Error('Passwort stimmt nicht (oder die Datei ist beschädigt)');
  }
  return clean(JSON.parse(new TextDecoder().decode(plain)));
}

// Eingelesene Sicherung übernehmen (ersetzt alles); das Passwort gilt danach auch für neue Sicherungen hier
export async function restorePlan(content, password) {
  load();
  data = { ...clean(content), backup: { at: Date.now(), changedAt: Date.now() } };
  write(storageKey(), data);
  await setBackupPassword(password);
  refresh();
}
