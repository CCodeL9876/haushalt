// Startseite „Heute“: alles Wichtige auf einen Blick, als Kacheln (Bento). Antippen führt in den Bereich.
//  - Menü von heute (Abend, sonst Mittag) mit Knopf für fehlende Zutaten
//  - ToDos, die heute dran sind (fällig bis heute) aus geteilten und eigenen persönlichen Listen – direkt abhakbar
//  - Abfuhrkalender (nächste Termine) und Kühlschrank (was bald weg muss)

import { state, termKey } from '../store.js';
import { personal } from '../personal.js';
import { currentMember } from '../login.js';
import { esc, icon } from '../ui.js';
import { addDays, dateKey, fmtShort, todayKey } from '../dates.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { fridgeSorted, isUrgent, leftLabel } from '../fridge.js';
import { openOnList, recentlyBought, shopIngredients } from './einkauf.js';
import { forMeal, mealTitle } from './wochenplan.js';
import { toggleTodo } from './todo.js';
import { dayLabel, lastPickup, nextPickups, openWaste, wasteKinds } from '../waste.js';

const MAX_TODOS = 5;

function greeting() {
  const h = new Date().getHours();
  const hello = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : 'Guten Abend';
  const me = currentMember();
  return `${hello}${me ? `, ${me.name}` : ''}`;
}

// Menü von heute: am Abend der Abend, sonst zuerst das Nächste
function todaysMeal() {
  const day = todayKey();
  const entry = state.plan[day] || {};
  const slot = new Date().getHours() < 14 && entry.mittag ? 'mittag' : entry.abend ? 'abend' : entry.mittag ? 'mittag' : null;
  return slot ? { day, slot, meal: entry[slot] } : null;
}

// Zutaten, die fehlen: weder Grundzutat noch auf der Einkaufsliste, nicht kürzlich gekauft (abgehakt) und nicht
// im Kühlschrank
function missingFor(meal) {
  const idea = state.ideas.find((i) => i.id === meal.ideaId);
  const have = new Set([...openOnList(), ...recentlyBought(), ...state.fridge.map((f) => termKey(f.name))]);
  return (idea?.ingredients || []).filter((line) => {
    const { name } = splitIngredient(line);
    return !isStaple(name) && !have.has(termKey(name));
  });
}

function mealTile() {
  const t = todaysMeal();
  if (!t) {
    return `<button type="button" class="tile tile-hero wide" data-action="go" data-hash="#woche">
      <h3>Heute</h3><div class="tile-big">Noch kein Menü geplant</div>
      <span class="tile-btn">${icon('calendar', 'icon-sm')} Wochenplan öffnen</span></button>`;
  }
  const missing = missingFor(t.meal);
  return `<div class="tile tile-hero wide">
    <button type="button" class="tile-link" data-action="go" data-hash="#woche" aria-label="Wochenplan öffnen"></button>
    <h3>Heute ${t.slot === 'abend' ? 'Abend' : 'Mittag'}</h3>
    <div class="tile-big">${esc(mealTitle(t.meal))}</div>
    ${missing.length
      ? `<button type="button" class="tile-btn" data-action="shopMeal">${icon('cart', 'icon-sm')} ${missing.length} ${missing.length === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'}</button>`
      : `<span class="tile-note">${state.ideas.some((i) => i.id === t.meal.ideaId) ? 'Alle Zutaten da oder auf der Liste ✓' : ''}</span>`}
  </div>`;
}

// Fällige ToDos (bis heute), geteilte und persönliche, Überfälliges zuerst
function dueTodos() {
  const today = todayKey();
  const pick = (scope, d) => d.todos
    .filter((t) => !t.done && t.due && t.due <= today && d.lists.some((l) => l.id === t.listId))
    .map((t) => ({ scope, t }));
  return [...pick('shared', { lists: state.todolists, todos: state.todos }), ...pick('personal', personal())]
    .sort((a, b) => a.t.due.localeCompare(b.t.due) || (a.t.time || '99').localeCompare(b.t.time || '99'));
}

function todoTile() {
  const list = dueTodos();
  const today = todayKey();
  const shown = list.slice(0, MAX_TODOS);
  return `<div class="tile tile-plain wide">
    <h3>Heute zu tun${list.length ? ` · ${list.length}` : ''}</h3>
    ${list.length ? `<ul class="tile-todos">${shown.map(({ scope, t }) => `
      <li>
        <button type="button" class="check" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}" aria-label="Erledigt: ${esc(t.title)}">${icon('check', 'icon-sm')}</button>
        <button type="button" class="tile-todo" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}">${esc(t.title)}</button>
        <small class="${t.due < today ? 'amount-minus' : ''}">${t.due < today ? esc(fmtShort(t.due).split(',')[0]) : t.time ? esc(t.time) : 'heute'}</small>
      </li>`).join('')}</ul>
      ${list.length > shown.length ? `<button type="button" class="tile-more" data-action="go" data-hash="#todo">+${list.length - shown.length} weitere</button>` : ''}`
      : `<p class="tile-note">Nichts fällig 🎉</p>`}
  </div>`;
}

// Abfuhrkalender (js/waste.js): pro Art eine kleine Kachel mit Symbol und nächstem Termin (Bento).
// Steht eine Abfuhr heute oder morgen an, ist ihre Kachel dunkel hervorgehoben und oben steht, was rausmuss.
function wasteTile() {
  if (!wasteKinds().length) return '';
  const today = todayKey();
  const next = nextPickups(today);
  const soonOf = (k) => k.next === today || dayLabel(k.next, today) === 'morgen';
  const soon = next.filter(soonOf);
  const last = lastPickup();
  const renew = !next.length || (last && last <= dateKey(addDays(new Date(), 31)));
  const head = soon.length
    ? `${soon.some((k) => k.next === today) ? 'Heute' : 'Morgen'}: ${soon.map((k) => k.short).join(' und ')} rausstellen`
    : 'Entsorgung';
  // „Morgen“ / „Fr.“ (diese Woche) / „23. Okt.“ gross, darunter das volle Datum bzw. „in x Tagen“
  const when = (day) => {
    const n = Math.round((new Date(`${day}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
    if (n <= 1) return { big: dayLabel(day, today).replace(/^./, (c) => c.toUpperCase()), small: fmtShort(day) };
    return { big: n < 7 ? fmtShort(day).split(',')[0] : fmtShort(day).split(', ')[1], small: `in ${n} Tagen` };
  };
  return `<div class="tile wide tile-waste">
    <button type="button" class="tile-link" data-action="waste" aria-label="Abfuhrkalender öffnen"></button>
    <h3 class="${soon.length ? 'waste-alert' : ''}">${soon.length ? `${icon('bell', 'icon-xs')} ` : ''}${esc(head)}</h3>
    ${next.length ? `<div class="waste-grid" style="grid-template-columns:repeat(${Math.min(next.length, 3)}, minmax(0, 1fr))">${next.map((k, n) => {
      const w = when(k.next);
      return `<div class="waste-kind waste-${(n % 3) + 1}${soonOf(k) ? ' is-soon' : ''}">
        <span class="waste-icon" aria-hidden="true">${wasteEmoji(k.short)}</span>
        <span class="waste-name">${esc(k.short)}</span>
        <strong>${esc(w.big)}</strong>
        <small>${esc(w.small)}</small>
      </div>`;
    }).join('')}</div>` : ''}
    ${renew ? `<span class="tile-note">${next.length ? 'Kalender endet bald – ' : 'Keine Termine mehr – '}neue Datei der Gemeinde einlesen</span>` : ''}
  </div>`;
}

// Symbol je Abfuhrart (am Namen erkannt), sonst Recycling
function wasteEmoji(name) {
  const n = String(name).toLowerCase();
  if (/kehricht|abfall|müll|restmüll/.test(n)) return '🗑️';
  if (/papier|zeitung/.test(n)) return '📰';
  if (/karton/.test(n)) return '📦';
  if (/grün|garten|kompost|bio/.test(n)) return '🌿';
  if (/glas/.test(n)) return '🍾';
  if (/metall|alu|dose/.test(n)) return '🥫';
  if (/sperr/.test(n)) return '🛋️';
  if (/sonder|gift|batter/.test(n)) return '⚠️';
  return '♻️';
}

function fridgeTile() {
  const items = fridgeSorted();
  if (!items.length) return '';
  const first = items[0];
  const urgent = items.filter(isUrgent).length;
  return `<button type="button" class="tile tile-3 wide" data-action="go" data-hash="#kuehlschrank">
    <h3>Kühlschrank${urgent ? ` · ${urgent} bald weg` : ''}</h3>
    <div class="tile-big">${esc(first.name)} · ${esc(leftLabel(first).replace(/ · bis .*/, ''))}</div>
    ${items.length > 1 ? `<span class="tile-note">${esc(items.slice(1, 4).map((f) => f.name).join(', '))}${items.length > 4 ? ' …' : ''}</span>` : ''}
  </button>`;
}

export default {
  id: 'heute',
  title: 'Heute',
  icon: 'home',

  render() {
    const day = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    return `
      <p class="heute-hello"><span>${esc(day)}</span>${esc(greeting())}</p>
      <div class="bento">
        ${mealTile()}
        ${todoTile()}
        ${wasteTile()}
        ${fridgeTile()}
      </div>`;
  },

  actions: {
    go(el) { location.hash = el.dataset.hash; },
    waste() { openWaste(); },
    toggleTodo(el) { toggleTodo(el.dataset.scope, el.dataset.id); },
    shopMeal() {
      const t = todaysMeal();
      if (t) shopIngredients(forMeal(t.day, t.meal), `für ${mealTitle(t.meal)}`);
    },
  },
};
