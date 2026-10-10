// Abteilungen im Laden: Reihenfolge und Zuordnung der Einkaufsartikel.
//
// Standard ist die übliche Reihenfolge in Schweizer Supermärkten; jeder Haushalt kann sie an seinen Laden
// anpassen (settings.aisleOrder). Die Abteilung eines Artikels wird am Namen erkannt (Stichwörter unten).
// Wer einen Artikel einer anderen Abteilung zuordnet, speichert das beim Begriff (terms[].aisle) – das gilt
// danach für den ganzen Haushalt und geht der Erkennung vor.

import { termKey } from './store.js';

export const AISLES = [
  { id: 'gemuese', label: 'Früchte & Gemüse' },
  { id: 'brot', label: 'Brot & Backwaren' },
  { id: 'fleisch', label: 'Fleisch & Fisch' },
  { id: 'milch', label: 'Milch, Käse & Eier' },
  { id: 'vorrat', label: 'Teigwaren, Reis & Vorrat' },
  { id: 'suess', label: 'Frühstück, Süsses & Snacks' },
  { id: 'kaffee', label: 'Kaffee & Tee' },
  { id: 'getraenke', label: 'Getränke' },
  { id: 'tiefkuehl', label: 'Tiefkühl' },
  { id: 'haushalt', label: 'Haushalt & Putzen' },
  { id: 'pflege', label: 'Körperpflege & Drogerie' },
  { id: 'sonstiges', label: 'Sonstiges' },
];
export const DEFAULT_AISLE = 'sonstiges';

// Stichwörter klein und ohne Umlaut-Punkte (siehe plain). Gesucht wird irgendwo im Namen – deutsche Wörter
// sind oft zusammengesetzt („Hafermilch“). Passen mehrere, gewinnt das längste: „Tomaten passiert“ → Vorrat,
// „Eisbergsalat“ → Gemüse, „Kokosmilch“ → Vorrat.
const KEYWORDS = {
  gemuese: ['apfel', 'birne', 'banane', 'orange', 'mandarine', 'clementine', 'zitrone', 'limette', 'traube', 'beere',
    'kirsche', 'pfirsich', 'nektarine', 'aprikose', 'zwetschge', 'pflaume', 'melone', 'ananas', 'mango', 'kiwi',
    'avocado', 'granatapfel', 'feige', 'tomate', 'cherrytomate', 'gurke', 'salat', 'rucola', 'nusslisalat', 'spinat',
    'kartoffel', 'herdopfel', 'zwiebel', 'schalotte', 'knoblauch', 'karotte', 'ruebli', 'peperoni', 'paprika',
    'zucchetti', 'zucchini', 'aubergine', 'broccoli', 'brokkoli', 'blumenkohl', 'kohl', 'lauch', 'sellerie', 'fenchel',
    'pilz', 'champignon', 'eierschwammli', 'krauter', 'basilikum', 'petersilie', 'schnittlauch', 'koriander', 'minze',
    'rosmarin', 'thymian', 'ingwer', 'chili', 'randen', 'radieschen', 'rettich', 'spargel', 'kurbis', 'artischocke',
    'bohnen', 'erbsen', 'frucht', 'fruchte', 'obst', 'gemuse', 'suppengemuse'],
  brot: ['brot', 'zopf', 'gipfeli', 'weggli', 'brotchen', 'semmel', 'baguette', 'toast', 'croissant', 'burli',
    'fladenbrot', 'tortilla', 'wrap', 'knackebrot', 'kuchen', 'waehe', 'wahe', 'blatterteig', 'kuchenteig', 'pizzateig'],
  fleisch: ['fleisch', 'hackfleisch', 'gehacktes', 'poulet', 'huhn', 'hahnchen', 'truthahn', 'rind', 'schwein', 'kalb',
    'lamm', 'wurst', 'cervelat', 'salami', 'schinken', 'speck', 'aufschnitt', 'bratwurst', 'wienerli', 'steak',
    'schnitzel', 'geschnetzeltes', 'filet', 'entrecote', 'fisch', 'lachs', 'forelle', 'kabeljau', 'dorsch',
    'crevetten', 'garnelen', 'scampi', 'muscheln', 'bundnerfleisch', 'trockenfleisch'],
  milch: ['milch', 'joghurt', 'jogurt', 'quark', 'rahm', 'sahne', 'halbrahm', 'butter', 'kase', 'mozzarella',
    'parmesan', 'feta', 'gruyere', 'emmentaler', 'appenzeller', 'raclette', 'fondue', 'mascarpone', 'ricotta',
    'hüttenkase', 'huttenkase', 'frischkase', 'eier', 'margarine', 'creme fraiche', 'sauerrahm', 'skyr', 'kefir',
    'tofu', 'frische pasta', 'gnocchi'],
  vorrat: ['teigwaren', 'spaghetti', 'pasta', 'nudeln', 'penne', 'fusilli', 'lasagne', 'magronen', 'hornli', 'reis',
    'risotto', 'couscous', 'bulgur', 'quinoa', 'polenta', 'mehl', 'zucker', 'salz', 'pfeffer', 'gewurz', 'paprikapulver',
    'curry', 'currypaste', 'oel', 'olivenol', 'rapsol', 'sonnenblumenol', 'essig', 'bouillon', 'sauce', 'sosse',
    'ketchup', 'mayonnaise', 'mayo', 'senf', 'passiert', 'pelati', 'tomatenmark', 'konserve', 'dose', 'linsen',
    'kichererbsen', 'kidneybohnen', 'kokosmilch', 'thon', 'thunfisch', 'mais', 'oliven', 'kapern', 'essiggurken',
    'backpulver', 'hefe', 'vanillezucker', 'pesto', 'sojasauce', 'nudelsauce', 'suppe', 'paniermehl'],
  suess: ['muesli', 'musli', 'cornflakes', 'haferflocken', 'granola', 'konfiture', 'marmelade', 'honig', 'nutella',
    'schokolade', 'schoggi', 'guetzli', 'keks', 'biskuit', 'chips', 'nusse', 'mandeln', 'haselnusse', 'baumnusse',
    'erdnusse', 'snack', 'riegel', 'bonbon', 'gummibarchen', 'zwieback', 'apfelmus', 'popcorn', 'salzstangen'],
  kaffee: ['kaffee', 'espresso', 'kapseln', 'kaffeebohnen', 'tee', 'kakao', 'ovomaltine', 'kaffeerahm'],
  getraenke: ['wasser', 'mineral', 'saft', 'orangensaft', 'cola', 'bier', 'wein', 'rotwein', 'weisswein', 'prosecco',
    'champagner', 'sirup', 'eistee', 'limonade', 'rivella', 'apfelschorle', 'mineralwasser', 'tonic', 'gin', 'aperol'],
  tiefkuehl: ['tiefkuhl', 'tk ', 'glace', 'eiscreme', 'eiswurfel', 'pommes', 'frites', 'fischstabli', 'tiefgekuhlt',
    'pizza', 'spinat tk', 'gefroren'],
  haushalt: ['wc-papier', 'toilettenpapier', 'klopapier', 'haushaltpapier', 'kuchenrolle', 'abwaschmittel',
    'spulmittel', 'geschirrspul', 'tabs', 'waschmittel', 'weichspuler', 'putzmittel', 'reiniger', 'schwamm',
    'abfallsack', 'kehrichtsack', 'mullsack', 'alufolie', 'frischhaltefolie', 'backpapier', 'batterie', 'kerze',
    'servietten', 'entkalker', 'glühbirne', 'gluhbirne', 'zundholz', 'feuerzeug'],
  pflege: ['shampoo', 'duschgel', 'dusch', 'seife', 'zahnpasta', 'zahnbürste', 'zahnburste', 'zahnseide', 'deo',
    'handcreme', 'sonnencreme', 'bodylotion', 'lotion', 'rasier', 'wattestabchen', 'watte', 'taschentucher',
    'binden', 'tampons', 'windeln', 'pflaster', 'mundspulung', 'haarspray', 'conditioner'],
};

// Klein, ohne Akzente/Umlaut-Punkte: „Äpfel“ → „apfel“, „Rüebli“ → „ruebli“
const plain = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RULES = Object.entries(KEYWORDS)
  .flatMap(([aisle, words]) => words.map((w) => [plain(w), aisle]))
  .sort((a, b) => b[0].length - a[0].length); // längste zuerst

// Abteilung allein aus dem Namen (ohne gemerkte Zuordnung)
export function guessAisle(name) {
  const text = ` ${plain(name)} `;
  for (const [word, aisle] of RULES) if (text.includes(word)) return aisle;
  return DEFAULT_AISLE;
}

// Abteilung eines Artikels: gemerkte Zuordnung beim Begriff, sonst erkannt
export function aisleOf(name, terms) {
  const term = terms.find((t) => t.id === termKey(name));
  return AISLES.some((a) => a.id === term?.aisle) ? term.aisle : guessAisle(name);
}

// Reihenfolge der Abteilungen für diesen Haushalt (fehlende hinten anhängen, unbekannte weglassen)
export function aisleOrder(settings) {
  const valid = new Set(AISLES.map((a) => a.id));
  const saved = (Array.isArray(settings?.aisleOrder) ? settings.aisleOrder : []).filter((id) => valid.has(id));
  return [...new Set([...saved, ...AISLES.map((a) => a.id)])];
}

export const aisleLabel = (id) => AISLES.find((a) => a.id === id)?.label || 'Sonstiges';
