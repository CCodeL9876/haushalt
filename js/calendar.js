// ToDo in den Kalender (Apple-Kalender am iPhone, auch Outlook/Google am Computer): Die App baut eine
// .ics-Datei direkt im Browser – nichts geht an einen Server. Safari zeigt dann „Zum Kalender hinzufügen“.

import { addDays, parseKey, dateKey } from './dates.js';

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

// Datei öffnen: Safari am iPhone zeigt die Vorschau mit „Hinzufügen“, am Computer wird sie geladen
export function addToCalendar(todo) {
  const href = `data:text/calendar;charset=utf-8,${encodeURIComponent(toIcs(todo))}`;
  const name = `${String(todo.title).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'todo'}.ics`;
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  markAdded(todo.id);
}
