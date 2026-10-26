// Startseite „Heute“: alles Wichtige auf einen Blick, als Kacheln (Bento). Antippen führt in den Bereich.
//  - zuoberst „Jetzt wichtig“ (focus): das Dringendste mit Knopf zum Erledigen, sonst das Menü von heute
//  - Parmesan-Alarm: gelbe Karte, wenn kein Parmesan auf der Einkaufsliste steht
//  - Menü von heute (Abend, sonst Mittag) mit Knopf für fehlende Zutaten und Link zum Rezept
//  - vor Sonn- und Feiertagen (Läden zu, js/dates.js shopsClosed): Menüs dieser Tage mit fehlenden Zutaten (oder ohne
//    Zutatenliste: „an den Einkauf denken“) – also heute einkaufen. Folgen mehrere zu-Tage aufeinander (Ostern,
//    Weihnachten), alle zusammen
//  - ToDos, die heute dran sind (fällig bis heute) aus geteilten (nur für alle oder mir zugewiesen) und eigenen
//    persönlichen Listen – direkt abhakbar
//  - „Dein Tag“: Termine aus dem Apple-Kalender (js/calendars.js) und ToDos mit Uhrzeit als Zeitleiste mit Strich
//    für „jetzt“; ganztägige Termine oben. ToDos mit Uhrzeit stehen dann dort statt unter „Heute zu tun“
//  - Abfuhrkalender (nächste Termine) und Kühlschrank (was bald weg muss)

import { refresh, state, termKey, update } from '../store.js';
import { personal } from '../personal.js';
import { currentMember } from '../login.js';
import { esc, icon, safeLink, toast } from '../ui.js';
import { addDays, dateKey, fmtShort, holidayName, shopsClosed, todayKey } from '../dates.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { daysLeft, fridgeSorted, isUrgent, leftLabel, removeFridgeItem } from '../fridge.js';
import { addToShopping, openOnList, recentlyBought, shopIngredients } from './einkauf.js';
import { forMeal, mealTitle } from './wochenplan.js';
import { toggleTodo } from './todo.js';
import { lastPickup, nextPickups, openWaste, wasteKinds } from '../waste.js';
import { eventsOn, homeHidden, isFavourite, upcomingSmall } from '../calendars.js';

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

// Kompakt in einer Zeile: links „Heute Abend“ und das Menü, rechts Rezept-Link und Knopf für fehlende Zutaten.
// hero: zuoberst als dunkle Kachel; sonst (wenn „Jetzt wichtig“ etwas anderes zeigt) hell darunter
function mealTile(hero = true) {
  const t = todaysMeal();
  const cls = hero ? 'tile-hero' : 'tile-auto tile-meal-plain';
  if (!t) {
    return `<button type="button" class="tile ${cls} wide tile-meal" data-action="go" data-hash="#woche">
      <span class="tile-meal-text"><h3>Heute</h3><strong>Noch kein Menü geplant</strong></span>
      <span class="tile-btn tile-meal-btn">${icon('calendar', 'icon-sm')} Planen</span></button>`;
  }
  if (t.meal.away) {
    // Platzhalter im Wochenplan: heute kein Kochen
    return `<button type="button" class="tile ${cls} wide tile-meal" data-action="go" data-hash="#woche">
      <span class="tile-meal-text"><h3>Heute ${t.slot === 'abend' ? 'Abend' : 'Mittag'}</h3><strong>${esc(mealTitle(t.meal))}</strong><small>Kein Kochen nötig</small></span>
      ${icon('away')}</button>`;
  }
  const missing = missingFor(t.meal);
  const known = state.ideas.some((i) => i.id === t.meal.ideaId);
  // Rezept-Link der Idee (falls hinterlegt): direkt aus der Kachel öffnen, ohne die Idee zu suchen
  const url = safeLink(state.ideas.find((i) => i.id === t.meal.ideaId)?.url);
  return `<div class="tile ${cls} wide tile-meal">
    <button type="button" class="tile-link" data-action="go" data-hash="#woche" aria-label="Wochenplan öffnen"></button>
    <span class="tile-meal-text">
      <h3>Heute ${t.slot === 'abend' ? 'Abend' : 'Mittag'}</h3>
      <strong>${esc(mealTitle(t.meal))}</strong>
      ${!missing.length && known ? '<small>Alle Zutaten da ✓</small>' : ''}
    </span>
    ${url ? `<a class="tile-recipe" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Rezept öffnen" title="Rezept öffnen">${icon('link', 'icon-sm')}</a>` : ''}
    ${missing.length
      ? `<button type="button" class="tile-btn tile-meal-btn" data-action="shopMeal" aria-label="${missing.length} ${missing.length === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'} – auf die Einkaufsliste">${icon('cart', 'icon-sm')} ${missing.length} fehl${missing.length === 1 ? 't' : 'en'}</button>`
      : ''}
  </div>`;
}

// Morgen Sonntag oder Feiertag (bis zu 4 zu-Tage hintereinander): deren Menüs (Mittag und Abend). Hinweis, wenn
// Zutaten fehlen oder ein Menü keine Zutatenliste hat (dann nur „an den Einkauf denken“); sind alle Zutaten da, kein
// Hinweis. Ist heute selbst zu, auch nicht – einkaufen geht ja nicht.
const MAX_CLOSED = 4;
const dayName = (d) => holidayName(d) || new Intl.DateTimeFormat('de-CH', { weekday: 'long' }).format(d);

function closedMeals() {
  const today = new Date();
  if (shopsClosed(today)) return null;
  const days = [];
  for (let d = addDays(today, 1); shopsClosed(d) && days.length < MAX_CLOSED; d = addDays(d, 1)) days.push(d);
  if (!days.length) return null;
  const meals = days.flatMap((d) => ['mittag', 'abend'].map((slot) => ({ day: dateKey(d), name: dayName(d), meal: state.plan[dateKey(d)]?.[slot] })))
    .filter((x) => x.meal && !x.meal.away);
  const missing = [...new Set(meals.flatMap((x) => missingFor(x.meal)))];
  const unknown = meals.filter((x) => !state.ideas.find((i) => i.id === x.meal.ideaId)?.ingredients?.length);
  const names = days.length === 1 ? dayName(days[0]) : `${dayName(days[0])} bis ${dayName(days.at(-1))}`;
  return missing.length || unknown.length ? { names, several: days.length > 1, meals, missing, unknown } : null;
}

function closedTile(hero = false) {
  const t = closedMeals();
  if (!t) return '';
  const label = (x) => (t.several ? `${x.name}: ${mealTitle(x.meal)}` : mealTitle(x.meal));
  return `<div class="tile ${hero ? 'tile-hero' : 'tile-auto'} wide">
    <button type="button" class="tile-link" data-action="go" data-hash="#woche" aria-label="Wochenplan öffnen"></button>
    <h3>Morgen ${esc(t.names)} · Läden zu</h3>
    <div class="tile-big${t.several ? ' tile-big-list' : ''}">${esc(t.meals.map(label).join(' · '))}</div>
    ${t.missing.length
      ? `<button type="button" class="tile-btn" data-action="shopClosed">${icon('cart', 'icon-sm')} ${t.missing.length} ${t.missing.length === 1 ? 'Zutat' : 'Zutaten'} heute einkaufen</button>`
      : ''}
    ${t.unknown.length
      ? `<span class="tile-note">${t.missing.length ? `Für ${esc(t.unknown.map((x) => mealTitle(x.meal)).join(', '))} keine Zutatenliste – ` : ''}An den Einkauf denken</span>`
      : ''}
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

// ToDos mit Uhrzeit für heute: stehen in „Dein Tag“
// (ist „Dein Tag“ ausgeblendet – App-Einstellungen → Startseite –, stehen sie wieder unter „Heute zu tun“)
const timedToday = ({ t }) => !homeHidden('day') && t.due === todayKey() && Boolean(t.time);

// „Dein Tag“: Kalendertermine und ToDos mit Uhrzeit in zeitlicher Reihenfolge, „jetzt“ als Strich dazwischen
function dayTile() {
  if (homeHidden('day')) return '';
  const today = todayKey();
  const events = eventsOn(today);
  const allDay = events.filter((e) => e.allDay);
  const timed = [
    ...events.filter((e) => !e.allDay).map((e) => ({ at: e.start, e })),
    ...dueTodos().filter(timedToday).map((x) => ({ at: new Date(`${today}T${x.t.time}:00`), todo: x })),
  ].sort((a, b) => a.at - b.at);
  if (!allDay.length && !timed.length) return '';
  const now = new Date();
  const hm = (d) => new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' }).format(d);
  const dayStart = new Date(`${today}T00:00:00`);
  const row = ({ e, todo }) => {
    if (todo) {
      const { scope, t } = todo;
      const past = new Date(`${today}T${t.time}:00`) < now;
      return `<li class="${past ? 'is-past' : ''}">
        <span class="day-time">${esc(t.time)}</span>
        <button type="button" class="check day-check" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}" aria-label="Erledigt: ${esc(t.title)}">${icon('check', 'icon-xs')}</button>
        <button type="button" class="day-body" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}"><strong>${esc(t.title)}</strong><small>ToDo</small></button>
      </li>`;
    }
    const past = (+e.end > +e.start ? e.end : e.start) < now;
    const startsEarlier = e.start < dayStart;
    const sub = [esc(e.cal.name), startsEarlier ? `bis ${hm(e.end)}` : +e.end > +e.start ? `bis ${hm(e.end)}` : '', esc(e.location)].filter(Boolean).join(' · ');
    return `<li class="${past ? 'is-past' : ''}">
      <span class="day-time">${startsEarlier ? '…' : hm(e.start)}</span>
      <span class="day-pin" style="background:${esc(e.cal.color)}" aria-hidden="true"></span>
      <span class="day-body"><strong>${esc(e.title)}</strong><small>${sub}</small></span>
    </li>`;
  };
  // Strich „jetzt“ vor dem ersten Eintrag, der noch nicht begonnen hat
  const nowAt = timed.findIndex((x) => x.at > now);
  const rows = timed.map(row);
  if (timed.length && nowAt !== 0) rows.splice(nowAt < 0 ? rows.length : nowAt, 0, `<li class="day-now" aria-label="jetzt ${hm(now)}"><span class="day-time">${hm(now)}</span><span class="day-pin"></span><span class="day-line"></span></li>`);
  return `<div class="tile tile-auto wide tile-day">
    <h3>Dein Tag</h3>
    ${allDay.length ? `<div class="day-allday">${allDay.map((e) => `<span class="day-chip"><i style="background:${esc(e.cal.color)}"></i>${esc(e.title)}</span>`).join('')}</div>` : ''}
    ${timed.length ? `<ul class="day-list">${rows.join('')}</ul>` : ''}
  </div>`;
}

// „Sport diese Woche“: Kalender mit Darstellung „Klein“ (js/calendars.js) als schmale, waagrecht wischbare Leiste –
// heute hervorgehoben, Lieblingsmannschaften in der Akzentfarbe, ohne Spiele gar nicht. Alle Spiele der nächsten 7 Tage; die Leiste reicht bis an den
// Bildschirmrand, damit man sieht, dass es seitwärts weitergeht.
function sportStrip() {
  if (homeHidden('sport')) return '';
  const events = upcomingSmall();
  if (!events.length) return '';
  const today = todayKey();
  const tomorrow = dateKey(addDays(new Date(), 1));
  const hm = (d) => new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' }).format(d);
  const dayName = (key) => (key <= today ? 'Heute' : key === tomorrow ? 'Morgen' : new Intl.DateTimeFormat('de-CH', { weekday: 'short' }).format(new Date(`${key}T12:00:00`)));
  const chip = (e, i) => {
    const key = e.allDay ? e.start : dateKey(e.start);
    const when = e.allDay ? dayName(key) : `${dayName(key)} ${hm(e.start)}`;
    return `<button type="button" class="sport-game${key <= today ? ' is-today' : ''}${isFavourite(e.title) ? ' is-fav' : ''}" data-action="sportInfo" data-i="${i}">
      <span class="sport-sym" style="color:${esc(e.cal.color)}">${icon(e.cal.symbol || 'trophy', 'icon-sm')}</span>
      <span class="sport-when">${esc(when)}</span><span class="sport-what">${esc(e.title)}</span>
    </button>`;
  };
  return `<section class="sport-strip" aria-label="Sport diese Woche">
    <h3>Sport diese Woche · ${events.length}</h3>
    <div class="sport-row" data-keep-scroll="sport">${events.map(chip).join('')}</div>
  </section>`;
}

function todoTile() {
  const all = dueTodos();
  const list = all.filter((x) => !timedToday(x));
  const today = todayKey();
  const shown = list.slice(0, MAX_TODOS);
  return `<div class="tile tile-auto wide">
    <h3>Heute zu tun${list.length ? ` · ${list.length}` : ''}</h3>
    ${list.length ? `<ul class="tile-todos">${shown.map(({ scope, t }) => `
      <li>
        <button type="button" class="check" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}" aria-label="Erledigt: ${esc(t.title)}">${icon('check', 'icon-sm')}</button>
        <button type="button" class="tile-todo" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}">${esc(t.title)}</button>
        <small class="${t.due < today ? 'amount-minus' : ''}">${t.due < today ? esc(fmtShort(t.due).split(',')[0]) : t.time ? esc(t.time) : 'heute'}</small>
      </li>`).join('')}</ul>
      ${list.length > shown.length ? `<button type="button" class="tile-more" data-action="go" data-hash="#todo">+${list.length - shown.length} weitere</button>` : ''}`
      : `<p class="tile-note">${all.length ? 'Alles mit Uhrzeit steht oben unter „Dein Tag“.' : 'Nichts fällig 🎉'}</p>`}
  </div>`;
}

// Abfuhrkalender (js/waste.js): ein Streifen für die nächste Abfuhr – am Vortag und am Tag selbst dunkel
// hervorgehoben („Morgen: Kehricht rausstellen“) –, die übrigen Arten als kleine Chips darunter.
// focused: die nächste Abfuhr steht schon oben unter „Jetzt wichtig“ – hier nur noch die übrigen
function wasteTile(focused = false) {
  const kinds = wasteKinds();
  if (!kinds.length) return '';
  const today = todayKey();
  const next = nextPickups(today);
  const last = lastPickup();
  const renew = !next.length || (last && last <= dateKey(addDays(new Date(), 31)));
  const note = renew ? `<span class="waste-note">${next.length ? 'Kalender endet bald – ' : 'Keine Termine mehr – '}neue Datei der Gemeinde einlesen</span>` : '';
  if (!next.length) {
    return `<button type="button" class="tile tile-auto wide" data-action="waste"><h3>Abfuhr</h3>${note}</button>`;
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
  // Unter „Jetzt wichtig“ als rausgestellt markiert (settings.wasteOut): nicht mehr hervorheben
  const out = state.settings.wasteOut === first[0].next;
  const soon = n <= 1 && !out;
  const title = out ? `${n === 0 ? 'Heute' : 'Morgen'}: ${names(first)} ist draussen ✓` : n === 0 ? `Heute: ${names(first)}` : n === 1 ? `Morgen: ${names(first)} rausstellen` : `Nächste Abfuhr: ${names(first)}`;
  const sub = out ? `Abfuhr ${fmtShort(first[0].next)}` : n === 0 ? `Abfuhr heute · ${fmtShort(first[0].next)}` : n === 1 ? `${fmtShort(first[0].next)} · am besten heute Abend` : `${fmtShort(first[0].next)} · in ${n} Tagen`;
  const chip = (k) => {
    const d = days(k.next);
    const when = d === 1 ? 'morgen' : d < 7 ? fmtShort(k.next).split(',')[0] : fmtShort(k.next).split(', ')[1];
    return `<span class="waste-chip">${dot(k, 'is-small')}${esc(k.short)} <b>${esc(when)}</b></span>`;
  };
  if (focused) return rest.length || note ? `<div class="waste-b">${rest.length ? `<div class="waste-chips" aria-label="Weitere Abfuhren">${rest.map(chip).join('')}</div>` : ''}${note}</div>` : '';
  return `<div class="waste-b">
    <button type="button" class="tile waste-next${soon ? ' is-soon' : ' tile-auto'}" data-action="waste" aria-label="${esc(title)} – Abfuhrkalender öffnen">
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
  return `<button type="button" class="tile tile-auto wide" data-action="go" data-hash="#kuehlschrank">
    <h3>Kühlschrank${urgent ? ` · ${urgent} bald weg` : ''}</h3>
    <div class="tile-big">${esc(first.name)} · ${esc(leftLabel(first).replace(/ · bis .*/, ''))}</div>
    ${items.length > 1 ? `<span class="tile-note">${esc(items.slice(1, 4).map((f) => f.name).join(', '))}${items.length > 4 ? ' …' : ''}</span>` : ''}
  </button>`;
}

// ---------- „Jetzt wichtig“ ----------
// Zuoberst eine Sache: die erste Regel, die zutrifft.
//  1. Abfuhr: morgen (am Vorabend ab 18:45) oder heute (bis 9 Uhr) – bis jemand „Ist draussen“ tippt (für alle)
//  2. Für das Menü von heute fehlen Zutaten (Menü-Kachel mit Knopf)
//  3. Morgen Sonntag/Feiertag: Läden zu, Zutaten fehlen
//  4. Reste im Kühlschrank laufen heute ab (oder sind abgelaufen)
//  5. Überfällige ToDos
//  6. Sonst das Menü von heute
const WASTE_EVENING = '18:45';
const WASTE_MORNING_UNTIL = '09:00';

function wasteFocus() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = todayKey();
  const tomorrow = dateKey(addDays(now, 1));
  const next = nextPickups(today);
  const day = hm >= WASTE_EVENING && next.some((k) => k.next === tomorrow) ? tomorrow
    : hm < WASTE_MORNING_UNTIL && next.some((k) => k.next === today) ? today : null;
  if (!day || state.settings.wasteOut === day) return null;
  const kinds = next.filter((k) => k.next === day);
  return { day, kinds, names: kinds.map((k) => k.short).join(' und ') };
}

const overdueTodos = () => dueTodos().filter(({ t }) => t.due < todayKey());
const fridgeToday = () => fridgeSorted().filter((f) => daysLeft(f) <= 0);

const focusCard = ({ eyebrow, title, note, buttons }) => `<div class="tile tile-hero wide tile-focus">
  <h3>${icon('bolt', 'icon-xs')} ${esc(eyebrow)}</h3>
  <div class="tile-big">${esc(title)}</div>
  ${note ? `<span class="tile-note">${esc(note)}</span>` : ''}
  <div class="tile-acts">${buttons.join('')}</div>
</div>`;

function focus() {
  const waste = wasteFocus();
  if (waste) {
    const tomorrow = waste.day !== todayKey();
    return { kind: 'waste', html: focusCard({
      eyebrow: 'Jetzt wichtig',
      title: `${waste.names} rausstellen`,
      note: tomorrow ? `Abfuhr morgen früh · ${fmtShort(waste.day)}` : `Abfuhr heute · ${fmtShort(waste.day)}`,
      buttons: [
        `<button type="button" class="tile-btn" data-action="wasteOut" data-day="${esc(waste.day)}">${icon('check', 'icon-sm')} Ist draussen</button>`,
        '<button type="button" class="tile-btn tile-btn-soft" data-action="waste">Abfuhrplan</button>',
      ],
    }) };
  }
  const meal = todaysMeal();
  if (meal && missingFor(meal.meal).length) return { kind: 'meal', html: mealTile() };
  if (closedMeals()) return { kind: 'closed', html: closedTile(true) };
  const fridge = fridgeToday();
  if (fridge.length) {
    const f = fridge[0];
    return { kind: 'fridge', html: focusCard({
      eyebrow: 'Kühlschrank',
      title: `${f.name}: ${leftLabel(f)}`,
      note: fridge.length > 1 ? `Auch: ${fridge.slice(1, 4).map((x) => x.name).join(', ')}${fridge.length > 4 ? ' …' : ''}` : '',
      buttons: [
        `<button type="button" class="tile-btn" data-action="fridgeUsed" data-id="${esc(f.id)}">${icon('check', 'icon-sm')} Aufgebraucht</button>`,
        '<button type="button" class="tile-btn tile-btn-soft" data-action="go" data-hash="#kuehlschrank">Kühlschrank</button>',
      ],
    }) };
  }
  const overdue = overdueTodos();
  if (overdue.length) {
    const { scope, t } = overdue[0];
    const days = Math.round((new Date(`${todayKey()}T12:00:00`) - new Date(`${t.due}T12:00:00`)) / 86400000);
    return { kind: 'todo', html: focusCard({
      eyebrow: overdue.length > 1 ? `Überfällig · ${overdue.length}` : 'Überfällig',
      title: t.title,
      note: days === 1 ? 'seit gestern fällig' : `seit ${days} Tagen fällig`,
      buttons: [
        `<button type="button" class="tile-btn" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}">${icon('check', 'icon-sm')} Erledigt</button>`,
        `<button type="button" class="tile-btn tile-btn-soft" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}">Zur Liste</button>`,
      ],
    }) };
  }
  return { kind: 'meal', html: mealTile() };
}

// ---------- Parmesan-Alarm ----------
// Steht kein Parmesan offen auf der Einkaufsliste und wurde in den letzten 4 Tagen keiner gekauft (abgehakt):
// gelbe Käse-Karte mit „!“ unter „Jetzt wichtig“. „Später“ blendet sie auf diesem Gerät bis morgen aus.
const PARMESAN = /parmesan|parmigiano/i;
const PARMESAN_DAYS = 4;
const PARMESAN_LATER = 'haushalt.parmesanLater';
let wobbled = false; // das „!“ wackelt nur beim ersten Anzeigen, nicht bei jedem Neuzeichnen

function parmesanAlarm() {
  const items = state.shopping.filter((i) => PARMESAN.test(i.name));
  if (items.some((i) => !i.done)) return null;
  const last = Math.max(0, ...items.map((i) => i.doneAt || 0));
  if (last > Date.now() - PARMESAN_DAYS * 86400000) return null;
  try { if (localStorage.getItem(PARMESAN_LATER) === todayKey()) return null; } catch { /* ohne Speicher: immer zeigen */ }
  const days = last ? Math.round((new Date(`${todayKey()}T12:00:00`) - new Date(`${dateKey(new Date(last))}T12:00:00`)) / 86400000) : null;
  return { days };
}

function parmesanTile() {
  const alarm = parmesanAlarm();
  if (!alarm) return '';
  const shake = !wobbled;
  wobbled = true;
  return `<section class="tile wide tile-cheese" aria-label="Parmesan-Alarm">
    <span class="cheese-holes" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <div class="cheese-head">
      <span class="cheese-bang${shake ? ' is-shaking' : ''}" aria-hidden="true">!</span>
      <div><h3>Parmesan-Alarm</h3><span class="tile-big">Kein Parmesan auf der Liste!</span></div>
    </div>
    ${alarm.days ? `<span class="tile-note">Zuletzt gekauft vor ${alarm.days} Tagen</span>` : ''}
    <div class="tile-acts">
      <button type="button" class="tile-btn cheese-btn" data-action="parmesanAdd">${icon('plus', 'icon-sm')} Auf die Einkaufsliste</button>
      <button type="button" class="tile-btn cheese-btn-soft" data-action="parmesanLater">Später</button>
    </div>
  </section>`;
}

export default {
  id: 'heute',
  title: 'Heute',
  icon: 'home',

  render() {
    const day = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const f = focus();
    // Kachelfarben reihum (tile-auto → tile-1/2/3) in der Reihenfolge, in der die Kacheln heute erscheinen – so
    // haben zwei Kacheln nacheinander nie dieselbe Farbe, auch wenn einzelne fehlen
    let n = 0;
    return `
      <p class="heute-hello"><span>${esc(day)}</span>${esc(greeting())}</p>
      <div class="bento">
        ${f.html}
        ${parmesanTile()}
        ${f.kind === 'meal' ? '' : mealTile(false)}
        ${f.kind === 'closed' ? '' : closedTile()}
        ${sportStrip()}
        ${dayTile()}
        ${todoTile()}
        ${wasteTile(f.kind === 'waste')}
        ${fridgeTile()}
      </div>`.replace(/\btile-auto\b/g, () => `tile-${(n++ % 3) + 1}`);
  },

  actions: {
    go(el) { location.hash = el.dataset.hash; },
    waste() { openWaste(); },
    parmesanAdd() {
      addToShopping(['Parmesan']);
      toast('Parmesan steht auf der Einkaufsliste');
    },
    parmesanLater() {
      try { localStorage.setItem(PARMESAN_LATER, todayKey()); } catch { /* privates Fenster */ }
      refresh();
    },
    wasteOut(el) {
      update((s) => { s.settings.wasteOut = el.dataset.day; });
      toast('Danke! Für alle als erledigt markiert');
    },
    fridgeUsed(el) {
      const f = state.fridge.find((x) => x.id === el.dataset.id);
      if (!f) return;
      removeFridgeItem(f.id);
      toast(`${f.name} aus dem Kühlschrank entfernt`);
    },
    sportInfo(el) {
      // Ganzer Titel, Ort und Kalender – in der Leiste wird der Titel abgeschnitten
      const e = upcomingSmall()[Number(el.dataset.i)];
      if (!e) return;
      const fmt = (d) => new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
      toast([e.title, e.allDay ? '' : fmt(e.start), e.location, e.cal.name].filter(Boolean).join(' · '));
    },
    toggleTodo(el) { toggleTodo(el.dataset.scope, el.dataset.id, el); },
    shopClosed() {
      const t = closedMeals();
      if (t) shopIngredients(t.meals.flatMap((x) => forMeal(x.day, x.meal)), `für ${t.names} (${t.meals.map((x) => mealTitle(x.meal)).join(', ')})`);
    },
    shopMeal() {
      const t = todaysMeal();
      if (t) shopIngredients(forMeal(t.day, t.meal), `für ${mealTitle(t.meal)}`);
    },
  },
};
