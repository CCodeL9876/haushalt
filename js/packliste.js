// Packliste: eine Listenart in ToDo (list.kind = 'pack'), geteilt oder nur für mich (js/views/todo.js).
// Anders als bei ToDos bleibt Gepacktes sichtbar (durchgestrichen), geordnet nach Kategorien, mit Fortschritt.
//   Liste:  { …, kind: 'pack', days }                      days: Reisedauer für Mengen „pro Tag“
//   Eintrag (in todos): { id, listId, title, cat, perDay?, qty?, assignee?, buy?, note, done, doneAt?, addedAt }
//           perDay: Anzahl pro Tag (Menge = Tage × perDay, aufgerundet), qty: feste Menge („2×“, „1 Paar“)
//           buy: fehlt noch – steht auf der Einkaufsliste
//   Vorlagen: mitgelieferte (unten) und eigene in state.settings.packTemplates [{ id, name, days, items }]
//   Zusatz-Pakete (ADDONS): kleine Ergänzungen zur Vorlage (Baby, Hund, Velo …), beim Anlegen frei kombinierbar,
//             eigene und angepasste in state.settings.packAddons
//   Verwalten (Haushalt → Packlisten-Vorlagen): Inhalte entfernen/ergänzen, Name, Symbol, Tage. Mitgelieferte werden
//             beim ersten Ändern als eigene Kopie mit gleicher id gespeichert (ersetzt die mitgelieferte, „Auf Original
//             zurücksetzen“ löscht die Kopie); ausblenden über state.settings.packHidden [ids].

import { refresh, state, uid, update } from './store.js';
import { currentMember } from './login.js';
import { addToShopping } from './views/einkauf.js';
import { avatar, closeSheet, esc, icon, openSheet, toast } from './ui.js';

export const CATS = [
  ['kleidung', 'Kleidung'], ['hygiene', 'Hygiene'], ['gesundheit', 'Gesundheit'], ['elektronik', 'Elektronik'],
  ['dokumente', 'Dokumente & Geld'], ['unterwegs', 'Unterwegs'], ['sonstiges', 'Sonstiges'],
];
const catLabel = (id) => (CATS.find(([c]) => c === id) || CATS.at(-1))[1];

// Kategorie am Namen erkennen (beim schnellen Erfassen); sonst „Sonstiges“
const CAT_WORDS = [
  ['kleidung', /shirt|hose|shorts|jacke|pull|socke|unterw|unterhose|bh\b|kleid|rock|schuh|sandale|mütze|kappe|handschuh|schal|pyjama|badekleid|bikini|badehose|gürtel|regenjacke/i],
  ['hygiene', /zahn|deo|dusch|shampoo|seife|creme|lotion|rasier|kamm|bürste|haar|schmink|parfum|tampon|binde|nagel|wattest|kontaktlinse|sonnencreme|after.?sun/i],
  ['gesundheit', /medi|tablette|pflaster|apotheke|schmerz|allergie|fieber|thermometer|maske|desinf|mücke|insekt/i],
  ['elektronik', /lade|kabel|handy|powerbank|kopfhörer|adapter|laptop|tablet|kamera|uhr|stecker|akku|e-?reader/i],
  ['dokumente', /pass\b|reisepass|id\b|identit|ausweis|karte|kredit|bargeld|geld|ticket|billett|versicherung|buchung|bestätigung|führerschein|visum/i],
  ['unterwegs', /sonnenbrille|tuch|buch|flasche|rucksack|schirm|snack|kissen|tasche|brille|spiel|zeitschrift/i],
];
export const catOf = (name) => CAT_WORDS.find(([, re]) => re.test(name))?.[0] || 'sonstiges';

const T = (title, cat, extra = {}) => ({ title, cat, ...extra });
export const BUILTIN = [
  {
    id: 'strand', emoji: '🏖️', name: 'Strandferien', days: 7,
    items: [
      T('T-Shirt', 'kleidung', { perDay: 1 }), T('Unterwäsche', 'kleidung', { perDay: 1 }), T('Socken', 'kleidung', { perDay: 0.5 }),
      T('Shorts', 'kleidung', { qty: '2×' }), T('Badekleid', 'kleidung', { qty: '2×' }), T('Pullover', 'kleidung'), T('Sandalen', 'kleidung'), T('Pyjama', 'kleidung'),
      T('Zahnbürste', 'hygiene'), T('Zahnpasta', 'hygiene'), T('Duschmittel', 'hygiene'), T('Deo', 'hygiene'), T('Sonnencreme', 'hygiene'), T('After-Sun', 'hygiene'),
      T('Reiseapotheke', 'gesundheit'), T('Persönliche Medikamente', 'gesundheit'), T('Mückenschutz', 'gesundheit'),
      T('Handy-Ladekabel', 'elektronik'), T('Powerbank', 'elektronik'), T('Kopfhörer', 'elektronik'), T('Reiseadapter', 'elektronik'),
      T('Pass / ID', 'dokumente'), T('Krankenkassenkarte', 'dokumente'), T('Kreditkarte', 'dokumente'), T('Bargeld', 'dokumente'), T('Reiseunterlagen', 'dokumente'),
      T('Sonnenbrille', 'unterwegs'), T('Strandtuch', 'unterwegs'), T('Buch', 'unterwegs'), T('Wasserflasche', 'unterwegs'),
    ],
  },
  {
    id: 'stadt', emoji: '🏙️', name: 'Städtetrip', days: 3,
    items: [
      T('T-Shirt', 'kleidung', { perDay: 1 }), T('Unterwäsche', 'kleidung', { perDay: 1 }), T('Socken', 'kleidung', { perDay: 1 }),
      T('Hose', 'kleidung', { qty: '2×' }), T('Pullover', 'kleidung'), T('Bequeme Schuhe', 'kleidung'), T('Regenjacke', 'kleidung'), T('Pyjama', 'kleidung'),
      T('Zahnbürste', 'hygiene'), T('Zahnpasta', 'hygiene'), T('Deo', 'hygiene'), T('Duschmittel', 'hygiene'),
      T('Persönliche Medikamente', 'gesundheit'), T('Pflaster', 'gesundheit'),
      T('Handy-Ladekabel', 'elektronik'), T('Powerbank', 'elektronik'), T('Kopfhörer', 'elektronik'),
      T('ID / Pass', 'dokumente'), T('Kreditkarte', 'dokumente'), T('Bahnbillett / Ticket', 'dokumente'), T('Hotelbestätigung', 'dokumente'),
      T('Tagesrucksack', 'unterwegs'), T('Regenschirm', 'unterwegs'), T('Wasserflasche', 'unterwegs'),
    ],
  },
  {
    id: 'berge', emoji: '🏔️', name: 'Ab in die Berge', days: 4,
    items: [
      T('Funktions-Shirt', 'kleidung', { perDay: 1 }), T('Unterwäsche', 'kleidung', { perDay: 1 }), T('Wandersocken', 'kleidung', { perDay: 1 }),
      T('Wanderhose', 'kleidung', { qty: '2×' }), T('Fleece / Pullover', 'kleidung'), T('Regenjacke', 'kleidung'), T('Warme Jacke', 'kleidung'),
      T('Mütze', 'kleidung'), T('Handschuhe', 'kleidung'), T('Wanderschuhe', 'kleidung'), T('Hausschuhe / Hüttenfinken', 'kleidung'), T('Pyjama', 'kleidung'),
      T('Zahnbürste', 'hygiene'), T('Zahnpasta', 'hygiene'), T('Duschmittel', 'hygiene'), T('Deo', 'hygiene'), T('Sonnencreme (hoher Schutz)', 'hygiene'), T('Lippenpflege mit UV-Schutz', 'hygiene'),
      T('Reiseapotheke', 'gesundheit'), T('Blasenpflaster', 'gesundheit'), T('Persönliche Medikamente', 'gesundheit'), T('Zeckenschutz', 'gesundheit'),
      T('Handy-Ladekabel', 'elektronik'), T('Powerbank', 'elektronik'), T('Stirnlampe', 'elektronik'),
      T('ID', 'dokumente'), T('Krankenkassenkarte', 'dokumente'), T('Kreditkarte', 'dokumente'), T('Bargeld', 'dokumente'), T('Halbtax / GA', 'dokumente'), T('Hüttenreservation', 'dokumente'),
      T('Wanderrucksack', 'unterwegs'), T('Trinkflasche', 'unterwegs'), T('Sonnenbrille', 'unterwegs'), T('Sonnenhut / Kappe', 'unterwegs'), T('Wanderstöcke', 'unterwegs'),
      T('Wanderkarte / App offline', 'unterwegs'), T('Taschenmesser', 'unterwegs'), T('Proviant & Snacks', 'unterwegs'), T('Hüttenschlafsack', 'unterwegs'),
    ],
  },
];
// Mitgelieferte (ersetzt durch eine Anpassung mit gleicher id), dahinter die eigenen
const merged = (base, mine) => [
  ...base.map((b) => {
    const m = mine.find((x) => x.id === b.id);
    return { ...(m || b), builtin: true, changed: Boolean(m) };
  }),
  ...mine.filter((m) => !base.some((b) => b.id === m.id)),
];
const hiddenIds = () => new Set(state.settings.packHidden || []);
export const allTemplates = () => merged(BUILTIN, state.settings.packTemplates || []);
export const templates = () => allTemplates().filter((t) => !hiddenIds().has(t.id));

// Zusatz-Pakete: werden zur gewählten Vorlage dazugenommen (Doppeltes nur einmal)
export const ADDONS = [
  {
    id: 'baby', emoji: '👶', name: 'Baby',
    items: [
      T('Windeln', 'hygiene', { perDay: 6 }), T('Feuchttücher', 'hygiene'), T('Wickelunterlage', 'hygiene'), T('Baby-Sonnencreme', 'hygiene'),
      T('Bodys', 'kleidung', { perDay: 2 }), T('Schlafsack (Baby)', 'kleidung'), T('Fieberthermometer', 'gesundheit'),
      T('Schoppen / Fläschchen', 'sonstiges'), T('Babynahrung', 'sonstiges'), T('Nuggi', 'sonstiges'), T('Lieblingsplüschtier', 'sonstiges'),
      T('Babytrage', 'unterwegs'), T('Reisebett', 'unterwegs'),
    ],
  },
  {
    id: 'hund', emoji: '🐕', name: 'Hund',
    items: [
      T('Hundefutter', 'sonstiges'), T('Napf', 'sonstiges'), T('Hundedecke', 'sonstiges'), T('Hundespielzeug', 'sonstiges'),
      T('Leine', 'unterwegs'), T('Robidog-Säckli', 'unterwegs'), T('Heimtierpass', 'dokumente'), T('Zeckenmittel (Hund)', 'gesundheit'),
    ],
  },
  {
    id: 'velo', emoji: '🚲', name: 'Velo',
    items: [
      T('Velohelm', 'unterwegs'), T('Veloschloss', 'unterwegs'), T('Flickzeug', 'unterwegs'), T('Velopumpe', 'unterwegs'),
      T('Velolicht', 'elektronik'), T('Velohose', 'kleidung'), T('Velohandschuhe', 'kleidung'), T('Trinkflasche', 'unterwegs'),
    ],
  },
  {
    id: 'winter', emoji: '⛷️', name: 'Wintersport',
    items: [
      T('Skijacke', 'kleidung'), T('Skihose', 'kleidung'), T('Skisocken', 'kleidung', { perDay: 1 }), T('Thermowäsche', 'kleidung', { qty: '2×' }),
      T('Skihandschuhe', 'kleidung'), T('Halswärmer', 'kleidung'), T('Mütze', 'kleidung'),
      T('Skibrille', 'unterwegs'), T('Helm', 'unterwegs'), T('Skipass', 'dokumente'), T('Sonnencreme (hoher Schutz)', 'hygiene'),
    ],
  },
  {
    id: 'arbeit', emoji: '💼', name: 'Arbeit',
    items: [
      T('Laptop', 'elektronik'), T('Laptop-Ladegerät', 'elektronik'), T('Notizbuch', 'sonstiges'), T('Kugelschreiber', 'sonstiges'),
      T('Hemd / Bluse', 'kleidung', { qty: '2×' }), T('Badge / Ausweis Firma', 'dokumente'),
    ],
  },
];

export const allAddons = () => merged(ADDONS, state.settings.packAddons || []);
export const addons = () => allAddons().filter((a) => !hiddenIds().has(a.id));

// Vorlage oder Zusatz-Paket nach id (für „Dazunehmen“ bei einer bestehenden Liste)
export const packSource = (id) => templates().find((t) => t.id === id) || addons().find((a) => a.id === id) || null;

// Einträge aus Vorlage und Paketen zusammen, gleicher Name nur einmal (der erste gewinnt)
export function combinedItems(tplId, addonIds = []) {
  const seen = new Set();
  return [packSource(tplId), ...addonIds.map((id) => addons().find((a) => a.id === id))]
    .flatMap((x) => x?.items || [])
    .filter((it) => {
      const k = it.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ---------- Auswahl beim Anlegen (Fenster „Neue Liste“ in js/views/todo.js) ----------
// Kacheln für die Vorlagen (eigene mit ⭐), Zusatz-Pakete als Chips, Tage mit − / +, Vorschau nach Kategorien.

export function packPicker() {
  const tile = (t) => `
    <label class="tpl-tile">
      <input type="radio" name="template" value="${esc(t.id)}">
      <span class="tpl-emoji" aria-hidden="true">${t.emoji || '⭐'}</span>
      <strong>${esc(t.name)}</strong>
      <small>${t.days ? `${t.days} ${t.days === 1 ? 'Tag' : 'Tage'} · ` : ''}${t.items.length} Sachen</small>
    </label>`;
  return `
    <div class="field"><span class="field-head">Vorlage <button type="button" class="link-btn" data-sheet-action="manageTemplates">Vorlagen bearbeiten</button></span>
      <div class="tpl-grid">${templates().map(tile).join('')}
        <label class="tpl-tile tpl-empty">
          <input type="radio" name="template" value="" checked>
          <span class="tpl-emoji" aria-hidden="true">＋</span><strong>Leer</strong><small>selbst füllen</small>
        </label>
      </div>
    </div>
    <div class="field"><span>Dazu packen</span>
      <div class="chips">${addons().map((a) => `<label class="chip chip-toggle"><input type="checkbox" name="addon" value="${esc(a.id)}">${a.emoji} ${esc(a.name)}</label>`).join('')}</div>
    </div>
    <p class="tpl-preview muted small" aria-live="polite"></p>
    <div class="field stepper-field"><span>Tage</span>
      <div class="stepper">
        <button type="button" class="icon-btn" data-sheet-action="days" data-step="-1" aria-label="Ein Tag weniger">−</button>
        <input class="input" type="number" name="days" min="1" max="90" inputmode="numeric" value="3" aria-label="Tage">
        <button type="button" class="icon-btn" data-sheet-action="days" data-step="1" aria-label="Ein Tag mehr">+</button>
      </div>
    </div>`;
}

const addonsOf = (f) => [...f.querySelectorAll('[name="addon"]:checked')].map((x) => x.value);

// Vorschau: „40 Sachen · 12 Kleidung · 6 Hygiene …“
function preview(f) {
  const items = combinedItems(f.elements.template.value, addonsOf(f));
  const counts = CATS.map(([id, label]) => [label, items.filter((it) => (it.cat || catOf(it.title)) === id).length]).filter(([, n]) => n);
  f.querySelector('.tpl-preview').textContent = items.length
    ? `${items.length} Sachen · ${counts.map(([l, n]) => `${n} ${l}`).join(' · ')}`
    : 'Leere Packliste – du füllst sie selbst.';
}

export const packPickerActions = {
  // Vorlage gewählt: Tage und Name übernehmen (den Namen nur, solange er leer ist oder von der letzten Vorlage stammt)
  change(el, f) {
    if (el.name === 'template') {
      const tpl = packSource(el.value);
      if (tpl?.days) f.elements.days.value = tpl.days;
      const name = f.elements.name;
      if (!name.value.trim() || name.value === f.dataset.autoName) {
        name.value = tpl?.name || '';
        f.dataset.autoName = name.value;
      }
    }
    if (el.name === 'template' || el.name === 'addon') preview(f);
  },
  days(btn, f) {
    const input = f.elements.days;
    input.value = Math.min(90, Math.max(1, (Number(input.value) || 0) + Number(btn.dataset.step)));
  },
  init(f) { preview(f); },
  manageTemplates() { openTemplates(); },
};

// Einträge einer Vorlage als neue Einträge der Liste
export const fromTemplate = (tpl, listId) => (tpl?.items || []).map((it, n) => ({
  id: uid(), listId, title: it.title, cat: it.cat || catOf(it.title), note: '', done: false, addedAt: Date.now() - n,
  ...(it.perDay ? { perDay: it.perDay } : {}), ...(it.qty ? { qty: it.qty } : {}),
}));

export const qtyText = (t, days) => (t.perDay ? `${Math.max(1, Math.ceil((days || 1) * t.perDay))}×` : t.qty || '');

// Für die Übersicht: „12 von 30 gepackt“
export function packInfo(list, todos) {
  const items = todos.filter((t) => t.listId === list.id);
  const packed = items.filter((t) => t.done).length;
  return { open: items.length - packed, text: items.length ? `${packed} von ${items.length} gepackt` : 'Noch leer' };
}

let onlyMine = false; // geteilte Packliste: nur die mir zugewiesenen (und für alle)

const mineFilter = (t) => {
  const me = currentMember()?.id;
  return !me || !t.assignee || t.assignee === me || !state.members.some((m) => m.id === t.assignee);
};

const packRow = (t, list, shared) => {
  const who = shared && t.assignee ? state.members.find((m) => m.id === t.assignee) : null;
  const qty = qtyText(t, list.days);
  return `
  <li class="${t.done ? 'is-done' : ''}">
    <button type="button" class="check" data-action="toggle" data-id="${esc(t.id)}" aria-label="${t.done ? 'Wieder auspacken' : 'Gepackt'}: ${esc(t.title)}">${icon('check', 'icon-sm')}</button>
    <button type="button" class="list-main" data-action="editPack" data-id="${esc(t.id)}" aria-label="${esc(t.title)} bearbeiten">
      ${esc(t.title)}${qty ? ` <span class="qty-pill">${esc(qty)}</span>` : ''}${t.note ? ` <span class="todo-note-mark" title="Mit Notiz">${icon('note', 'icon-xs')}</span>` : ''}
      ${t.buy && !t.done ? `<small class="pack-buy">${icon('cart', 'icon-xs')} fehlt noch – auf der Einkaufsliste</small>` : ''}
    </button>
    ${who ? `<span class="todo-who" title="Packt ${esc(who.name)}">${avatar(who)}</span>` : ''}
    <button type="button" class="icon-btn" data-action="remove" data-id="${esc(t.id)}" aria-label="${esc(t.title)} löschen">${icon('x', 'icon-sm')}</button>
  </li>`;
};

// Ansicht einer Packliste (Kopfzeile und Eingabe wie bei ToDo-Listen, darunter Fortschritt und Kategorien)
export function packView(scope, list, d, head) {
  const shared = scope === 'shared';
  const all = d.todos.filter((t) => t.listId === list.id);
  const items = shared && onlyMine ? all.filter(mineFilter) : all;
  const packed = items.filter((t) => t.done).length;
  const groups = CATS.map(([id, label]) => [label, items.filter((t) => (CATS.some(([c]) => c === t.cat) ? t.cat : 'sonstiges') === id)])
    .filter(([, list2]) => list2.length);
  return `
    ${head}
    <form class="add-row" data-form="addTodo">
      <input class="input" id="todo-input" name="title" placeholder="Was einpacken?" autocomplete="off" enterkeyhint="done" required maxlength="120">
      <button type="submit" class="btn btn-primary" aria-label="Hinzufügen">${icon('plus')}</button>
    </form>
    ${all.length ? `
      <div class="pack-progress">
        <div><strong>${packed}</strong> von ${items.length} gepackt${list.days ? ` · ${list.days} ${list.days === 1 ? 'Tag' : 'Tage'}` : ''}</div>
        <div class="mode-bar"><i style="width:${items.length ? Math.round((packed / items.length) * 100) : 0}%"></i></div>
      </div>
      ${shared && state.members.length > 1 ? `<div class="seg pack-filter" role="group" aria-label="Anzeigen">
        <button type="button" class="seg-btn" data-action="packFilter" data-mine="0" aria-pressed="${!onlyMine}">Alle</button>
        <button type="button" class="seg-btn" data-action="packFilter" data-mine="1" aria-pressed="${onlyMine}">Nur meine</button>
      </div>` : ''}
      ${groups.map(([label, rows]) => `
        <h3 class="aisle-title">${esc(label)}<span class="pack-count">${rows.filter((t) => t.done).length}/${rows.length}</span></h3>
        <ul class="list">${rows.sort((a, b) => Number(a.done) - Number(b.done) || (b.addedAt || 0) - (a.addedAt || 0)).map((t) => packRow(t, list, shared)).join('')}</ul>`).join('')}
      <div class="pack-actions">
        <button type="button" class="btn btn-block" data-action="repack">${icon('refresh', 'icon-sm')} Neu packen</button>
      </div>`
      : `<div class="empty"><strong>Noch leer</strong>Oben eintragen, was mitkommt – oder bei der Liste (${icon('settings', 'icon-xs')}) eine Vorlage übernehmen.</div>`}`;
}

// Neuer Eintrag beim schnellen Erfassen: Kategorie am Namen erkannt, ohne Fenster (es kommen meist viele)
export const newPackItem = (listId, title) => ({ id: uid(), listId, title: title.slice(0, 120), cat: catOf(title), note: '', done: false, addedAt: Date.now() });

// Eintrag bearbeiten: Kategorie, Menge (fest oder pro Tag), für wen, Notiz, „fehlt noch“
export function editPackItem(cur, id) {
  const t = cur.d.todos.find((x) => x.id === id);
  if (!t) return;
  const mode = t.perDay ? String(t.perDay) : t.qty ? 'fix' : '';
  const shared = cur.scope === 'shared';
  const form = openSheet({
    title: 'Packliste',
    body: `
      <label class="field"><span>Was</span><input class="input" name="title" value="${esc(t.title)}" required maxlength="120" autocomplete="off"></label>
      <label class="field"><span>Kategorie</span>
        <select class="select" name="cat">${CATS.map(([c, label]) => `<option value="${c}" ${c === (t.cat || 'sonstiges') ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </label>
      <div class="row">
        <label class="field"><span>Menge</span>
          <select class="select" name="mode">
            <option value="" ${mode === '' ? 'selected' : ''}>–</option>
            <option value="1" ${mode === '1' ? 'selected' : ''}>1 pro Tag</option>
            <option value="2" ${mode === '2' ? 'selected' : ''}>2 pro Tag</option>
            <option value="0.5" ${mode === '0.5' ? 'selected' : ''}>1 pro 2 Tage</option>
            <option value="fix" ${mode === 'fix' ? 'selected' : ''}>Feste Menge</option>
          </select>
        </label>
        <label class="field pack-qty" ${mode === 'fix' ? '' : 'hidden'}><span>Wie viel</span>
          <input class="input" name="qty" value="${esc(t.qty)}" maxlength="20" placeholder="2× · 1 Paar" autocomplete="off">
        </label>
      </div>
      <p class="muted small pack-days" style="margin:-6px 0 12px">${cur.list.days ? `Bei ${cur.list.days} Tagen: ${esc(qtyText({ perDay: Number(mode) }, cur.list.days)) || '–'}` : 'Reisedauer bei der Liste (Zahnrad) eintragen'}</p>
      ${shared && state.members.length ? `
      <fieldset class="field todo-assign"><legend>Wer packt es ein?</legend>
        <div class="chips">
          <label class="chip chip-toggle"><input type="radio" name="assignee" value="" ${t.assignee ? '' : 'checked'}>Alle</label>
          ${state.members.map((m) => `<label class="chip chip-toggle">${avatar(m)}<input type="radio" name="assignee" value="${esc(m.id)}" ${m.id === t.assignee ? 'checked' : ''}>${esc(m.name)}</label>`).join('')}
        </div>
      </fieldset>` : ''}
      <label class="field"><span>Notiz</span><textarea class="textarea" name="note" maxlength="500">${esc(t.note)}</textarea></label>
      ${t.buy ? `<p class="small pack-buy">${icon('cart', 'icon-xs')} Steht auf der Einkaufsliste</p>`
        : `<button type="button" class="btn btn-block" data-sheet-action="buy">${icon('cart', 'icon-sm')} Fehlt noch → auf die Einkaufsliste</button>`}`,
    submitLabel: 'Speichern',
    footer: '<button type="button" class="btn btn-danger btn-block" data-sheet-action="delete">Löschen</button>',
    actions: {
      change(el, f) {
        if (el.name !== 'mode') return;
        f.querySelector('.pack-qty').hidden = el.value !== 'fix';
        const p = f.querySelector('.pack-days');
        if (cur.list.days) p.textContent = `Bei ${cur.list.days} Tagen: ${qtyText({ perDay: Number(el.value) }, cur.list.days) || '–'}`;
      },
      buy(btn, f) {
        const title = f.elements.title.value.trim() || t.title;
        addToShopping([{ name: title, note: `für ${cur.list.name}` }]);
        cur.change((d) => { const x = d.todos.find((y) => y.id === id); if (x) x.buy = true; });
        btn.outerHTML = `<p class="small pack-buy">${icon('cart', 'icon-xs')} Steht auf der Einkaufsliste</p>`;
        toast(`${title} auf der Einkaufsliste`);
      },
      delete() {
        cur.change((d) => { d.todos = d.todos.filter((x) => x.id !== id); });
        closeSheet();
      },
    },
    onSubmit(data) {
      const title = String(data.get('title') || '').trim();
      if (!title) return false;
      const m = String(data.get('mode') || '');
      cur.change((d) => {
        const x = d.todos.find((y) => y.id === id);
        if (!x) return;
        Object.assign(x, { title: title.slice(0, 120), cat: String(data.get('cat')), note: String(data.get('note') || '').trim().slice(0, 500) });
        delete x.perDay;
        delete x.qty;
        if (m === 'fix' && String(data.get('qty') || '').trim()) x.qty = String(data.get('qty')).trim().slice(0, 20);
        else if (Number(m) > 0) x.perDay = Number(m);
        if (form.elements.assignee) x.assignee = String(data.get('assignee') || '');
      });
    },
  });
}

// Aktionen der Packliste – todo.js reicht sie weiter (cur = geöffnete Liste)
export const packActions = (current) => ({
  editPack(el) {
    const cur = current();
    if (cur) editPackItem(cur, el.dataset.id);
  },
  packFilter(el) {
    onlyMine = el.dataset.mine === '1';
    refresh();
  },
  repack() {
    const cur = current();
    if (!cur || !confirm('Alle Häkchen zurücksetzen und neu packen?')) return;
    cur.change((d) => {
      for (const t of d.todos) {
        if (t.listId !== cur.list.id) continue;
        t.done = false;
        delete t.doneAt;
      }
    });
    toast('Alles wieder ungepackt');
  },
});

// Liste als eigene Vorlage speichern (für den ganzen Haushalt, ohne Häkchen, Personen und Notizen).
// Gleicher Name wie eine bestehende Vorlage (auch eine mitgelieferte): diese wird ersetzt.
export function saveTemplate(update, list, todos) {
  const name = prompt('Name der Vorlage', list.name);
  if (!name?.trim()) return;
  const items = todos.filter((t) => t.listId === list.id).map((t) => ({ title: t.title, cat: t.cat, ...(t.perDay ? { perDay: t.perDay } : {}), ...(t.qty ? { qty: t.qty } : {}) }));
  const same = allTemplates().find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  update((s) => {
    const own = (s.settings.packTemplates || []).filter((x) => x.id !== same?.id);
    s.settings.packTemplates = [...own, { id: same?.id || uid(), emoji: same?.emoji, name: name.trim().slice(0, 40), days: list.days || 0, items }].slice(-30);
    if (same) s.settings.packHidden = (s.settings.packHidden || []).filter((x) => x !== same.id);
  });
  toast(`Vorlage „${name.trim()}“ gespeichert`);
}

// ---------- Vorlagen verwalten ----------

const KINDS = {
  tpl: { key: 'packTemplates', base: BUILTIN, all: allTemplates, one: 'Vorlage', many: 'Vorlagen' },
  addon: { key: 'packAddons', base: ADDONS, all: allAddons, one: 'Zusatz-Paket', many: 'Zusatz-Pakete' },
};

// Ändern; eine mitgelieferte wird dabei zuerst als eigene Kopie (gleiche id) abgelegt
function changeSource(kind, id, fn) {
  const k = KINDS[kind];
  update((s) => {
    s.settings[k.key] ||= [];
    let x = s.settings[k.key].find((m) => m.id === id);
    if (!x) {
      const b = k.base.find((m) => m.id === id);
      if (!b) return;
      x = structuredClone(b);
      s.settings[k.key].push(x);
    }
    fn(x);
  });
}

const amountText = (it) => (it.perDay ? (it.perDay === 1 ? 'pro Tag' : it.perDay < 1 ? `jeden ${Math.round(1 / it.perDay)}. Tag` : `${it.perDay} pro Tag`) : it.qty || '');

// Übersicht: alle Vorlagen und Zusatz-Pakete, antippen zum Bearbeiten
export function openTemplates() {
  const hidden = hiddenIds();
  const row = (kind, t) => {
    const tag = hidden.has(t.id) ? 'ausgeblendet' : t.builtin ? (t.changed ? 'angepasst' : 'mitgeliefert') : 'eigene';
    return `<li><button type="button" class="list-main" data-sheet-action="edit" data-kind="${kind}" data-id="${esc(t.id)}">
      <span class="${hidden.has(t.id) ? 'muted' : ''}">${t.emoji || '⭐'} ${esc(t.name)}</span>
      <small>${t.items.length} Sachen${kind === 'tpl' && t.days ? ` · ${t.days} ${t.days === 1 ? 'Tag' : 'Tage'}` : ''} · ${tag}</small>
    </button>${icon('right', 'icon-sm')}</li>`;
  };
  openSheet({
    title: 'Packlisten-Vorlagen',
    body: `
      <p class="muted small" style="margin-top:0">Gelten für alle im Haushalt. Antippen, um Inhalte zu entfernen oder zu ergänzen.</p>
      <h3 class="settings-group">Vorlagen</h3>
      <ul class="list tpl-manage">${allTemplates().map((t) => row('tpl', t)).join('')}</ul>
      <button type="button" class="btn btn-block" data-sheet-action="add" data-kind="tpl" style="margin:8px 0 4px">${icon('plus', 'icon-sm')} Neue Vorlage</button>
      <h3 class="settings-group">Zusatz-Pakete</h3>
      <ul class="list tpl-manage">${allAddons().map((a) => row('addon', a)).join('')}</ul>
      <button type="button" class="btn btn-block" data-sheet-action="add" data-kind="addon" style="margin-top:8px">${icon('plus', 'icon-sm')} Neues Zusatz-Paket</button>`,
    actions: {
      edit(btn) { editSource(btn.dataset.kind, btn.dataset.id); },
      add(btn) {
        const kind = btn.dataset.kind;
        const id = uid();
        update((s) => {
          s.settings[KINDS[kind].key] = [...(s.settings[KINDS[kind].key] || []),
            { id, emoji: kind === 'tpl' ? '🧳' : '📦', name: kind === 'tpl' ? 'Neue Vorlage' : 'Neues Paket', ...(kind === 'tpl' ? { days: 3 } : {}), items: [] }];
        });
        editSource(kind, id, { fresh: true });
      },
    },
  });
}

// Eine Vorlage bzw. ein Paket bearbeiten: Kopf (Symbol, Name, Tage), Inhalte nach Kategorien mit Entfernen, Ergänzen
function editSource(kind, id, { fresh = false } = {}) {
  const k = KINDS[kind];
  const t = k.all().find((x) => x.id === id);
  if (!t) return openTemplates();
  const hidden = hiddenIds().has(id);
  const groups = CATS.map(([cat, label]) => [label, t.items.map((it, i) => ({ it, i })).filter(({ it }) => (it.cat || catOf(it.title)) === cat)])
    .filter(([, list]) => list.length);
  const form = openSheet({
    title: `${k.one} bearbeiten`,
    headerActions: `<button type="button" class="icon-btn" data-sheet-action="back" aria-label="Zurück zur Übersicht">${icon('left')}</button>`,
    body: `
      <div class="row">
        <label class="field" style="flex:0 0 64px"><span>Symbol</span><input class="input tpl-emoji-input" name="emoji" maxlength="8" value="${esc(t.emoji || '')}" placeholder="⭐" autocomplete="off"></label>
        <label class="field"><span>Name</span><input class="input" name="name" required maxlength="40" value="${esc(t.name)}" autocomplete="off"></label>
        ${kind === 'tpl' ? `<label class="field" style="flex:0 0 72px"><span>Tage</span><input class="input" type="number" name="days" min="1" max="90" inputmode="numeric" value="${t.days || ''}"></label>` : ''}
      </div>
      <div class="field"><span>Ergänzen</span>
        <div class="row">
          <input class="input" name="newItem" maxlength="120" placeholder="z. B. Badetuch" autocomplete="off" enterkeyhint="done">
          <button type="button" class="btn btn-primary" data-sheet-action="addItem" aria-label="Hinzufügen" style="flex:0 0 auto">${icon('plus', 'icon-sm')}</button>
        </div>
        <div class="row" style="margin-top:8px">
          <select class="select" name="cat" aria-label="Kategorie"><option value="">Auto-Kategorie</option>${CATS.map(([c, label]) => `<option value="${c}">${label}</option>`).join('')}</select>
          <select class="select" name="amount" aria-label="Menge"><option value="">Menge</option>
            <option value="d1">1 pro Tag</option><option value="d0.5">jeden 2. Tag</option><option value="d2">2 pro Tag</option>
            <option value="2×">2×</option><option value="3×">3×</option><option value="1 Paar">1 Paar</option>
          </select>
        </div>
      </div>
      <p class="muted small" style="margin:0 0 6px">${t.items.length} Sachen${t.builtin ? (t.changed ? ' · angepasst' : ' · mitgeliefert – wird beim ersten Ändern zu deiner Version') : ''}</p>
      ${groups.length ? groups.map(([label, list]) => `
        <h3 class="aisle-title">${esc(label)}<span class="pack-count">${list.length}</span></h3>
        <ul class="list tpl-items">${list.map(({ it, i }) => `
          <li><span class="list-main">${esc(it.title)}${amountText(it) ? ` <span class="qty-pill">${esc(amountText(it))}</span>` : ''}</span>
            <button type="button" class="icon-btn" data-sheet-action="removeItem" data-i="${i}" aria-label="${esc(it.title)} entfernen">${icon('x', 'icon-sm')}</button></li>`).join('')}
        </ul>`).join('') : '<p class="muted small">Noch leer – oben ergänzen.</p>'}
      <div class="tpl-more">
      ${t.builtin && t.changed ? '<button type="button" class="btn btn-block" data-sheet-action="reset">Auf Original zurücksetzen</button>' : ''}
      ${t.builtin
        ? `<button type="button" class="btn btn-block" data-sheet-action="hide">${hidden ? 'Wieder anzeigen' : 'Beim Anlegen ausblenden'}</button>`
        : `<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">${k.one} löschen</button>`}</div>`,
    submitLabel: 'Fertig',
    // Enter im Feld „Ergänzen“ fügt hinzu, sonst: Kopf speichern und zurück zur Übersicht
    onSubmit(data, f) {
      if (document.activeElement === f.elements.newItem) {
        addItem(f);
        return false;
      }
      if (!saveHead(f)) return false;
      openTemplates();
      return false;
    },
    actions: {
      back(btn, f) { if (saveHead(f)) openTemplates(); },
      addItem(btn, f) { addItem(f); },
      removeItem(btn, f) {
        saveHead(f);
        const i = Number(btn.dataset.i);
        changeSource(kind, id, (x) => { x.items.splice(i, 1); });
        editSource(kind, id);
      },
      reset() {
        if (!confirm(`„${t.name}“ auf das Original zurücksetzen? Deine Änderungen gehen verloren.`)) return;
        update((s) => { s.settings[k.key] = (s.settings[k.key] || []).filter((x) => x.id !== id); });
        editSource(kind, id);
      },
      hide() {
        update((s) => {
          const set = new Set(s.settings.packHidden || []);
          if (set.has(id)) set.delete(id);
          else set.add(id);
          s.settings.packHidden = [...set];
        });
        editSource(kind, id);
      },
      remove() {
        if (!confirm(`${k.one} „${t.name}“ für alle im Haushalt löschen?`)) return;
        update((s) => { s.settings[k.key] = (s.settings[k.key] || []).filter((x) => x.id !== id); });
        openTemplates();
      },
    },
  });

  // Kopf übernehmen, wenn etwas geändert wurde (eine mitgelieferte nur dann kopieren)
  function saveHead(f) {
    const name = f.elements.name.value.trim();
    if (!name) {
      f.elements.name.focus();
      toast('Bitte einen Namen eingeben');
      return false;
    }
    const emoji = f.elements.emoji.value.trim();
    const days = kind === 'tpl' ? Math.min(90, Math.max(1, Math.round(Number(f.elements.days.value) || 1))) : undefined;
    if (name !== t.name || emoji !== (t.emoji || '') || (kind === 'tpl' && days !== t.days)) {
      changeSource(kind, id, (x) => {
        x.name = name.slice(0, 40);
        x.emoji = emoji.slice(0, 8);
        if (kind === 'tpl') x.days = days;
      });
    }
    return true;
  }

  function addItem(f) {
    const title = f.elements.newItem.value.trim().slice(0, 120);
    if (!title) return f.elements.newItem.focus();
    if (t.items.some((it) => it.title.toLowerCase() === title.toLowerCase())) {
      toast(`„${title}“ ist schon drin`);
      return f.elements.newItem.select();
    }
    saveHead(f);
    const amount = f.elements.amount.value;
    const item = { title, cat: f.elements.cat.value || catOf(title),
      ...(amount.startsWith('d') ? { perDay: Number(amount.slice(1)) } : amount ? { qty: amount } : {}) };
    changeSource(kind, id, (x) => { x.items.push(item); });
    const next = editSource(kind, id);
    next?.elements.newItem.focus();
  }

  if (fresh) form.elements.name.select();
  return form;
}
