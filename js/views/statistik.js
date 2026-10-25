// Statistik (Teil von Essen): Wie oft wurde welches Gericht gegessen? Gezählt wird, was im Wochenplan an Tagen bis
// heute eingetragen war (Mittag und Abend). Gerichte mit Menüidee werden über die Idee zusammengezählt – auch nach
// dem Umbenennen –, frei eingetragene über den Namen (Gross/Klein egal).

import { refresh, state } from '../store.js';
import { esc } from '../ui.js';
import { addDays, dateKey, fmtShort, parseKey, todayKey } from '../dates.js';
import { mealTitle } from './wochenplan.js';

const RANGES = [
  { id: '3m', label: '3 Monate', days: 91 },
  { id: '12m', label: '12 Monate', days: 365 },
  { id: 'alle', label: 'Alle', days: null },
];
let rangeId = '3m';
const MAX_ROWS = 15;

function collect(range) {
  const today = todayKey();
  const from = range.days ? dateKey(addDays(new Date(), -range.days + 1)) : '';
  const byKey = new Map();
  let meals = 0;
  for (const [day, entry] of Object.entries(state.plan)) {
    if (day > today || day < from) continue;
    for (const meal of Object.values(entry || {})) {
      const title = mealTitle(meal).trim();
      if (!title || meal.away) continue; // Platzhalter „Nicht zuhause“ ist kein Gericht
      const idea = meal.ideaId && state.ideas.some((i) => i.id === meal.ideaId) ? meal.ideaId : null;
      const key = idea ? `i:${idea}` : `t:${title.toLowerCase()}`;
      const row = byKey.get(key) || { title, count: 0, last: '' };
      row.count += 1;
      if (day > row.last) row.last = day;
      byKey.set(key, row);
      meals += 1;
    }
  }
  const rows = [...byKey.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.title.localeCompare(b.title, 'de'));
  return { rows, meals };
}

// Menüideen, die seit mindestens einem Monat (oder noch nie) im Plan waren – Anregung für die nächste Woche
function forgotten() {
  const last = new Map();
  const today = todayKey();
  for (const [day, entry] of Object.entries(state.plan)) {
    if (day > today) continue;
    for (const meal of Object.values(entry || {})) {
      if (meal?.ideaId && day > (last.get(meal.ideaId) || '')) last.set(meal.ideaId, day);
    }
  }
  const monthAgo = dateKey(addDays(new Date(), -30));
  return state.ideas
    .filter((i) => i.kind !== 'drink')
    .map((i) => ({ title: i.title, last: last.get(i.id) || '' }))
    .filter((i) => i.last < monthAgo)
    .sort((a, b) => a.last.localeCompare(b.last) || a.title.localeCompare(b.title, 'de'))
    .slice(0, 5);
}

const ago = (key) => {
  const days = Math.round((parseKey(todayKey()) - parseKey(key)) / 86400000);
  if (days === 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 60) return `vor ${days} Tagen`;
  return `zuletzt ${fmtShort(key)}`;
};

export default {
  id: 'statistik',
  title: 'Statistik',

  render() {
    const range = RANGES.find((r) => r.id === rangeId);
    const { rows, meals } = collect(range);
    const max = rows[0]?.count || 1;
    const shown = rows.slice(0, MAX_ROWS);
    const rest = rows.length - shown.length;
    const old = forgotten();
    return `
      <div class="seg" role="group" aria-label="Zeitraum">
        ${RANGES.map((r) => `<button type="button" class="seg-btn" data-action="statRange" data-range="${esc(r.id)}" aria-pressed="${r.id === rangeId}">${r.label}</button>`).join('')}
      </div>
      <div class="stat-tiles">
        <div class="card stat-tile"><span class="stat-number">${meals}</span><span class="muted small">Mahlzeiten geplant und gegessen</span></div>
        <div class="card stat-tile"><span class="stat-number">${rows.length}</span><span class="muted small">verschiedene Gerichte</span></div>
      </div>
      ${rows.length ? `
        <h2 class="section-title">Am häufigsten</h2>
        <ol class="card stat-list" aria-label="Gerichte nach Anzahl">
          ${shown.map((r) => `
            <li class="stat-row">
              <span class="stat-name">${esc(r.title)}<small class="muted">${ago(r.last)}</small></span>
              <span class="stat-count">${r.count}×</span>
              <span class="stat-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.round((r.count / max) * 100))}%"></span></span>
            </li>`).join('')}
        </ol>
        ${rest > 0 ? `<p class="muted small" style="margin:6px 4px 0">… und ${rest} weitere Gerichte je ${rows[MAX_ROWS].count === 1 ? 'einmal' : 'seltener'}.</p>` : ''}`
        : `<div class="empty"><strong>Noch nichts gezählt</strong>Sobald im Wochenplan Gerichte an vergangenen Tagen stehen, erscheinen sie hier.</div>`}
      ${old.length ? `
        <h2 class="section-title">Länger nicht mehr gegessen</h2>
        <ul class="list">${old.map((o) => `
          <li><span class="list-main">${esc(o.title)}<small>${o.last ? ago(o.last) : 'noch nie im Plan'}</small></span></li>`).join('')}
        </ul>` : ''}`;
  },

  actions: {
    statRange(el) {
      rangeId = el.dataset.range;
      refresh();
    },
  },
};
