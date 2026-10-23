// Packliste: eine Listenart in ToDo (list.kind = 'pack'), geteilt oder nur für mich (js/views/todo.js).
// Anders als bei ToDos bleibt Gepacktes sichtbar (durchgestrichen), geordnet nach Kategorien, mit Fortschritt.
//   Liste:  { …, kind: 'pack', days }                      days: Reisedauer für Mengen „pro Tag“
//   Eintrag (in todos): { id, listId, title, cat, perDay?, qty?, assignee?, buy?, note, done, doneAt?, addedAt }
//           perDay: Anzahl pro Tag (Menge = Tage × perDay, aufgerundet), qty: feste Menge („2×“, „1 Paar“)
//           buy: fehlt noch – steht auf der Einkaufsliste
//   Vorlagen: mitgelieferte (unten) und eigene in state.settings.packTemplates [{ id, name, days, items }]

import { refresh, state, uid } from './store.js';
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
    id: 'strand', name: 'Strandferien', days: 7,
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
    id: 'stadt', name: 'Städtetrip', days: 3,
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
];
export const templates = () => [...BUILTIN, ...(state.settings.packTemplates || [])];

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
    <button type="button" class="check" data-action="toggle" data-id="${t.id}" aria-label="${t.done ? 'Wieder auspacken' : 'Gepackt'}: ${esc(t.title)}">${icon('check', 'icon-sm')}</button>
    <button type="button" class="list-main" data-action="editPack" data-id="${t.id}" aria-label="${esc(t.title)} bearbeiten">
      ${esc(t.title)}${qty ? ` <span class="qty-pill">${esc(qty)}</span>` : ''}${t.note ? ` <span class="todo-note-mark" title="Mit Notiz">${icon('note', 'icon-xs')}</span>` : ''}
      ${t.buy && !t.done ? `<small class="pack-buy">${icon('cart', 'icon-xs')} fehlt noch – auf der Einkaufsliste</small>` : ''}
    </button>
    ${who ? `<span class="todo-who" title="Packt ${esc(who.name)}">${avatar(who)}</span>` : ''}
    <button type="button" class="icon-btn" data-action="remove" data-id="${t.id}" aria-label="${esc(t.title)} löschen">${icon('x', 'icon-sm')}</button>
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
          ${state.members.map((m) => `<label class="chip chip-toggle">${avatar(m)}<input type="radio" name="assignee" value="${m.id}" ${m.id === t.assignee ? 'checked' : ''}>${esc(m.name)}</label>`).join('')}
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

// Liste als eigene Vorlage speichern (für den ganzen Haushalt, ohne Häkchen, Personen und Notizen)
export function saveTemplate(update, list, todos) {
  const name = prompt('Name der Vorlage', list.name);
  if (!name?.trim()) return;
  const items = todos.filter((t) => t.listId === list.id).map((t) => ({ title: t.title, cat: t.cat, ...(t.perDay ? { perDay: t.perDay } : {}), ...(t.qty ? { qty: t.qty } : {}) }));
  update((s) => {
    const own = (s.settings.packTemplates || []).filter((x) => x.name.toLowerCase() !== name.trim().toLowerCase());
    s.settings.packTemplates = [...own, { id: uid(), name: name.trim().slice(0, 40), days: list.days || 0, items }].slice(-20);
  });
  toast(`Vorlage „${name.trim()}“ gespeichert`);
}
