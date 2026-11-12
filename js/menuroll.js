// Zufällige Menüs für freie Abende («Woche auswürfeln», js/views/wochenplan.js). Rein rechnerisch, ohne Ansicht.
// Regeln: Nichts doppelt in der Woche (und nichts, das in den Tagen davor/danach schon geplant ist), solange genug
// Ideen da sind. Gerichte, die Zutaten aus dem Kühlschrank brauchen, sind wahrscheinlicher – dringende am ehesten.

import { isStaple, splitIngredient } from './ingredients.js';

// fridge: [{ name, urgent }] – passt eine Zutat der Idee zu einem Kühlschrank-Eintrag?
export function fridgeMatch(idea, fridge) {
  let best = 0;
  for (const line of idea.ingredients || []) {
    const name = String(splitIngredient(line).name || '').toLowerCase();
    if (name.length < 3 || isStaple(name)) continue;
    for (const f of fridge) {
      const w = String(f.name || '').toLowerCase();
      if (w.length >= 3 && (name.includes(w) || w.includes(name))) best = Math.max(best, f.urgent ? 2 : 1);
    }
  }
  return best;
}

// Gewichteter Zufall ohne Zurücklegen. taken: Titel (klein geschrieben), die schon geplant sind.
// Ergibt höchstens `count` Ideen, in der Reihenfolge der Tage; weniger, wenn es gar keine Ideen gibt.
export function pickMenus({ ideas, count, taken = new Set(), fridge = [], rnd = Math.random }) {
  const result = [];
  const used = new Set();
  const weight = (i) => [1, 3, 6][fridgeMatch(i, fridge)];
  const draw = (pool) => {
    const total = pool.reduce((sum, i) => sum + weight(i), 0);
    let at = rnd() * total;
    for (const i of pool) { at -= weight(i); if (at < 0) return i; }
    return pool[pool.length - 1];
  };
  while (result.length < count && ideas.length) {
    // Zuerst Neues, dann alles ausser dem, was in diesem Durchgang schon dran war, zuletzt alles (zu wenige Ideen)
    let pool = ideas.filter((i) => !taken.has(i.title.toLowerCase()) && !used.has(i.id));
    if (!pool.length) pool = ideas.filter((i) => !used.has(i.id));
    if (!pool.length) { used.clear(); pool = ideas; }
    const pick = draw(pool);
    used.add(pick.id);
    result.push(pick);
  }
  return result;
}
