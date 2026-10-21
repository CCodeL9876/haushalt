// Wiederkehrende ToDos (z. B. Altpapier, Grüngut, Karton): Nach dem Abhaken erscheint das ToDo mit dem nächsten
// Datum wieder. Zwei Arten (Feld repeat am ToDo):
//   { every: 2, unit: 'week' }              regelmässig: alle n Tage/Wochen/Monate
//   { dates: ['2026-11-04', …] }            nach Plan: feste Daten, z. B. aus dem Abfuhrkalender der Gemeinde –
//                                           von Hand eingetragen oder aus einer Kalender-Datei (.ics) eingelesen
// remind: true → am Vortag um 18 Uhr eine Mitteilung an alle im Haushalt (nur geteilte Listen, Funktion „push“).

import { addDays, dateKey, parseKey } from './dates.js';

export const REPEAT_CHOICES = [
  ['', 'Nie'],
  ['1-week', 'Jede Woche'],
  ['2-week', 'Alle 2 Wochen'],
  ['4-week', 'Alle 4 Wochen'],
  ['1-month', 'Jeden Monat'],
  ['1-year', 'Jedes Jahr'],
  ['plan', 'Nach Plan (feste Daten)'],
];

export const repeatChoice = (r) => (!r ? '' : Array.isArray(r.dates) ? 'plan' : `${r.every}-${r.unit}`);

// '2-week' → { every: 2, unit: 'week' }; 'plan' → { dates }
export function repeatFromChoice(choice, dates = []) {
  if (choice === 'plan') return { dates };
  const [every, unit] = String(choice).split('-');
  return Number(every) > 0 && ['day', 'week', 'month', 'year'].includes(unit) ? { every: Number(every), unit } : null;
}

function step(key, r) {
  const d = parseKey(key);
  if (r.unit === 'day') return dateKey(addDays(d, r.every));
  if (r.unit === 'week') return dateKey(addDays(d, 7 * r.every));
  // Monat/Jahr: am selben Tag, beim 31. im kürzeren Monat am letzten Tag
  const months = r.unit === 'year' ? 12 * r.every : r.every;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return dateKey(target);
}

// Nächstes Datum nach dem Abhaken: nach dem bisherigen Datum und nicht in der Vergangenheit. null = keins mehr.
export function nextDue(t, today) {
  const r = t.repeat;
  if (!r) return null;
  const after = (d) => d > (t.due || '') && d >= today;
  if (Array.isArray(r.dates)) return [...r.dates].sort().find(after) || null;
  let d = t.due || today;
  for (let n = 0; n < 1000 && !after(d); n += 1) d = step(d, r);
  return after(d) ? d : null;
}

// Kurztext für die Liste: „alle 2 Wochen“, „nach Plan · noch 7 Termine“
export function repeatLabel(t) {
  const r = t.repeat;
  if (!r) return '';
  if (Array.isArray(r.dates)) {
    const left = r.dates.filter((d) => d > (t.due || '')).length;
    return left ? `nach Plan · noch ${left} ${left === 1 ? 'Termin' : 'Termine'}` : 'nach Plan · letzter Termin';
  }
  const unit = { day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'], month: ['Monat', 'Monate'], year: ['Jahr', 'Jahre'] }[r.unit];
  if (r.every === 1) return { day: 'täglich', week: 'jede Woche', month: 'jeden Monat', year: 'jedes Jahr' }[r.unit];
  return `alle ${r.every} ${unit[1]}`;
}

// Eingetippte Daten: „4.11.2026“, „04.11.26“, „4.11.“ (nächstes Vorkommen), „2026-11-04“; getrennt mit Komma,
// Strichpunkt, Leerzeichen oder Zeilen. Ergibt sortierte, eindeutige Tage; Unlesbares in bad.
export function parseDates(text, today) {
  const dates = new Set();
  const bad = [];
  for (const part of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(part);
    let y;
    let mo;
    let d;
    if (m) [, y, mo, d] = m.map(Number);
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(part))) {
      d = Number(m[1]);
      mo = Number(m[2]);
      if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      else {
        y = Number(today.slice(0, 4));
        if (`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` < today) y += 1;
      }
    } else {
      bad.push(part);
      continue;
    }
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1 || date.getDate() !== d) bad.push(part);
    else dates.add(dateKey(date));
  }
  return { dates: [...dates].sort(), bad };
}

export const formatDates = (dates) => dates.map((k) => { const d = parseKey(k); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; }).join(', ');

// ---------- Kalender-Datei (.ics), z. B. Abfuhrkalender der Gemeinde ----------
// → [{ title, dates }] je Bezeichnung (SUMMARY), nur Termine ab heute bis in gut einem Jahr.
// Wiederholungen (RRULE) mit FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL; EXDATE wird ausgelassen.
export function parseIcs(text, today) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const until = dateKey(addDays(parseKey(today), 400));
  const groups = new Map();
  let ev = null;
  // Zeit in UTC („…T230000Z“): in Ortszeit umrechnen, sonst landet ein später Termin am falschen Tag
  const dateOf = (value) => {
    const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value || '');
    if (!m) return '';
    if (m[7]) return dateKey(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
    return `${m[1]}-${m[2]}-${m[3]}`;
  };
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (ev?.start && ev.summary) addEvent(groups, ev, today, until);
      ev = null;
      continue;
    }
    if (!ev) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (name === 'SUMMARY') ev.summary = value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim().slice(0, 120);
    else if (name === 'DTSTART') ev.start = dateOf(value);
    else if (name === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
    else if (name === 'EXDATE') ev.exdates.push(...value.split(',').map(dateOf));
  }
  return [...groups].map(([title, set]) => ({ title, dates: [...set].sort().slice(0, 200) }))
    .filter((g) => g.dates.length)
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
}

function addEvent(groups, ev, today, until) {
  const set = groups.get(ev.summary) || new Set();
  groups.set(ev.summary, set);
  const keep = (d) => { if (d >= today && d <= until && !ev.exdates.includes(d)) set.add(d); };
  const rule = ev.rrule;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[rule?.FREQ];
  if (!unit) return keep(ev.start);
  const r = { every: Math.max(1, Number(rule.INTERVAL) || 1), unit };
  const last = rule.UNTIL ? dateKey(parseKey(`${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}`)) : until;
  const count = Number(rule.COUNT) || Infinity;
  let d = ev.start;
  for (let n = 0; n < count && n < 2000 && d <= last && d <= until; n += 1) {
    keep(d);
    d = step(d, r);
  }
}
