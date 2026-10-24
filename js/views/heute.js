// Startseite „Heute“: alles Wichtige auf einen Blick, als Kacheln (Bento). Antippen führt in den Bereich.
//  - Menü von heute (Abend, sonst Mittag) mit Knopf für fehlende Zutaten und Link zum Rezept
//  - am Samstag: Menü vom Sonntag mit fehlenden Zutaten – sonntags sind die Läden zu, also heute einkaufen
//  - ToDos, die heute dran sind (fällig bis heute) aus geteilten (nur für alle oder mir zugewiesen) und eigenen
//    persönlichen Listen – direkt abhakbar
//  - Abfuhrkalender (nächste Termine) und Kühlschrank (was bald weg muss)

import { state, termKey } from '../store.js';
import { personal } from '../personal.js';
import { currentMember } from '../login.js';
import { esc, icon, safeLink } from '../ui.js';
import { addDays, dateKey, fmtShort, todayKey } from '../dates.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { fridgeSorted, isUrgent, leftLabel } from '../fridge.js';
import { openOnList, recentlyBought, shopIngredients } from './einkauf.js';
import { forMeal, mealTitle } from './wochenplan.js';
import { toggleTodo } from './todo.js';
import { lastPickup, nextPickups, openWaste, wasteKinds } from '../waste.js';

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
  // Rezept-Link der Idee (falls hinterlegt): direkt aus der Kachel öffnen, ohne die Idee zu suchen
  const url = safeLink(state.ideas.find((i) => i.id === t.meal.ideaId)?.url);
  return `<div class="tile tile-hero wide">
    <button type="button" class="tile-link" data-action="go" data-hash="#woche" aria-label="Wochenplan öffnen"></button>
    <h3>Heute ${t.slot === 'abend' ? 'Abend' : 'Mittag'}</h3>
    <div class="tile-meal">
      <div class="tile-big">${esc(mealTitle(t.meal))}</div>
      ${url ? `<a class="tile-recipe" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Rezept öffnen" title="Rezept öffnen">${icon('link', 'icon-sm')}</a>` : ''}
    </div>
    ${missing.length
      ? `<button type="button" class="tile-btn" data-action="shopMeal">${icon('cart', 'icon-sm')} ${missing.length} ${missing.length === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'}</button>`
      : `<span class="tile-note">${state.ideas.some((i) => i.id === t.meal.ideaId) ? 'Alle Zutaten da oder auf der Liste ✓' : ''}</span>`}
  </div>`;
}

// Samstag: Sonntagsmenüs (Mittag und Abend), für die noch Zutaten fehlen – sonntags sind die Läden zu
function sundayMeals() {
  if (new Date().getDay() !== 6) return null;
  const day = dateKey(addDays(new Date(), 1));
  const meals = ['mittag', 'abend'].map((slot) => state.plan[day]?.[slot]).filter(Boolean);
  const missing = [...new Set(meals.flatMap(missingFor))];
  return missing.length ? { day, meals, missing } : null;
}

function sundayTile() {
  const t = sundayMeals();
  if (!t) return '';
  return `<div class="tile tile-2 wide">
    <button type="button" class="tile-link" data-action="go" data-hash="#woche" aria-label="Wochenplan öffnen"></button>
    <h3>Morgen Sonntag · Läden zu</h3>
    <div class="tile-big">${esc(t.meals.map(mealTitle).join(' · '))}</div>
    <button type="button" class="tile-btn" data-action="shopSunday">${icon('cart', 'icon-sm')} ${t.missing.length} ${t.missing.length === 1 ? 'Zutat' : 'Zutaten'} heute einkaufen</button>
  </div>`;
}

// Fällige ToDos (bis heute), geteilte und persönliche, Überfälliges zuerst
// Geteilte ToDos nur, wenn sie mich betreffen: für alle (niemand zugewiesen) oder mir zugewiesen. Was einer anderen
// Person zugewiesen ist, steht nur in der Liste selbst. Gibt es die zugewiesene Person nicht mehr, gilt es für alle.
function concernsMe(t) {
  const me = currentMember()?.id;
  return !me || !t.assignee || t.assignee === me || !state.members.some((m) => m.id === t.assignee);
}

function dueTodos() {
  const today = todayKey();
  const pick = (scope, d, mine = () => true) => d.todos
    .filter((t) => !t.done && t.due && t.due <= today && d.lists.some((l) => l.id === t.listId) && mine(t))
    .map((t) => ({ scope, t }));
  return [...pick('shared', { lists: state.todolists, todos: state.todos }, concernsMe), ...pick('personal', personal())]
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

// Abfuhrkalender (js/waste.js): ein Streifen für die nächste Abfuhr – am Vortag und am Tag selbst dunkel
// hervorgehoben („Morgen: Kehricht rausstellen“) –, die übrigen Arten als kleine Chips darunter.
function wasteTile() {
  const kinds = wasteKinds();
  if (!kinds.length) return '';
  const today = todayKey();
  const next = nextPickups(today);
  const last = lastPickup();
  const renew = !next.length || (last && last <= dateKey(addDays(new Date(), 31)));
  const note = renew ? `<span class="waste-note">${next.length ? 'Kalender endet bald – ' : 'Keine Termine mehr – '}neue Datei der Gemeinde einlesen</span>` : '';
  if (!next.length) {
    return `<button type="button" class="tile tile-plain wide" data-action="waste"><h3>Abfuhr</h3>${note}</button>`;
  }
  // Farbe pro Art fest (Reihenfolge im Kalender), damit Kehricht immer gleich aussieht
  const color = (k) => (kinds.findIndex((x) => x.id === k.id) % 3) + 1;
  const dot = (k, cls = '') => `<span class="waste-dot waste-c${color(k)} ${cls}" aria-hidden="true">${icon(wasteIcon(k.short), 'icon-sm')}</span>`;
  const days = (day) => Math.round((new Date(`${day}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  const names = (list) => list.map((k) => k.short).join(' und ');
  // Alle Arten am selben nächsten Tag gehören in den Streifen
  const first = next.filter((k) => k.next === next[0].next);
  const rest = next.filter((k) => !first.includes(k));
  const n = days(first[0].next);
  const soon = n <= 1;
  const title = n === 0 ? `Heute: ${names(first)}` : n === 1 ? `Morgen: ${names(first)} rausstellen` : `Nächste Abfuhr: ${names(first)}`;
  const sub = n === 0 ? `Abfuhr heute · ${fmtShort(first[0].next)}` : n === 1 ? `${fmtShort(first[0].next)} · am besten heute Abend` : `${fmtShort(first[0].next)} · in ${n} Tagen`;
  const chip = (k) => {
    const d = days(k.next);
    const when = d === 1 ? 'morgen' : d < 7 ? fmtShort(k.next).split(',')[0] : fmtShort(k.next).split(', ')[1];
    return `<span class="waste-chip">${dot(k, 'is-small')}${esc(k.short)} <b>${esc(when)}</b></span>`;
  };
  return `<div class="waste-b">
    <button type="button" class="tile waste-next${soon ? ' is-soon' : ''}" data-action="waste" aria-label="${esc(title)} – Abfuhrkalender öffnen">
      ${dot(first[0])}
      <span class="waste-text"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
      ${icon('right', 'icon-sm')}
    </button>
    ${rest.length ? `<div class="waste-chips" aria-label="Weitere Abfuhren">${rest.map(chip).join('')}</div>` : ''}
    ${note}
  </div>`;
}

// Symbol je Abfuhrart (am Namen erkannt), sonst Recycling
function wasteIcon(name) {
  const n = String(name).toLowerCase();
  if (/kehricht|abfall|müll|restmüll/.test(n)) return 'trash';
  if (/papier|zeitung/.test(n)) return 'newspaper';
  if (/karton/.test(n)) return 'box';
  if (/grün|garten|kompost|bio/.test(n)) return 'leaf';
  if (/glas/.test(n)) return 'glass';
  if (/metall|alu|dose/.test(n)) return 'can';
  if (/sperr/.test(n)) return 'sofa';
  if (/sonder|gift|batter/.test(n)) return 'warning';
  return 'recycle';
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
        ${sundayTile()}
        ${todoTile()}
        ${wasteTile()}
        ${fridgeTile()}
      </div>`;
  },

  actions: {
    go(el) { location.hash = el.dataset.hash; },
    waste() { openWaste(); },
    toggleTodo(el) { toggleTodo(el.dataset.scope, el.dataset.id, el); },
    shopSunday() {
      const t = sundayMeals();
      if (t) shopIngredients(t.meals.flatMap((meal) => forMeal(t.day, meal)), `für Sonntag (${t.meals.map(mealTitle).join(', ')})`);
    },
    shopMeal() {
      const t = todaysMeal();
      if (t) shopIngredients(forMeal(t.day, t.meal), `für ${mealTitle(t.meal)}`);
    },
  },
};
