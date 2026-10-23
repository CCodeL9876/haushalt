// Aufräumen: Was erledigt oder abgerechnet ist, wird nach einer Frist gelöscht – in Supabase und auf den Geräten –,
// damit nicht unnötig viel gespeichert bleibt. Läuft beim Start, höchstens einmal am Tag pro Gerät.
//  - erledigte ToDos (geteilte und die eigenen persönlichen, ausser in Packlisten) und erledigte Einkäufe: 30 Tage nach dem Abhaken
//  - Abrechnung: Einträge, die älter als 12 Monate sind, aber nur bis zum letzten Zeitpunkt, an dem alle quitt
//    waren. So bleibt der heutige Stand (und jeder „Danach“-Stand in der Liste) genau gleich.
// Einträge ohne doneAt (vor dieser Regel abgehakt) bekommen zuerst das heutige Datum – sie gehen also frühestens
// in 30 Tagen weg.

import { session, state, update } from './store.js';
import { personal, updatePersonal } from './personal.js';
import { balances } from './settle.js';
import { dateKey, todayKey } from './dates.js';

export const DONE_DAYS = 30;
export const LEDGER_MONTHS = 12;
const LAST_KEY = 'haushalt.cleanup.';

// Erledigte: doneAt nachtragen, zu alte entfernen. Gibt die verbleibende Liste zurück (oder null = unverändert).
// keep: Listen, deren Erledigtes bleibt (Packlisten – Gepacktes soll für die nächste Reise stehen bleiben)
function sweepDone(items, now, keep = new Set()) {
  const limit = now - DONE_DAYS * 86400000;
  let changed = false;
  const kept = items.filter((x) => {
    if (!x.done || keep.has(x.listId)) return true;
    if (!x.doneAt) {
      x.doneAt = now;
      changed = true;
      return true;
    }
    if (x.doneAt >= limit) return true;
    changed = true;
    return false;
  });
  return changed ? kept : null;
}

// Älteste Einträge der Abrechnung, die zusammen aufgehen (danach waren alle quitt) und älter als die Frist sind
export function settledPrefix(expenses, today = todayKey()) {
  const d = new Date(`${today}T12:00:00`);
  d.setMonth(d.getMonth() - LEDGER_MONTHS);
  const cutoff = dateKey(d);
  const sorted = [...expenses].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  const ids = new Set(sorted.flatMap((e) => [e.payerId, ...(e.splitIds || [])]));
  const people = [...ids].map((id) => ({ id }));
  const total = new Map(people.map((p) => [p.id, 0]));
  let end = 0;
  for (let n = 0; n < sorted.length; n += 1) {
    if (!(sorted[n].date < cutoff)) break;
    for (const [id, v] of balances(people, [sorted[n]])) total.set(id, total.get(id) + v);
    if ([...total.values()].every((v) => v === 0)) end = n + 1;
  }
  return sorted.slice(0, end).map((e) => e.id);
}

export function cleanup({ force = false } = {}) {
  const day = todayKey();
  const key = LAST_KEY + (session.key || 'local');
  try {
    if (!force && localStorage.getItem(key) === day) return;
    localStorage.setItem(key, day);
  } catch { /* privates Fenster: dann eben bei jedem Start */ }
  const now = Date.now();

  const packLists = (lists) => new Set(lists.filter((l) => l.kind === 'pack').map((l) => l.id));
  const todos = sweepDone(structuredClone(state.todos), now, packLists(state.todolists));
  const shopping = sweepDone(structuredClone(state.shopping), now);
  const settled = new Set(settledPrefix(state.expenses, day));
  if (todos || shopping || settled.size) {
    update((s) => {
      if (todos) s.todos = todos;
      if (shopping) s.shopping = shopping;
      if (settled.size) s.expenses = s.expenses.filter((e) => !settled.has(e.id));
    });
  }

  const mine = sweepDone(structuredClone(personal().todos), now, packLists(personal().lists));
  if (mine) updatePersonal((d) => { d.todos = mine; });
}
