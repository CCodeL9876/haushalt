// Kühlschrank: Reste und Angebrochenes mit „aufbrauchen bis“ (state.fridge). Die Haltbarkeit schlägt die App vor –
// zuerst, was der Haushalt für dieses Lebensmittel zuletzt hatte (settings.fridgeDays, Name klein → Tage), sonst
// einen Richtwert aus SHELF. Die Richtwerte sind vorsichtig gewählt (gekühlt, offen bzw. gekocht).

import { state, termKey, uid, update } from './store.js';
import { addDays, dateKey, fmtShort, parseKey, todayKey } from './dates.js';

// Verglichen wird klein geschrieben, irgendwo im Namen. Passen mehrere, gilt der kürzeste Wert – „Pasta mit Pesto“
// hält so wie gekochte Pasta (3), nicht wie Pesto (5); „Curry mit Reis“ wie Reis (1).
export const SHELF = [
  { keys: ['frisches pesto', 'pesto selbst', 'pesto hausgemacht'], days: 3 },
  { keys: ['pesto'], days: 5 },
  { keys: ['reis', 'risotto', 'sushi'], days: 1 },
  { keys: ['fisch', 'lachs', 'thunfisch', 'crevetten', 'meeresfrüchte'], days: 1 },
  { keys: ['salat'], days: 1 },
  { keys: ['rahm', 'sahne', 'kokosmilch', 'mascarpone', 'ricotta', 'mozzarella', 'hackfleisch'], days: 2 },
  { keys: ['tomatensauce', 'passata', 'tomaten passiert', 'hummus', 'joghurt', 'quark', 'crème fraîche', 'creme fraiche'], days: 4 },
  { keys: ['pasta', 'nudeln', 'spaghetti', 'teigwaren', 'lasagne', 'suppe', 'eintopf', 'curry', 'fleisch', 'poulet', 'pizza', 'kartoffeln', 'gemüse'], days: 3 },
];
export const DEFAULT_DAYS = 3;
export const DAY_CHOICES = [1, 2, 3, 4, 5, 7];

// Vorgeschlagene Tage für ein Lebensmittel
export function suggestDays(name) {
  const learned = state.settings.fridgeDays?.[termKey(name)];
  if (Number.isFinite(learned)) return learned;
  const n = String(name || '').toLowerCase();
  const hits = SHELF.filter((s) => s.keys.some((k) => n.includes(k))).map((s) => s.days);
  return hits.length ? Math.min(...hits) : DEFAULT_DAYS;
}

export const useByFrom = (days, from = new Date()) => dateKey(addDays(from, days));

// Ganze Tage bis „aufbrauchen bis“: 0 = heute, negativ = abgelaufen
export const daysLeft = (item) => Math.round((parseKey(item.useBy) - parseKey(todayKey())) / 86400000);

export function leftLabel(item) {
  const left = daysLeft(item);
  if (left < -1) return `seit ${-left} Tagen abgelaufen`;
  if (left === -1) return 'seit gestern abgelaufen';
  if (left === 0) return 'heute aufbrauchen';
  if (left === 1) return 'bis morgen aufbrauchen';
  return `noch ${left} Tage · bis ${fmtShort(item.useBy)}`;
}

// Bald fällig (heute, morgen oder schon abgelaufen) – rot hervorheben
export const isUrgent = (item) => daysLeft(item) <= 1;

export const fridgeSorted = () => [...state.fridge].sort((a, b) => a.useBy.localeCompare(b.useBy) || (b.addedAt || 0) - (a.addedAt || 0));

// Gewählte Tage für dieses Lebensmittel merken (der nächste Vorschlag nimmt sie wieder)
function learn(s, name, days) {
  const key = termKey(name);
  if (!key) return;
  s.settings.fridgeDays = { ...(s.settings.fridgeDays || {}), [key]: days };
}

// entries: [{ name, days?, from? }] – from: Gericht, von dem der Rest stammt. Gibt die Anzahl zurück.
export function addToFridge(entries) {
  let added = 0;
  update((s) => {
    for (const e of entries) {
      const name = String(e.name || '').trim().slice(0, 80);
      if (!name) continue;
      const days = e.days ?? suggestDays(name);
      s.fridge.push({ id: uid(), name, useBy: useByFrom(days), addedAt: Date.now(), ...(e.from ? { from: String(e.from).slice(0, 80) } : {}) });
      learn(s, name, days); // auch für die Schnellwahl im Kühlschrank
      added += 1;
    }
  });
  return added;
}

export function changeFridgeItem(id, { name, useBy, days }) {
  update((s) => {
    const item = s.fridge.find((x) => x.id === id);
    if (!item) return;
    if (name) item.name = name.slice(0, 80);
    if (useBy) item.useBy = useBy;
    // Haltbarkeit von Hand gewählt: ab dem Tag des Eintrags gezählt merken
    if (days != null) learn(s, item.name, days);
  });
}

export function removeFridgeItem(id) {
  update((s) => { s.fridge = s.fridge.filter((x) => x.id !== id); });
}

// Ab welchem Tag (JJJJ-MM-TT) ein Eintrag zählt – für „Tage seit Eintrag“
export const addedDay = (item) => dateKey(new Date(item.addedAt || Date.now()));
