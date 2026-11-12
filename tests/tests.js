// Tests für die heikle Logik: Abrechnung, Geldbeträge, Rechnungen im Monat, Abgleich mit der Datenbank.
// Öffnen: tests.html im Browser (lokal über `python3 serve.py` oder auf GitHub Pages). Läuft mit einem
// nachgebauten Haushalt (keine Verbindung zu Supabase), echte Daten bleiben unberührt.

import { balances } from '../js/settle.js';
import { parseMoney } from '../js/ui.js';
import { pull, startShared, state, update } from '../js/store.js';
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
}

export async function run() {
  testBalances();
  testMoney();
  testBills();
  try { await testSync(); } catch (err) { results.push({ name: 'Abgleich', ok: false, detail: err.message }); }
  return results;
}
