// Datumshilfen. Tage werden als 'JJJJ-MM-TT' in Ortszeit gespeichert
// (nicht über toISOString – das wäre UTC und kurz nach Mitternacht der falsche Tag).

const pad = (n) => String(n).padStart(2, '0');

export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dateKey(new Date());

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Montag der Woche von `date`
export function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, -((d.getDay() + 6) % 7));
}

// Kalenderwoche nach ISO 8601
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

const fmt = (opts) => new Intl.DateTimeFormat('de-CH', opts);
export const fmtWeekday = (d) => fmt({ weekday: 'long' }).format(d);
export const fmtDayMonth = (d) => fmt({ day: 'numeric', month: 'short' }).format(d);
export const fmtMonthYear = (d) => fmt({ month: 'long', year: 'numeric' }).format(d);
export const fmtShort = (key) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(parseKey(key));

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

export const holidayName = (date) => holidays(date.getFullYear()).get(dateKey(date)) || '';
// Läden zu: Sonntag oder Feiertag
export const shopsClosed = (date) => date.getDay() === 0 || Boolean(holidayName(date));
