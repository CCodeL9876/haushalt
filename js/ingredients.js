// Rezeptzeilen für die Einkaufsliste: „400 g fest kochende Kartoffeln“ → Artikel „fest kochende Kartoffeln“, Menge „400 g“.
// Grundzutaten (Salz, Pfeffer, Öl …) sind beim Einkaufen anfangs abgewählt – die hat man meist zu Hause.

const UNITS = [
  'kg', 'g', 'mg', 'l', 'dl', 'cl', 'ml', 'el', 'tl', 'msp', 'essl[öo]ffel', 'teel[öo]ffel', 'prisen?', 'st[üu]ck', 'stk',
  'bund', 'dosen?', 'packungen?', 'pack', 'pck', 'p[äa]ckchen', 'beutel', 'becher', 'gl[äa]ser', 'glas', 'tassen?',
  'zehen?', 'scheiben?', 'zweige?', 'handvoll', 'w[üu]rfel', 'bl[äa]tter', 'blatt', 'stiele?', 'stangen?', 'k[öo]pfe?',
  'tropfen', 'spritzer', 'schuss', 'portionen?', 'flaschen?', 'kugeln?', 'knollen?', 'tranchen?',
];
const NUMBER = '(?:\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|[½¼¾⅓⅔⅛])(?:\\s*[½¼¾⅓⅔])?';
const AMOUNT = new RegExp(`^\\s*(${NUMBER}(?:\\s*(?:-|–|bis)\\s*${NUMBER})?)\\s*(?:(${UNITS.join('|')})\\.?(?=[\\s,]|$))?[\\s,]*`, 'i');
// Ungefähre Mengen ohne Zahl: „wenig Pfeffer“, „etwas Butter“, „1 Prise Salz“
const VAGUE = /^\s*(wenig|etwas|einige|ein paar|nach belieben|evtl\.?|eventuell|n\.\s?b\.|nach bedarf)\s+/i;
const QUALIFIER = /^(gestr\.|gestrichen|geh\.|gehäuft|knapp|gross|groß|klein|mittelgrosse?|mittelgroße?)\s+/i;

// → { name, amount }: amount enthält Menge, Einheit und Zusätze („gehackt“, Klammertexte)
export function splitIngredient(line) {
  let rest = String(line || '').trim();
  const extras = [];
  let amount = '';
  const m = AMOUNT.exec(rest);
  if (m && m[0].trim()) {
    amount = [m[1], m[2]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    rest = rest.slice(m[0].length);
  } else {
    const v = VAGUE.exec(rest);
    if (v) {
      amount = v[1];
      rest = rest.slice(v[0].length);
    }
  }
  const q = QUALIFIER.exec(rest);
  if (q) {
    extras.push(q[1]);
    rest = rest.slice(q[0].length);
  }
  // Klammertexte und alles nach dem ersten Komma sind Zusätze, kein Teil des Artikels
  rest = rest.replace(/\(([^)]*)\)/g, (all, inner) => {
    if (/^(n|e|en|s|er|es)$/i.test(inner)) return ''; // „Zwiebel(n)“ → „Zwiebel“
    extras.push(inner.trim());
    return '';
  });
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    extras.push(rest.slice(comma + 1).trim());
    rest = rest.slice(0, comma);
  }
  const name = rest.replace(/\s+/g, ' ').trim() || String(line || '').trim();
  return { name, amount: [amount, ...extras.filter(Boolean)].join(' · ') };
}

const STAPLES = ['salz', 'pfeffer', 'wasser', 'zucker', 'mehl', 'öl', 'oel', 'olivenöl', 'rapsöl', 'sonnenblumenöl',
  'essig', 'muskat', 'muskatnuss', 'bratbutter', 'eiswasser', 'pfeffer aus der mühle', 'salz und pfeffer', 'salz, pfeffer'];

// Grundzutat, die man meist zu Hause hat?
export function isStaple(name) {
  const n = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return STAPLES.includes(n) || /^(salz|pfeffer|wasser)\b/.test(n);
}
