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
