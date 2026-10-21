// „Plus für alles“: ein Knopf in der Mitte der Tab-Leiste. Man tippt einfach, was ansteht – die App erkennt, ob
// es ein Einkauf, ein ToDo, ein Menü oder eine Rechnung ist, und zeigt das vor dem Speichern an (änderbar).
// Erkannt wird hier im Gerät mit einfachen Regeln, der Text geht nirgends hin:
//   Betrag („CHF 12.50“, „12.50 Fr.“)              → Rechnung (öffnet das Formular der Abrechnung, vorausgefüllt)
//   Name einer Menüidee, „Znacht“, „Menü:“          → Menü im Wochenplan (Tag aus dem Text, sonst heute)
//   Tag oder Uhrzeit („morgen“, „Freitag 17:30“)    → ToDo mit Datum
//   bekannter Einkaufsbegriff, Menge, Komma-Liste   → Einkauf
//   sonst: ab drei Wörtern ToDo, kürzer Einkauf

import { state, termKey, update, uid } from './store.js';
import { personal, updatePersonal } from './personal.js';
import { esc, icon, openSheet, toast } from './ui.js';
import { addDays, dateKey, fmtShort, todayKey } from './dates.js';
import { addToShopping, parseQty } from './views/einkauf.js';
import { setMeal } from './views/wochenplan.js';
import { newBill } from './views/abrechnung.js';

const TYPES = [
  { id: 'shop', label: 'Einkauf', icon: 'cart' },
  { id: 'todo', label: 'ToDo', icon: 'listCheck' },
  { id: 'menu', label: 'Menü', icon: 'utensils' },
  { id: 'bill', label: 'Rechnung', icon: 'receipt' },
];
const LIST_KEY = 'haushalt.quickList';

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const SHORT_DAYS = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];
const MONEY = /(?:(?:chf|fr\.?|€|eur)\s*(\d+(?:[.,]\d{1,2})?)(?:\.-)?|(\d+(?:[.,]\d{1,2})?)\s*(?:chf|fr\.|franken|€|eur|\.-))/i;
const MENU_WORDS = /\b(zum\s+)?(znacht|zmittag|abendessen|mittagessen)\b|^men[üu]\s*:?\s*/i;

const cleanSpaces = (t) => t.replace(/\s{2,}/g, ' ').replace(/^[\s,:;-]+|[\s,:;-]+$/g, '').trim();

// Tag und Uhrzeit aus dem Text holen → { day, time, rest }
export function parseWhen(text, today = todayKey()) {
  let rest = ` ${text} `;
  let day = '';
  let time = '';
  const base = new Date(`${today}T12:00:00`);
  const take = (re, fn) => {
    const m = re.exec(rest);
    if (!m) return;
    fn(m);
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
  };
  take(/\s(?:um\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?(?=[\s,.!?])/i, (m) => { time = `${m[1].padStart(2, '0')}:${m[2]}`; });
  if (!time) take(/\s(?:um\s+)?([01]?\d|2[0-3])\s*uhr(?=[\s,.!?])/i, (m) => { time = `${m[1].padStart(2, '0')}:00`; });
  take(/\s(übermorgen|morgen|heute)(?=[\s,.!?])/i, (m) => {
    day = dateKey(addDays(base, { heute: 0, morgen: 1, übermorgen: 2 }[m[1].toLowerCase()]));
  });
  if (!day) {
    take(/\s(?:am\s+|nächsten\s+|kommenden\s+)?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)(?=[\s,.!?])/i, (m) => {
      const target = WEEKDAYS.indexOf(m[1].toLowerCase());
      day = dateKey(addDays(base, (target - base.getDay() + 7) % 7));
    });
  }
  if (!day) {
    // Abkürzungen nur eindeutig: „am Fr“ oder „Fr.“ (sonst wäre „so“ oder „do“ ein normales Wort)
    take(/\s(?:am\s+(so|mo|di|mi|do|fr|sa)\.?|(so|mo|di|mi|do|fr|sa)\.)(?=[\s,!?])/i, (m) => {
      const target = SHORT_DAYS.indexOf((m[1] || m[2]).toLowerCase());
      day = dateKey(addDays(base, (target - base.getDay() + 7) % 7));
    });
  }
  if (!day) {
    take(/\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?(?=[\s,!?])/, (m) => {
      let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getFullYear();
      let d = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && dateKey(d) < today) d = new Date(++y, Number(m[2]) - 1, Number(m[1]));
      if (d.getDate() === Number(m[1])) day = dateKey(d);
    });
  }
  if (time && !day) day = today;
  return { day, time, rest: cleanSpaces(rest.replace(/\s(am|um)\s*$/i, ' ')) };
}

// Text als bestimmte Art lesen → { title, day, time, amount, slot }
export function asType(text, type) {
  const raw = String(text || '').trim();
  if (type === 'shop') return { title: raw };
  if (type === 'bill') {
    const money = MONEY.exec(raw);
    return money
      ? { title: cleanSpaces(raw.replace(money[0], ' ').replace(/\bbezahlt\b/i, '')), amount: Number((money[1] || money[2]).replace(',', '.')) }
      : { title: raw };
  }
  const when = parseWhen(raw);
  if (type === 'todo') return { title: when.rest || raw, day: when.day, time: when.time };
  const menuWord = MENU_WORDS.exec(when.rest);
  const title = cleanSpaces(when.rest.replace(MENU_WORDS, ' '));
  const idea = state.ideas.find((i) => i.title.toLowerCase() === title.toLowerCase());
  return { title: idea?.title || title, day: when.day || todayKey(), slot: /zmittag|mittagessen/i.test(menuWord?.[0] || '') ? 'mittag' : 'abend', idea };
}

// Welche Art passt am besten?
export function guessType(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'shop';
  if (MONEY.test(raw)) return 'bill';
  const when = parseWhen(raw);
  if (MENU_WORDS.test(when.rest) || asType(raw, 'menu').idea) return 'menu';
  if (when.day || when.time) return 'todo';
  const words = raw.split(/\s+/).filter(Boolean);
  const known = state.terms.some((t) => t.id === termKey(parseQty(raw).name));
  if (raw.includes(',') || known || parseQty(raw).qty || words.length < 3) return 'shop';
  return 'todo';
}

function allLists() {
  return [
    ...state.todolists.map((l) => ({ scope: 'shared', l })),
    ...personal().lists.map((l) => ({ scope: 'personal', l })),
  ];
}
function lastList() {
  try { return localStorage.getItem(LIST_KEY) || ''; } catch { return ''; }
}

const dayText = (day) => (day === todayKey() ? 'heute' : day === dateKey(addDays(new Date(), 1)) ? 'morgen' : fmtShort(day));

function preview(text, type) {
  if (!text.trim()) return '';
  const g = asType(text, type);
  const label = TYPES.find((t) => t.id === type).label;
  const parts = {
    shop: () => [text.split(',').map((x) => x.trim()).filter(Boolean).join(', ')],
    todo: () => [g.title, g.day ? `${dayText(g.day)}${g.time ? `, ${g.time}` : ''}` : 'ohne Datum'],
    menu: () => [g.title, `${dayText(g.day)} ${g.slot === 'mittag' ? 'Mittag' : 'Abend'}`],
    bill: () => [g.title || 'Rechnung', g.amount ? g.amount.toFixed(2) : 'Betrag im nächsten Schritt'],
  }[type]();
  return `Erkannt: <span class="qa-label">${label}</span> <b>${esc(parts[0])}</b>${parts.slice(1).map((p) => ` · ${esc(p)}`).join('')}`;
}

export function quickAdd() {
  let type = 'shop';
  let chosen = false; // Art von Hand gewählt: dann nicht mehr automatisch wechseln
  const lists = allLists();
  const remembered = lastList();
  const form = openSheet({
    title: 'Neu',
    body: `
      <input class="input qa-input" name="text" placeholder="Was steht an? z. B. 2x Milch, Velo Service Freitag 17:30" autocomplete="off" enterkeyhint="done">
      <div class="qa-types" role="radiogroup" aria-label="Art">${TYPES.map((t) => `
        <button type="button" class="qa-type" data-sheet-action="type" data-type="${t.id}" aria-pressed="${t.id === type}">${icon(t.icon)}${t.label}</button>`).join('')}
      </div>
      <p class="small qa-preview" aria-live="polite"></p>
      <label class="field qa-list" hidden><span>Liste</span>
        <select class="select" name="list">${lists.map(({ scope, l }) => `<option value="${scope}:${esc(l.id)}" ${`${scope}:${l.id}` === remembered ? 'selected' : ''}>${esc(l.name)}${scope === 'personal' ? ' (nur für mich)' : ''}</option>`).join('')}</select>
      </label>`,
    submitLabel: 'Hinzufügen',
    actions: {
      type(btn, f) {
        type = btn.dataset.type;
        chosen = true;
        refreshUi(f);
      },
    },
    onSubmit(data, f) {
      const text = String(data.get('text') || '').trim();
      if (!text) { f.elements.text.focus(); return false; }
      return save(text, type, String(data.get('list') || ''));
    },
  });
  function refreshUi(f) {
    const text = f.elements.text.value;
    if (!chosen) type = guessType(text);
    for (const b of f.querySelectorAll('.qa-type')) b.setAttribute('aria-pressed', String(b.dataset.type === type));
    f.querySelector('.qa-preview').innerHTML = preview(text, type);
    f.querySelector('.qa-list').hidden = type !== 'todo' || !lists.length;
  }
  form.addEventListener('input', () => refreshUi(form));
  refreshUi(form);
  setTimeout(() => form.elements.text.focus(), 50);
}

function save(text, type, listValue) {
  const g = asType(text, type);
  if (type === 'shop') {
    const n = addToShopping(text.split(','));
    toast(n ? 'Auf der Einkaufsliste' : 'Steht schon auf der Liste');
    return true;
  }
  if (type === 'todo') {
    const [scope, listId] = listValue.split(':');
    if (!listId) { toast('Zuerst unter ToDo eine Liste anlegen'); return false; }
    const todo = { id: uid(), listId, title: g.title.slice(0, 120), note: '', done: false, due: g.day || '', time: g.day ? g.time || '' : '', addedAt: Date.now() };
    if (scope === 'personal') updatePersonal((d) => { d.todos.push(todo); });
    else update((s) => { s.todos.push(todo); });
    try { localStorage.setItem(LIST_KEY, listValue); } catch { /* privates Fenster */ }
    const name = allLists().find((x) => x.l.id === listId)?.l.name || 'ToDo';
    toast(`ToDo in „${name}“${todo.due ? ` für ${dayText(todo.due)}` : ''}`);
    return true;
  }
  if (type === 'menu') {
    if (!g.title) return false;
    setMeal(g.day, g.slot, g.title);
    toast(`${g.title}: ${dayText(g.day)} ${g.slot === 'mittag' ? 'Mittag' : 'Abend'} im Wochenplan`);
    return true;
  }
  // Rechnung: Formular der Abrechnung öffnen (wer hat bezahlt, Hälfte/ganz …) – es ersetzt dieses Fenster
  if (state.members.length < 2) { toast('Für Rechnungen braucht es mindestens zwei Personen'); return false; }
  newBill({ note: g.title, amount: g.amount });
  return false;
}
