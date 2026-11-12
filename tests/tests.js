// Tests für die heikle Logik: Abrechnung, Geldbeträge, Rechnungen im Monat, Abgleich mit der Datenbank.
// Öffnen: tests.html im Browser (lokal über `python3 serve.py` oder auf GitHub Pages). Läuft mit einem
// nachgebauten Haushalt (keine Verbindung zu Supabase), echte Daten bleiben unberührt.

import { balances } from '../js/settle.js';
import { parseMoney } from '../js/ui.js';
import { pull, startShared, state, update } from '../js/store.js';
import { fridgeMatch, pickMenus } from '../js/menuroll.js';
import { donutSvg } from '../js/donut.js';
import { addMonths, billInMonth, curMonth, useShared } from '../js/planung.js';

const results = [];
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, ok, detail: ok ? '' : `erwartet ${JSON.stringify(want)}, erhalten ${JSON.stringify(got)}` });
};

function testBalances() {
  const a = { id: 'a' };
  const b = { id: 'b' };
  // 10.01 geteilt: Anna zahlt, der übrige Rappen geht an die erste Person der Aufteilung
  let bal = balances([a, b], [{ kind: 'expense', amount: 1001, payerId: 'a', splitIds: ['a', 'b'] }]);
  eq('Abrechnung: 10.01 geteilt – Ben schuldet 5.00', [bal.get('a'), bal.get('b')], [500, -500]);
  // Ben zahlt die 5.00 zurück → quitt
  bal = balances([a, b], [
    { kind: 'expense', amount: 1001, payerId: 'a', splitIds: ['a', 'b'] },
    { kind: 'transfer', amount: 500, payerId: 'b', splitIds: ['a'] },
  ]);
  eq('Abrechnung: nach der Rückzahlung quitt', [bal.get('a'), bal.get('b')], [0, 0]);
  // Ganz für die andere Person gekauft
  bal = balances([a, b], [{ kind: 'expense', amount: 2000, payerId: 'a', splitIds: ['b'] }]);
  eq('Abrechnung: ganz für Ben – Ben schuldet 20.00', bal.get('b'), -2000);
  // Ausgabe einer entfernten Person zählt nicht
  bal = balances([a, b], [{ kind: 'expense', amount: 999, payerId: 'x', splitIds: ['a', 'b'] }]);
  eq('Abrechnung: unbekannte Person wird ignoriert', [bal.get('a'), bal.get('b')], [0, 0]);
}

function testMoney() {
  const cases = [['12.50', 1250], ['12,5', 1250], ["1'850.50", 185050], ['1.850,50', 185050], ['1,850.50', 185050],
    ['CHF 12', 1200], ['0.29', 29], ['0', null], ['abc', null], ['-5', null]];
  for (const [text, want] of cases) eq(`Betrag «${text}»`, parseMoney(text), want);
}

function testBills() {
  useShared(true);
  const now = curMonth();
  const next = addMonths(now, 1);
  const due = (m) => `${m}-15`;
  state.flow = [];
  const bill = (extra) => ({ type: 'bill', id: 'x', name: 'Test', amount: 30000, payments: [], ...extra });
  eq('Rechnung ohne Datum: ganz in diesem Monat', billInMonth(bill({}), now), 30000);
  eq('Rechnung fällig nächsten Monat: diesen Monat nichts', billInMonth(bill({ due: due(next) }), now), 0);
  eq('Rechnung fällig nächsten Monat: dort ganz', billInMonth(bill({ due: due(next) }), next), 30000);
  eq('Ratenplan 100/Monat: diesen Monat eine Rate', billInMonth(bill({ rate: 10000 }), now), 10000);
  eq('Ratenplan: nächsten Monat wieder eine Rate', billInMonth(bill({ rate: 10000 }), next), 10000);
  eq('Ratenplan: nach drei Raten nichts mehr', billInMonth(bill({ rate: 10000 }), addMonths(now, 3)), 0);
  eq('Monate zugewiesen: zählt fest im Monat', billInMonth(bill({ months: { [next]: 12000 } }), next), 12000);
  eq('Teilzahlung: Rest zählt diesen Monat', billInMonth(bill({ payments: [{ id: 'p', date: `${now}-01`, amount: 10000 }] }), now), 30000);
  useShared(false);
}

// Nachgebaute Datenbank: Zeilen wie bei Supabase, upsert kann für eine Sammlung scheitern (fehlendes SQL)
function fakeRemote(rows, failCollection = '') {
  const db = new Map(rows.map((r) => [`${r.collection}/${r.id}`, r]));
  return {
    key: `test-${Date.now()}`,
    db,
    login: async () => 'Test',
    loadAll: async () => [...db.values()].map((r) => JSON.parse(JSON.stringify(r))),
    upsert: async (list) => {
      if (list.some((r) => r.collection === failCollection)) throw new Error(`Sammlung ${failCollection} fehlt`);
      for (const r of list) db.set(`${r.collection}/${r.id}`, JSON.parse(JSON.stringify(r)));
    },
    remove: async (ids) => { for (const [c, list] of Object.entries(ids)) for (const id of list) db.delete(`${c}/${id}`); },
  };
}

async function testSync() {
  const base = [
    { collection: 'members', id: 'a', data: { id: 'a', name: 'Anna' } },
    { collection: 'settings', id: 'main', data: { currency: 'CHF' } },
  ];
  // „Abfuhr draussen“ in eigener Zeile
  let r = fakeRemote(base);
  await startShared(r, 'Test');
  update((s) => { s.settings.wasteOut = '2026-11-13'; });
  await pull();
  eq('Abgleich: «Draussen» in eigener Zeile', r.db.get('settings/wasteOut')?.data, { value: '2026-11-13' });
  eq('Abgleich: «Draussen» nicht mehr in der Hauptzeile', r.db.get('settings/main')?.data?.wasteOut, undefined);
  localStorage.removeItem(`haushalt.cache.${r.key}`);

  // Hochladen scheitert (Moneyflow ohne SQL) – Änderungen der anderen kommen trotzdem an, die eigene bleibt
  r = fakeRemote(base, 'flow');
  await startShared(r, 'Test');
  update((s) => { s.flow.push({ id: 'f1', type: 'cost', name: 'Miete', amount: 1 }); });
  await new Promise((ok) => setTimeout(ok, 20));
  r.db.set('shopping/s1', { collection: 'shopping', id: 's1', data: { id: 's1', name: 'Milch', done: false } }); // vom anderen Gerät
  await pull();
  eq('Abgleich trotz Fehler: neuer Einkauf der anderen Person kommt an', state.shopping.map((x) => x.name), ['Milch']);
  eq('Abgleich trotz Fehler: eigene, nicht gespeicherte Änderung bleibt', state.flow.map((x) => x.name), ['Miete']);
  localStorage.removeItem(`haushalt.cache.${r.key}`);

  // Wochenplan: alte Tageszeile wird eingelesen und beim ersten Abgleich durch Zeilen je Mahlzeit ersetzt;
  // Mittag und Abend am selben Tag überschreiben sich nicht mehr
  r = fakeRemote([...base, { collection: 'plan', id: '2026-11-13', data: { mittag: { title: 'Pasta' }, abend: { title: 'Suppe' } } }]);
  await startShared(r, 'Test');
  eq('Wochenplan: alte Tageszeile wird gelesen', state.plan['2026-11-13'], { mittag: { title: 'Pasta' }, abend: { title: 'Suppe' } });
  update((s) => { s.plan['2026-11-13'].abend = { title: 'Pizza' }; });
  await new Promise((ok) => setTimeout(ok, 20));
  eq('Wochenplan: Tageszeile ersetzt', [r.db.has('plan/2026-11-13'), r.db.get('plan/2026-11-13:abend')?.data, r.db.get('plan/2026-11-13:mittag')?.data], [false, { title: 'Pizza' }, { title: 'Pasta' }]);
  r.db.set('plan/2026-11-13:mittag', { collection: 'plan', id: '2026-11-13:mittag', data: { title: 'Reis' } }); // anderes Gerät ändert den Mittag
  await pull();
  eq('Wochenplan: fremder Mittag kommt an, eigener Abend bleibt', [state.plan['2026-11-13'].mittag, state.plan['2026-11-13'].abend], [{ title: 'Reis' }, { title: 'Pizza' }]);
  update((s) => { delete s.plan['2026-11-13'].mittag; });
  await new Promise((ok) => setTimeout(ok, 20));
  eq('Wochenplan: gelöschter Mittag verschwindet in der Datenbank', r.db.has('plan/2026-11-13:mittag'), false);
  localStorage.removeItem(`haushalt.cache.${r.key}`);
}

function testDonut() {
  const svg = donutSvg([{ value: 50, cls: 'a' }, { value: 0, cls: 'b' }, { value: 25, cls: 'c' }], 100);
  eq('Ring: Teile ohne Wert werden übersprungen', (svg.match(/dn-arc/g) || []).length, 2);
  eq('Ring: ohne Gesamtwert kein Teil', (donutSvg([{ value: 5, cls: 'a' }], 0).match(/dn-arc/g) || []).length, 0);
}

function testMenuRoll() {
  const idea = (id, title, ingredients = []) => ({ id, title, ingredients });
  const ideas = [idea('1', 'Pasta', ['400 g Spaghetti']), idea('2', 'Curry', ['1 Zucchetti']), idea('3', 'Suppe', ['Karotten']), idea('4', 'Pizza'), idea('5', 'Risotto')];
  const titles = (picks) => picks.map((p) => p.title);
  const week = pickMenus({ ideas, count: 5 });
  eq('Würfeln: fünf verschiedene Gerichte für fünf Tage', new Set(titles(week)).size, 5);
  eq('Würfeln: zu wenige Ideen – Gerichte wiederholen sich, aber alle Tage sind gefüllt', pickMenus({ ideas: ideas.slice(0, 2), count: 5 }).length, 5);
  eq('Würfeln: ohne Ideen nichts', pickMenus({ ideas: [], count: 3 }), []);
  const free = pickMenus({ ideas, count: 3, taken: new Set(['pasta', 'curry']) });
  eq('Würfeln: bereits geplante Gerichte kommen erst zuletzt', titles(free).slice(0, 3).sort(), ['Pizza', 'Risotto', 'Suppe']);
  eq('Würfeln: Kühlschrank-Zutat passt (dringend zählt mehr)', [fridgeMatch(idea('x', 'X', ['2 Zucchetti']), [{ name: 'Zucchetti', urgent: true }]), fridgeMatch(idea('x', 'X', ['2 Zucchetti']), [{ name: 'Zucchetti', urgent: false }]), fridgeMatch(idea('x', 'X', ['Reis']), [{ name: 'Zucchetti', urgent: true }])], [2, 1, 0]);
  let at = 0; // erster Wurf immer ganz vorn: mit Kühlschrank-Gewicht trotzdem die Idee mit passender Zutat, wenn der Wurf dort landet
  const heavy = pickMenus({ ideas, count: 1, fridge: [{ name: 'Zucchetti', urgent: true }], rnd: () => (at += 0.5, 0.5) });
  eq('Würfeln: Gericht mit dringender Kühlschrank-Zutat hat mehr Gewicht', titles(heavy), ['Curry']);
}

export async function run() {
  testBalances();
  testMenuRoll();
  testDonut();
  testMoney();
  testBills();
  try { await testSync(); } catch (err) { results.push({ name: 'Abgleich', ok: false, detail: err.message }); }
  return results;
}
