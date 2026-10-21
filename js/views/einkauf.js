// Einkaufsliste: offene Artikel oben, erledigte darunter (zum Wiederverwenden oder Aufräumen).
// Jeder Artikel, der auf die Liste kommt, wird als Begriff gemerkt (state.terms, für den ganzen Haushalt) –
// beim Tippen erscheinen passende Begriffe als Vorschläge, bei leerem Feld die häufigsten.

import { refresh, state, update, uid, termKey } from '../store.js';
import { esc, icon, openSheet, toast } from '../ui.js';
import { AISLES, aisleLabel, aisleOf, aisleOrder } from '../aisles.js';
import { addDays, dateKey, fmtShort, todayKey } from '../dates.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { openTerms } from '../terms.js';
import { cards, showCards } from '../cards.js';

// Sortierung der offenen Artikel – jedes Gerät merkt sich seine: 'laden' (nach Abteilungen) oder 'neu'
const SORT_KEY = 'haushalt.shopSort';
const sortMode = () => { try { return localStorage.getItem(SORT_KEY) === 'neu' ? 'neu' : 'laden'; } catch { return 'laden'; } };

const MAX_SUGGESTIONS = 8;
const DAY = 86400000;

// Menge im Eingabefeld: „2x Milch“, „2 Milch“, „500 g Mehl“, „Milch 2x“ → { name: 'Milch', qty: '2×' }
const QTY_UNITS = 'x|×|stk\\.?|stück|kg|g|l|dl|cl|ml|pack|packungen?|pkg|bund|dosen?|flaschen?|becher|gläser|glas|beutel|rollen?';
const QTY_FRONT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${QTY_UNITS})?\\s+(.+)$`, 'i');
const QTY_BACK = new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${QTY_UNITS})?$`, 'i');
const qtyText = (n, unit) => (!unit || /^(x|×)$/i.test(unit) ? `${n}×` : `${n} ${unit}`);
export function parseQty(text) {
  const t = String(text || '').trim();
  let m = QTY_FRONT.exec(t);
  if (m) return { name: m[3].trim(), qty: qtyText(m[1], m[2]) };
  m = QTY_BACK.exec(t);
  if (m) return { name: m[1].trim(), qty: qtyText(m[2], m[3]) };
  return { name: t, qty: '' };
}

// Gekauft (abgehakt): beim Begriff die letzten Einkäufe merken – daraus wird der übliche Abstand berechnet
function rememberPurchase(s, name, at) {
  const term = s.terms.find((t) => t.id === termKey(name));
  if (!term) return;
  term.bought = [...(term.bought || []), at].slice(-6);
  delete term.snooze;
}
function forgetPurchase(s, name, at) {
  const term = s.terms.find((t) => t.id === termKey(name));
  if (term?.bought?.at(-1) === at) term.bought = term.bought.slice(0, -1);
}

// „Wieder mal?“: Artikel, die ihr regelmässig kauft und deren üblicher Abstand deutlich überschritten ist.
// Abstand = Median der Abstände zwischen den letzten Einkäufen (mindestens drei nötig). Was viel länger her ist
// (über sechsmal den Abstand), kauft ihr wohl nicht mehr – das wird nicht mehr vorgeschlagen.
export function dueTerms(now = Date.now()) {
  const open = new Set(state.shopping.filter((i) => !i.done).map((i) => termKey(i.name)));
  return state.terms
    .filter((t) => !open.has(t.id) && (t.bought?.length || 0) >= 3 && !(t.snooze > now))
    .map((t) => {
      const b = [...t.bought].sort((x, y) => x - y);
      const gaps = b.slice(1).map((x, n) => x - b[n]).sort((x, y) => x - y);
      const every = Math.max(2 * DAY, gaps[Math.floor(gaps.length / 2)]);
      const since = now - b.at(-1);
      return { t, every, since, ratio: since / every };
    })
    .filter((x) => x.ratio > 1.3 && x.ratio < 6)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);
}
const agoText = (ms) => {
  const d = Math.round(ms / DAY);
  return d >= 14 ? `vor ${Math.round(d / 7)} Wochen` : `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
};
const dueHtml = () => {
  const due = dueTerms();
  if (!due.length) return '';
  return `<div class="due-list" aria-label="Lange nicht gekauft">${due.map(({ t, since }) => `
    <div class="due-item">
      <button type="button" class="due-add" data-action="pick" data-name="${esc(t.name)}">${icon('plus', 'icon-sm')}
        <span><strong>${esc(t.name)}?</strong> <small>Zuletzt ${agoText(since)}</small></span></button>
      <button type="button" class="icon-btn" data-action="snooze" data-id="${esc(t.id)}" aria-label="${esc(t.name)}: nicht jetzt">${icon('x', 'icon-sm')}</button>
    </div>`).join('')}</div>`;
};

// Begriff merken bzw. als erneut gebraucht zählen. Die Schreibweise vom ersten Mal bleibt.
function rememberTerm(s, name) {
  const id = termKey(name);
  if (!id) return;
  const term = s.terms.find((t) => t.id === id);
  if (term) {
    term.count = (term.count || 0) + 1;
    term.lastUsed = Date.now();
  } else {
    s.terms.push({ id, name: name.slice(0, 64), count: 1, lastUsed: Date.now() });
  }
}

// Auch von Wochenplan und Menüideen genutzt. Gibt zurück, wie viele Artikel neu dazukamen.
// entries: Texte (Menge darf drinstehen: „2x Milch“) oder { name, qty, note } (qty z. B. die Menge aus dem Rezept).
// Doppelte (gleicher Name, egal ob gross/klein) werden nicht nochmals angelegt – nur eine neue Menge wird
// übernommen; erledigte werden wieder geöffnet.
export function addToShopping(entries, note = '') {
  let added = 0;
  update((s) => {
    for (const entry of entries) {
      const parsed = typeof entry === 'string' ? parseQty(entry) : { name: String(entry?.name || '').trim(), qty: entry?.qty || '' };
      const { name, qty } = parsed;
      if (!name) continue;
      const meals = (typeof entry === 'string' ? [] : entry.meals) || [];
      // Gehört der Artikel zu Menüs im Wochenplan, steht das dort (meals) statt „für …“ in der Notiz
      const itemNote = [typeof entry === 'string' ? '' : entry.note, meals.length ? '' : note].filter(Boolean).join(' · ');
      rememberTerm(s, name);
      const existing = s.shopping.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing && !existing.done) {
        let changed = false;
        if (qty && existing.qty !== qty) {
          existing.qty = existing.meals?.length && meals.length ? `${existing.qty} + ${qty}` : qty;
          changed = true;
        }
        // Für ein weiteres Menü gebraucht: merken, damit der Artikel beim frühesten Tag erscheint
        const known = new Set((existing.meals || []).map((m) => `${m.day}|${m.title}`));
        const extra = meals.filter((m) => !known.has(`${m.day}|${m.title}`));
        if (extra.length && existing.meals?.length) {
          existing.meals = [...existing.meals, ...extra];
          changed = true;
        }
        if (changed) added += 1;
        continue;
      }
      if (existing) {
        existing.done = false;
        delete existing.star;
        delete existing.doneAt;
        existing.note = itemNote || existing.note;
        if (qty) existing.qty = qty;
        else delete existing.qty;
        if (meals.length) existing.meals = meals;
        else delete existing.meals;
      } else {
        s.shopping.unshift({ id: uid(), name, ...(qty ? { qty } : {}), ...(meals.length ? { meals } : {}), note: itemNote, done: false, addedAt: Date.now() });
      }
      added += 1;
    }
  });
  return added;
}

// Zutaten eines Rezepts (oder mehrerer) auf die Einkaufsliste – vorher auswählen. Grundzutaten (Salz, Öl …) und
// was schon auf der Liste steht, sind anfangs abgewählt. lines: Rezeptzeilen wie „400 g Kartoffeln“ oder
// { line, meal: { day, title } } für ein Menü im Wochenplan (dann lässt sich der Artikel bis zu diesem Tag ausblenden).
export function shopIngredients(lines, label = '') {
  const byKey = new Map();
  const items = [];
  for (const entry of lines) {
    const it = { ...splitIngredient(typeof entry === 'string' ? entry : entry.line), meals: [] };
    if (/^\d+(?:[.,]\d+)?$/.test(it.amount)) it.amount += '×'; // „1 Zwiebel“ → 1×
    const key = termKey(it.name);
    if (!key) continue;
    const meal = typeof entry === 'string' ? null : entry.meal;
    const same = byKey.get(key);
    if (same) {
      // Gleiche Zutat für ein weiteres Menü: Mengen zusammen nennen
      if (meal && !same.meals.some((m) => m.day === meal.day && m.title === meal.title)) same.meals.push(meal);
      if (it.amount && meal) same.amount = [same.amount, it.amount].filter(Boolean).join(' + ');
      continue;
    }
    if (meal) it.meals.push(meal);
    byKey.set(key, it);
    items.push(it);
  }
  if (!items.length) return toast('Keine Zutaten hinterlegt');
  const open = new Set(state.shopping.filter((i) => !i.done).map((i) => termKey(i.name)));
  openSheet({
    title: 'Auf die Einkaufsliste',
    body: `
      ${label ? `<p class="muted small" style="margin:0 0 10px">${esc(label)}</p>` : ''}
      <div class="pick-list">${items.map((it, n) => {
        const onList = open.has(termKey(it.name));
        return `<label class="pick-row">
          <input type="checkbox" name="i${n}" ${isStaple(it.name) || onList ? '' : 'checked'}>
          <span class="list-main">${esc(it.name)}<small>${esc([it.amount, mealsText(it.meals), onList ? 'steht schon auf der Liste' : isStaple(it.name) ? 'meist zu Hause' : ''].filter(Boolean).join(' · '))}</small></span>
        </label>`;
      }).join('')}</div>`,
    submitLabel: 'Hinzufügen',
    onSubmit(data) {
      const chosen = items.filter((_, n) => data.get(`i${n}`));
      if (!chosen.length) return;
      // „400 g · gehackt“: die Menge zuerst, Zusätze in die Notiz
      const count = addToShopping(chosen.map((it) => {
        const [qty, ...extra] = it.amount ? it.amount.split(' · ') : [''];
        return { name: it.name, qty, note: extra.join(' · '), meals: it.meals };
      }), label);
      toast(`${count} ${count === 1 ? 'Artikel' : 'Artikel'} auf der Einkaufsliste`);
    },
  });
}

// Für den Vergleich: klein, ohne Akzente/Umlaut-Punkte – „apfel“ findet „Äpfel“, „cafe“ findet „Café“
const plain = (text) => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Vorschläge zum Text im Feld. Gemeint ist der Teil nach dem letzten Komma („Milch, Br“ → „Br“).
// Quelle: gemerkte Begriffe und die Zutaten der Menüideen. Ohne Eingabe: die häufigsten Begriffe.
// Was schon offen auf der Liste oder weiter vorne im Feld steht, wird nicht vorgeschlagen.
function suggestions(text) {
  const parts = text.split(',');
  const query = plain(parts.pop().trim());
  const skip = new Set([
    ...state.shopping.filter((i) => !i.done).map((i) => termKey(i.name)),
    ...parts.map(termKey),
  ]);
  const pool = new Map(state.terms.map((t) => [t.id, t]));
  for (const idea of state.ideas) {
    for (const ing of idea.ingredients || []) {
      const { name } = splitIngredient(ing); // „400 g Kartoffeln“ → „Kartoffeln“
      const id = termKey(name);
      if (id && !pool.has(id)) pool.set(id, { id, name, count: 0, lastUsed: 0 });
    }
  }
  const byUse = (a, b) => (b.count || 0) - (a.count || 0) || (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, 'de');
  const candidates = [...pool.values()].filter((t) => !skip.has(t.id));
  if (!query) return candidates.filter((t) => t.count > 0).sort(byUse).slice(0, MAX_SUGGESTIONS);
  // Rang: Anfang des Begriffs vor Anfang eines Worts im Begriff vor irgendwo enthalten
  const rank = (t) => {
    const name = plain(t.name);
    if (name === query) return -1; // genau das Getippte – kein Vorschlag nötig
    if (name.startsWith(query)) return 0;
    if (name.split(/[\s-]+/).some((w) => w.startsWith(query))) return 1;
    return name.includes(query) ? 2 : -1;
  };
  return candidates
    .map((t) => ({ t, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || byUse(a.t, b.t))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.t);
}

const suggestionsHtml = (text) => suggestions(text)
  .map((t) => `<button type="button" class="chip suggest-chip" data-action="pick" data-name="${esc(t.name)}" data-keep-focus>${icon('plus', 'icon-sm')}${esc(t.name)}</button>`)
  .join('');

// ---------- Zutaten für spätere Menüs ausblenden ----------
// Artikel aus dem Wochenplan wissen, für welche Menüs sie sind (meals). Wer heute nur für heute und morgen einkauft,
// wählt „bis morgen“ – Zutaten, die erst für spätere Tage gebraucht werden, verschwinden dann aus der Liste.
// Gilt pro Gerät und nur für den gewählten Tag (am nächsten Tag ist wieder alles sichtbar).
const UNTIL_KEY = 'haushalt.shopUntil';
function shopUntil() {
  try {
    const v = JSON.parse(localStorage.getItem(UNTIL_KEY) || 'null');
    return v && v.set === todayKey() && v.until >= todayKey() ? v.until : '';
  } catch {
    return '';
  }
}
// Menüs, die noch so im Wochenplan stehen (entfernte oder geänderte zählen nicht mehr)
const liveMeals = (i) => (i.meals || []).filter((m) => Object.values(state.plan[m.day] || {}).some((x) => x?.title === m.title));
// Frühester Tag, an dem der Artikel gebraucht wird; '' = nicht an einen Tag gebunden
const neededFrom = (i) => liveMeals(i).map((m) => m.day).sort()[0] || '';
const dayLabel = (day) => (day === todayKey() ? 'heute' : day === dateKey(addDays(new Date(), 1)) ? 'morgen' : fmtShort(day).split(',')[0]);
function mealsText(meals) {
  const list = [...(meals || [])].sort((a, b) => a.day.localeCompare(b.day));
  if (!list.length) return '';
  return `für ${list.slice(0, 2).map((m) => `${dayLabel(m.day)} (${m.title})`).join(', ')}${list.length > 2 ? ` +${list.length - 2}` : ''}`;
}

function untilHtml(open, hidden, until) {
  // Tage, ab denen Artikel gebraucht werden (nur heute und später)
  const today = todayKey();
  const days = [...new Set(open.map(neededFrom).filter((d) => d && d >= today))].sort();
  const last = days.at(-1);
  // Wählbar: heute und jeder Tag, an dem etwas gebraucht wird – ausser dem letzten (dort wäre ohnehin alles da)
  const choices = [...new Set([today, ...days])].sort().filter((d) => d < last);
  if (!choices.length) return '';
  return `<div class="until-bar">
    <span class="muted small">Einkaufen für</span>
    <div class="chips">
      <button type="button" class="chip until-chip" data-action="until" data-until="" aria-pressed="${!until}">alle Tage</button>
      ${choices.map((d) => `<button type="button" class="chip until-chip" data-action="until" data-until="${d}" aria-pressed="${d === until}">bis ${esc(dayLabel(d))}</button>`).join('')}
    </div>
    ${hidden ? `<p class="muted small until-hint">${hidden} ${hidden === 1 ? 'Zutat' : 'Zutaten'} für spätere Menüs ausgeblendet</p>` : ''}
  </div>`;
}

// ---------- Einkaufsmodus (im Laden) ----------
// Vollbild mit grosser Schrift, nach Abteilungen in der Reihenfolge des Ladens. Antippen = im Wagen (abgehakt,
// bleibt durchgestrichen sichtbar, bis man „Fertig“ tippt). Der Bildschirm bleibt an (Wake Lock, ab iOS 16.4).
// Zeigt dieselben Artikel wie die Liste (auch mit „Einkaufen für … bis“).
const MODE_KEY = 'haushalt.shopMode';
let modeSince = (() => { try { return Number(sessionStorage.getItem(MODE_KEY)) || 0; } catch { return 0; } })();
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = modeSince && document.visibilityState === 'visible' ? await navigator.wakeLock?.request('screen') : null; } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (modeSince && document.visibilityState === 'visible') keepAwake(); });
if (modeSince) keepAwake(); // nach dem Neuladen mitten im Einkauf
function setMode(on) {
  modeSince = on ? Date.now() : 0;
  try {
    if (on) sessionStorage.setItem(MODE_KEY, String(modeSince));
    else sessionStorage.removeItem(MODE_KEY);
  } catch { /* privates Fenster */ }
  if (on) keepAwake();
  else { wakeLock?.release?.().catch(() => {}); wakeLock = null; }
}

function modeHtml(open) {
  // Offen plus was seit Beginn des Einkaufs abgehakt wurde
  const got = state.shopping.filter((i) => i.done && (i.doneAt || 0) >= modeSince);
  const items = [...open, ...got];
  const groups = new Map(aisleOrder(state.settings).map((id) => [id, []]));
  for (const i of items) groups.get(aisleOf(i.name, state.terms)).push(i);
  const row = (i) => `
    <button type="button" class="mode-item${i.done ? ' is-got' : ''}" data-action="toggle" data-id="${i.id}" aria-pressed="${i.done}" aria-label="${esc(i.name)}${i.done ? ' – im Wagen, antippen zum Zurücklegen' : ''}">
      <span class="mode-box">${icon('check')}</span>
      <span class="mode-name">${esc(i.name)}${i.star && !i.done ? ` ${icon('star', 'icon-xs')}` : ''}${smallHtml(i)}</span>
      ${i.qty ? `<span class="mode-qty">${esc(i.qty)}</span>` : ''}
    </button>`;
  const total = items.length;
  return `
    <div class="mode-head">
      <strong>${icon('cart', 'icon-sm')} Einkaufsmodus</strong>
      <span class="mode-head-actions">
        <button type="button" class="mode-card" data-action="cards" aria-label="Kundenkarte zeigen">${icon('card')}</button>
        <button type="button" class="mode-done" data-action="shopModeOff">Fertig</button>
      </span>
    </div>
    <div class="mode-count">${got.length} <span>von ${total}</span></div>
    <div class="mode-bar"><i style="width:${total ? Math.round((got.length / total) * 100) : 0}%"></i></div>
    ${total && !open.length ? '<p class="mode-all">Alles im Wagen 🎉</p>' : ''}
    ${[...groups].filter(([, list]) => list.length).map(([id, list], n) => `
      <h3 class="mode-aisle">${esc(aisleLabel(id))}<span>${list.filter((i) => !i.done).length || '✓'}</span></h3>
      <div class="mode-group mode-group-${(n % 3) + 1}">${list.sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'de')).map(row).join('')}</div>`).join('')}
    ${total ? '' : '<p class="mode-all">Die Liste ist leer.</p>'}
    <button type="button" class="mode-pay${total && !open.length ? ' is-ready' : ''}" data-action="cards">${icon('card')} ${cards().length ? 'Kundenkarte zeigen' : 'Kundenkarte hinterlegen'}</button>
    <p class="mode-foot">Antippen = im Wagen · nochmals antippen = zurücklegen</p>`;
}

// Antippen des Namens: Menge, Notiz und Abteilung (nur bei offenen Artikeln)
const qtyHtml = (i) => (i.qty ? ` <span class="qty-pill">${esc(i.qty)}</span>` : '');
const smallHtml = (i) => {
  const text = [i.note, i.done ? '' : mealsText(liveMeals(i))].filter(Boolean).join(' · ');
  return text ? `<small>${esc(text)}</small>` : '';
};
const item = (i) => `
  <li class="${i.done ? 'is-done' : ''}">
    <button type="button" class="check" data-action="toggle" data-id="${i.id}" aria-label="${i.done ? 'Wieder offen' : 'Erledigt'}: ${esc(i.name)}">${icon('check', 'icon-sm')}</button>
    ${i.done
      ? `<span class="list-main">${esc(i.name)}${qtyHtml(i)}${smallHtml(i)}</span>`
      : `<button type="button" class="list-main" data-action="aisle" data-id="${i.id}" aria-label="${esc(i.name)}${i.qty ? ` (${esc(i.qty)})` : ''} – Menge, Notiz, Abteilung">${esc(i.name)}${qtyHtml(i)}${smallHtml(i)}</button>`}
    ${i.done ? '' : `<button type="button" class="icon-btn star-btn${i.star ? ' is-on' : ''}" data-action="star" data-id="${i.id}" aria-pressed="${Boolean(i.star)}" aria-label="${esc(i.name)} ${i.star ? 'nicht mehr wichtig' : 'als wichtig markieren'}">${icon('star', 'icon-sm')}</button>`}
    <button type="button" class="icon-btn" data-action="remove" data-id="${i.id}" aria-label="${esc(i.name)} löschen">${icon('x', 'icon-sm')}</button>
  </li>`;

export default {
  id: 'einkauf',
  title: 'Einkauf',
  icon: 'cart',

  render() {
    const allOpen = state.shopping.filter((i) => !i.done);
    const until = shopUntil();
    const open = until ? allOpen.filter((i) => !(neededFrom(i) > until)) : allOpen;
    const done = state.shopping.filter((i) => i.done);
    document.documentElement.toggleAttribute('data-shopmode', Boolean(modeSince));
    if (modeSince) return modeHtml(open);
    const mode = sortMode();
    // Nach Abteilungen in der Reihenfolge des Ladens, innerhalb einer Abteilung alphabetisch
    // Mit Stern markierte Artikel stehen zuoberst unter „Wichtig“, der Rest wie gewählt sortiert
    const starred = open.filter((i) => i.star);
    const rest = open.filter((i) => !i.star);
    const starHtml = starred.length ? `
      <h3 class="aisle-title star-title">${icon('star', 'icon-xs')} Wichtig</h3>
      <ul class="list">${starred.map(item).join('')}</ul>` : '';
    let openHtml = rest.length ? `${starred.length ? '<h3 class="aisle-title">Übrige</h3>' : ''}<ul class="list">${rest.map(item).join('')}</ul>` : '';
    if (mode === 'laden') {
      const groups = new Map(aisleOrder(state.settings).map((id) => [id, []]));
      for (const i of rest) groups.get(aisleOf(i.name, state.terms)).push(i);
      openHtml = [...groups]
        .filter(([, items]) => items.length)
        .map(([id, items]) => `
          <h3 class="aisle-title">${esc(aisleLabel(id))}</h3>
          <ul class="list">${items.sort((a, b) => a.name.localeCompare(b.name, 'de')).map(item).join('')}</ul>`)
        .join('');
    }
    openHtml = starHtml + openHtml;
    return `
      <form class="add-row" data-form="add">
        <input class="input" id="shop-input" name="name" placeholder="Was brauchen wir? z. B. 2x Milch" autocomplete="off" enterkeyhint="done" required data-input="suggest">
        <button type="submit" class="btn btn-primary" aria-label="Hinzufügen">${icon('plus')}</button>
      </form>
      <div class="suggest" id="shop-suggest" aria-label="Vorschläge – antippen setzt den Artikel auf die Liste">${suggestionsHtml('')}</div>
      ${dueHtml()}
      ${untilHtml(allOpen, allOpen.length - open.length, until)}
      ${allOpen.length ? `
        <div class="shop-tools">
          <div class="seg" role="group" aria-label="Sortierung">
            <button type="button" class="seg-btn" data-action="sort" data-sort="laden" aria-pressed="${mode === 'laden'}">Nach Laden</button>
            <button type="button" class="seg-btn" data-action="sort" data-sort="neu" aria-pressed="${mode === 'neu'}">Neueste</button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="terms">${icon('settings', 'icon-sm')} Begriffe</button>
        </div>
        <button type="button" class="mode-start" data-action="shopModeOn">${icon('cart', 'icon-sm')} Im Laden? Einkaufsmodus starten</button>
        ${openHtml}`
        : `<div class="empty"><strong>Alles eingekauft</strong>Neue Artikel oben eintragen.
          <p><button type="button" class="btn btn-ghost btn-sm" data-action="terms">${icon('settings', 'icon-sm')} Einkaufsbegriffe verwalten</button></p></div>`}
      ${done.length ? `
        <h2 class="section-title">Erledigt (${done.length})
          <button type="button" class="btn btn-ghost btn-sm" data-action="clearDone">Aufräumen</button>
        </h2>
        <ul class="list">${done.map(item).join('')}</ul>` : ''}`;
  },

  input: {
    // Beim Tippen nur die Vorschläge neu zeichnen, nicht die ganze Ansicht
    suggest(el, root) {
      root.querySelector('#shop-suggest').innerHTML = suggestionsHtml(el.value);
    },
  },

  actions: {
    // Vorschlag antippen: Artikel sofort auf die Liste. Was davor schon im Feld stand („Milch, Br“ → „Milch, “)
    // bleibt stehen, damit man weiterschreiben kann.
    pick(el) {
      const input = document.getElementById('shop-input');
      const parts = (input?.value || '').split(',');
      parts.pop();
      const rest = parts.map((p) => p.trim()).filter(Boolean);
      const keep = rest.length ? `${rest.join(', ')}, ` : '';
      addToShopping([{ name: el.dataset.name }]); // Begriff wie gemerkt, ohne Menge herauszulesen
      const fresh = document.getElementById('shop-input'); // nach dem Neuzeichnen ein neues Feld
      if (!fresh) return;
      fresh.value = keep;
      fresh.focus();
      document.getElementById('shop-suggest').innerHTML = suggestionsHtml(keep);
    },
    terms() { openTerms(); },
    cards() { showCards(); },
    shopModeOn() {
      setMode(true);
      refresh();
      window.scrollTo(0, 0);
    },
    shopModeOff() {
      setMode(false);
      refresh();
      window.scrollTo(0, 0);
    },
    until(el) {
      try {
        if (el.dataset.until) localStorage.setItem(UNTIL_KEY, JSON.stringify({ until: el.dataset.until, set: todayKey() }));
        else localStorage.removeItem(UNTIL_KEY);
      } catch { /* privates Fenster */ }
      refresh();
    },
    sort(el) {
      try { localStorage.setItem(SORT_KEY, el.dataset.sort); } catch { /* privates Fenster */ }
      refresh();
    },
    // Artikel antippen: Menge und Notiz ändern, Abteilung wählen (gilt danach für diesen Begriff im ganzen Haushalt)
    aisle(el) {
      const entry = state.shopping.find((x) => x.id === el.dataset.id);
      if (!entry) return;
      const current = aisleOf(entry.name, state.terms);
      openSheet({
        title: entry.name,
        body: `
          <div class="row">
            <label class="field" style="flex:0 0 38%"><span>Menge</span>
              <input class="input" name="qty" value="${esc(entry.qty)}" placeholder="2× · 500 g" maxlength="30" autocomplete="off">
            </label>
            <label class="field"><span>Notiz</span>
              <input class="input" name="note" value="${esc(entry.note)}" placeholder="z. B. Bio, die grosse" maxlength="120" autocomplete="off">
            </label>
          </div>
          <div class="field"><span>Abteilung im Laden <small class="muted" style="font-weight:500">· gilt für alle</small></span>
          <div class="chips">${AISLES.map((a) => `
            <button type="button" class="chip aisle-chip" data-sheet-action="set" data-aisle="${a.id}" aria-pressed="${a.id === current}">${esc(a.label)}</button>`).join('')}</div>
          </div>`,
        submitLabel: 'Speichern',
        onSubmit(data) {
          const qty = String(data.get('qty') || '').trim().slice(0, 30);
          const note = String(data.get('note') || '').trim().slice(0, 120);
          update((s) => {
            const i = s.shopping.find((x) => x.id === entry.id);
            if (!i) return;
            if (qty) i.qty = qty;
            else delete i.qty;
            i.note = note;
          });
        },
        actions: {
          set(btn) {
            const id = termKey(entry.name);
            update((s) => {
              let term = s.terms.find((t) => t.id === id);
              if (!term) {
                term = { id, name: entry.name.slice(0, 64), count: 0, lastUsed: 0 };
                s.terms.push(term);
              }
              term.aisle = btn.dataset.aisle;
            });
            for (const b of document.querySelectorAll('#sheet .aisle-chip')) b.setAttribute('aria-pressed', String(b === btn));
          },
        },
      });
    },
    toggle(el) {
      update((s) => {
        const i = s.shopping.find((x) => x.id === el.dataset.id);
        if (!i) return;
        i.done = !i.done;
        delete i.star; // erledigt: Markierung weg, damit sie beim nächsten Mal nicht stehen bleibt
        if (i.done) {
          i.doneAt = Date.now();
          rememberPurchase(s, i.name, i.doneAt);
        } else {
          forgetPurchase(s, i.name, i.doneAt);
          delete i.doneAt;
        }
      });
    },
    // „Wieder mal?“ wegtippen: erst wieder nach einem üblichen Abstand (mindestens einer Woche) vorschlagen
    snooze(el) {
      const due = dueTerms().find((x) => x.t.id === el.dataset.id);
      update((s) => {
        const t = s.terms.find((x) => x.id === el.dataset.id);
        if (t) t.snooze = Date.now() + Math.max(7 * DAY, due?.every || 0);
      });
    },
    star(el) {
      update((s) => {
        const i = s.shopping.find((x) => x.id === el.dataset.id);
        if (!i) return;
        if (i.star) delete i.star;
        else i.star = true;
      });
    },
    remove(el) {
      update((s) => { s.shopping = s.shopping.filter((x) => x.id !== el.dataset.id); });
    },
    clearDone() {
      update((s) => { s.shopping = s.shopping.filter((x) => !x.done); });
    },
  },

  submit: {
    add(form) {
      const name = form.elements.name.value;
      // Mehrere auf einmal: „Milch, Brot, Eier“
      if (!addToShopping(name.split(','))) toast('Steht schon auf der Liste');
      // Neu gezeichnet → Feld wieder fokussieren, damit man gleich weiterschreiben kann
      document.getElementById('shop-input')?.focus();
    },
  },
};
