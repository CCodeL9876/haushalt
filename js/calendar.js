// ToDo in den Kalender (Apple-Kalender am iPhone, auch Outlook/Google am Computer): Die App baut eine .ics-Datei
// direkt im Browser; zum iPhone-Kalender geht sie über die Supabase-Funktion „calendar“ (siehe addToCalendar).

import { addDays, parseKey, dateKey } from './dates.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { flushNow, session } from './store.js';
import { loadSession } from './session.js';

const pad = (n) => String(n).padStart(2, '0');
const compact = (key) => key.replaceAll('-', '');

// Text für .ics: Backslash, Komma, Strichpunkt und Zeilenumbruch maskieren
const text = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

// Zeilen über 75 Zeichen umbrechen (Folgezeile beginnt mit Leerzeichen), wie es der Standard verlangt
const fold = (line) => line.match(/.{1,74}/gu)?.join('\r\n ') || line;

// todo: { id, title, note, due: 'JJJJ-MM-TT', time?: 'HH:MM' }. Mit Uhrzeit: 1 Stunde, Erinnerung 15 Min. vorher.
// Ohne Uhrzeit: ganztägig. Zeiten ohne Zeitzone = Ortszeit des Geräts.
export function toIcs(todo) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  let when;
  if (todo.time) {
    const [h, m] = todo.time.split(':').map(Number);
    const start = parseKey(todo.due);
    start.setHours(h, m);
    const end = new Date(start.getTime() + 3600000);
    const local = (d) => `${compact(dateKey(d))}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    when = [`DTSTART:${local(start)}`, `DTEND:${local(end)}`];
  } else {
    when = [`DTSTART;VALUE=DATE:${compact(todo.due)}`, `DTEND;VALUE=DATE:${compact(dateKey(addDays(parseKey(todo.due), 1)))}`];
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Haushalt//ToDo//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${todo.id}@haushalt`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${text(todo.title)}`,
    ...(todo.note ? [`DESCRIPTION:${text(todo.note)}`] : []),
    ...(todo.time ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(todo.title)}`, 'TRIGGER:-PT15M', 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// Welche ToDos auf diesem Gerät schon in den Kalender kamen – nur hier gemerkt, nicht im Haushalt geteilt
// (bei einem geteilten ToDo hat es ja nur diese Person in ihrem Kalender)
const ADDED_KEY = 'haushalt.calendar';
function added() {
  try {
    const list = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export const isInCalendar = (id) => added().includes(id);
function markAdded(id) {
  try {
    localStorage.setItem(ADDED_KEY, JSON.stringify([...added().filter((x) => x !== id), id].slice(-500)));
  } catch { /* privates Fenster */ }
}

// Eintragen. Am iPhone bietet Safari „Hinzufügen“ nur für Kalenderdateien von einem Server an – darum geht die Datei
// im gemeinsamen Haushalt über die Supabase-Funktion „calendar“ (verschlüsselt, speichert nichts, siehe dort).
// Ohne Supabase (oder wenn die Funktion fehlt): Datei direkt herunterladen – das klappt am Computer.
// Ergibt eine Meldung für den Fall, dass es nicht ging, sonst ''.
export async function addToCalendar(todo) {
  const ics = toIcs(todo);
  if (SUPABASE_URL && SUPABASE_ANON_KEY && session.mode === 'shared') {
    try {
      await flushNow(); // sonst bricht das Öffnen der Adresse das Speichern ab („Offline“)
      const { key, code } = loadSession();
      const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-hh-key': key || '', 'x-hh-code': code || '' };
      if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calendar`, { method: 'POST', headers, body: JSON.stringify({ ics }), signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url?.startsWith(`${SUPABASE_URL}/functions/v1/calendar?`)) {
        markAdded(todo.id);
        location.assign(data.url);
        return '';
      }
      if (res.status === 404) return 'Die Funktion „calendar“ ist in Supabase noch nicht eingerichtet (ANLEITUNG.md, „Apple-Kalender“).';
      if (res.status === 401) return 'Supabase lehnt ab – bei „calendar“ die JWT-Prüfung ausschalten (ANLEITUNG.md).';
      return data?.error || `Kalender: Fehler ${res.status}`;
    } catch {
      return 'Keine Verbindung – später nochmals versuchen.';
    }
  }
  download(todo, ics);
  return '';
}

// Datei direkt herunterladen (Computer; am iPhone landet sie höchstens in „Dateien“)
function download(todo, ics) {
  const href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  const name = `${String(todo.title).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'todo'}.ics`;
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  markAdded(todo.id);
}
