// Startseite „Heute“: Datum, darunter eine grosse Karte mit dem Wichtigsten dieser Stunde, dann „Als Nächstes“
// (bis zu drei Zeilen) und „Morgen“ (Chips). Welche Sache gross erscheint, hängt von der Tageszeit ab (agenda):
//  - morgens Reste mitnehmen, dann Überfälliges/Wichtiges, ab 15 Uhr fehlende Zutaten (heute oder vor Sonn- und
//    Feiertagen, js/dates.js shopsClosed), ab 17 Uhr die Abfuhr (am Abfuhrtag selbst sofort), sonst das Menü von heute
//    (mit Knöpfen „Gekocht“, fehlende Zutaten, Rezept; gekocht: „Reste“)
//  - Parmesan-Alarm: gelbe Karte ganz oben, wenn kein Parmesan auf der Einkaufsliste steht
//  - ToDos, die heute dran sind (fällig bis heute) aus geteilten (nur für alle oder mir zugewiesen) und eigenen
//    persönlichen Listen – direkt abhakbar
//  - „Dein Tag“: Termine aus dem Apple-Kalender (js/calendars.js) und ToDos mit Uhrzeit als Zeitleiste mit Strich
//    für „jetzt“; ganztägige Termine oben. ToDos mit Uhrzeit stehen dann dort statt unter „Heute zu tun“
//  - Abfuhrkalender (nächste Termine) und Kühlschrank (was bald weg muss)

import { refresh, state, termKey, update } from '../store.js';
import { personal } from '../personal.js';
import { currentMember } from '../login.js';
import { esc, icon, safeLink, toast } from '../ui.js';
import { addDays, dateKey, fmtShort, holidayName, isoWeek, shopsClosed, todayKey } from '../dates.js';
import { glutenFree, isStaple, splitIngredient } from '../ingredients.js';
import { daysLeft, fridgeSorted, isUrgent, leftLabel, removeFridgeItem, setTake, takeToday } from '../fridge.js';
import { addToShopping, openOnList, recentlyBought, shopIngredients } from './einkauf.js';
import { awayIcon, cookedMeal, forMeal, leftovers, mealTitle } from './wochenplan.js';
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
  const meal = slot ? cookedMeal(entry[slot]) : null;
  // „noch offen“ (nur einzelne Personen geplant, niemand kocht): wie nichts geplant
  return meal && !meal.undecided ? { day, slot, meal } : null;
}

// Zutaten, die fehlen: weder Grundzutat noch auf der Einkaufsliste, nicht kürzlich gekauft (abgehakt) und nicht
// im Kühlschrank
function missingFor(meal) {
  const idea = state.ideas.find((i) => i.id === meal.ideaId);
  const have = new Set([...openOnList(), ...recentlyBought(), ...state.fridge.map((f) => termKey(f.name))]);
  return (idea?.ingredients || []).filter((line) => {
    const { name } = splitIngredient(line);
    return !isStaple(name) && !have.has(termKey(idea.glutenfree ? glutenFree(name) : name));
  });
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
function wasteTile() {
  const kinds = wasteKinds();
  if (!kinds.length || wasteNow()) return ''; // dringend: steht als grosse Karte oder unter «Als Nächstes»
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
  const dot = (k, cls = '') => `<span class="waste-dot waste-c${color(k)} ${wasteTone(k.short)} ${cls}" aria-hidden="true">${icon(wasteIcon(k.short), 'icon-sm')}</span>`;
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
  return `<div class="waste-b">
    <div class="tile waste-next waste-hi ${wasteTone(first[0].short)}${soon ? ' is-soon' : ''}">
      <button type="button" class="tile-link" data-action="waste" aria-label="${esc(title)} – Abfuhrkalender öffnen"></button>
      ${dot(first[0])}
      <span class="waste-text"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
      ${soon ? `<button type="button" class="tile-btn waste-out" data-action="wasteOut" data-day="${esc(first[0].next)}">${icon('check', 'icon-sm')} Draussen</button>` : icon('right', 'icon-sm')}
    </div>
    ${rest.length ? `<div class="waste-chips" aria-label="Weitere Abfuhren">${rest.map(chip).join('')}</div>` : ''}
    ${note}
  </div>`;
}

// Farbe je Abfuhrart: Kehricht blau, Papier/Karton braun, Grüngut grün (css/styles.css .waste-tone-…); sonst Oliv
function wasteTone(name) {
  const ic = wasteIcon(name);
  return ic === 'trash' ? 'waste-tone-blue' : ic === 'newspaper' || ic === 'box' ? 'waste-tone-brown' : ic === 'leaf' ? 'waste-tone-green' : '';
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
// Daten für die grosse Karte (agenda): eine Sache, Menü und Abfuhr kommen separat dazu:
//  1. Am Morgen (bis Mittag): Reste, die heute mitgenommen werden sollen
//  2. Reste im Kühlschrank laufen heute ab (oder sind abgelaufen)
//  3. Als wichtig markierte ToDos (im ToDo „Unter ‚Jetzt wichtig‘ zeigen“, auch ohne Datum)
//  4. Überfällige ToDos
// Sonst nichts (kind '').

// Als wichtig markierte offene ToDos; geteilte nur, wenn sie mich betreffen. Fällige zuerst, ohne Datum zuletzt
function pinnedTodos() {
  const pick = (scope, d, mine = () => true) => d.todos
    .filter((t) => t.pinned && !t.done && d.lists.some((l) => l.id === t.listId) && mine(t))
    .map((t) => ({ scope, t }));
  return [...pick('shared', { lists: state.todolists, todos: state.todos }, concernsMe), ...pick('personal', personal())]
    .sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999') || (a.t.time || '99').localeCompare(b.t.time || '99'));
}

const overdueTodos = () => dueTodos().filter(({ t }) => t.due < todayKey());
const fridgeToday = () => fridgeSorted().filter((f) => daysLeft(f) <= 0);

function focus() {
  // Am Morgen (bis Mittag): Reste, die heute mitgenommen werden sollen
  const take = new Date().getHours() < 12 ? takeToday() : [];
  if (take.length) {
    const f = take[0];
    return { kind: 'take', card: ({
      eyebrow: 'Mitnehmen',
      title: take.length > 1 ? take.map((x) => x.name).join(', ') : f.name,
      note: 'aus dem Kühlschrank – nicht vergessen',
      buttons: [
        `<button type="button" class="tile-btn" data-action="takeDone" data-ids="${esc(take.map((x) => x.id).join(','))}">${icon('bag', 'icon-sm')} Eingepackt</button>`,
        `<button type="button" class="tile-btn tile-btn-soft" data-action="takeStay" data-ids="${esc(take.map((x) => x.id).join(','))}">Bleibt hier</button>`,
      ],
    }) };
  }
  const fridge = fridgeToday();
  if (fridge.length) {
    const f = fridge[0];
    return { kind: 'fridge', card: ({
      eyebrow: 'Kühlschrank',
      title: `${f.name}: ${leftLabel(f)}`,
      note: fridge.length > 1 ? `Auch: ${fridge.slice(1, 4).map((x) => x.name).join(', ')}${fridge.length > 4 ? ' …' : ''}` : '',
      buttons: [
        daysLeft(f) < 0
          ? `<button type="button" class="tile-btn" data-action="fridgeUsed" data-id="${esc(f.id)}">${icon('trash', 'icon-sm')} Weggeworfen</button>`
          : `<button type="button" class="tile-btn" data-action="fridgeUsed" data-id="${esc(f.id)}">${icon('check', 'icon-sm')} Aufgebraucht</button>`,
        '<button type="button" class="tile-btn tile-btn-soft" data-action="go" data-hash="#kuehlschrank">Kühlschrank</button>',
      ],
    }) };
  }
  const pinned = pinnedTodos();
  if (pinned.length) {
    const { scope, t } = pinned[0];
    const rest = pinned.slice(1).map((x) => x.t.title);
    return { kind: 'todo', card: ({
      eyebrow: pinned.length > 1 ? `Jetzt wichtig · ${pinned.length}` : 'Jetzt wichtig',
      title: t.title,
      note: [t.due ? `fällig ${t.due < todayKey() ? 'seit' : ''} ${fmtShort(t.due)}${t.time ? ` · ${t.time}` : ''}`.replace('  ', ' ') : '',
        rest.length ? `Auch: ${rest.slice(0, 3).join(', ')}${rest.length > 3 ? ' …' : ''}` : ''].filter(Boolean).join(' · '),
      buttons: [
        `<button type="button" class="tile-btn" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}">${icon('check', 'icon-sm')} Erledigt</button>`,
        `<button type="button" class="tile-btn tile-btn-soft" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}">Zur Liste</button>`,
      ],
    }) };
  }
  const overdue = overdueTodos();
  if (overdue.length) {
    const { scope, t } = overdue[0];
    const days = Math.round((new Date(`${todayKey()}T12:00:00`) - new Date(`${t.due}T12:00:00`)) / 86400000);
    return { kind: 'todo', card: ({
      eyebrow: overdue.length > 1 ? `Überfällig · ${overdue.length}` : 'Überfällig',
      title: t.title,
      note: days === 1 ? 'seit gestern fällig' : `seit ${days} Tagen fällig`,
      buttons: [
        `<button type="button" class="tile-btn" data-action="toggleTodo" data-scope="${scope}" data-id="${esc(t.id)}">${icon('check', 'icon-sm')} Erledigt</button>`,
        `<button type="button" class="tile-btn tile-btn-soft" data-action="go" data-hash="#todo/${scope}/${esc(t.listId)}">Zur Liste</button>`,
      ],
    }) };
  }
  return { kind: '', card: null };
}

// Abfuhr heute oder morgen und noch nicht «draussen»: gehört in die grosse Karte bzw. unter «Als Nächstes»
function wasteNow() {
  if (!wasteKinds().length) return null;
  const today = todayKey();
  const next = nextPickups(today);
  if (!next.length) return null;
  const first = next.filter((k) => k.next === next[0].next);
  const n = Math.round((new Date(`${first[0].next}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  if (n > 1 || state.settings.wasteOut === first[0].next) return null;
  return { first, n, day: first[0].next };
}

// ---------- Aufbau «Eine grosse Karte» ----------
// Alles, was heute etwas von dir will, als Kandidat mit Rangfolge (kleiner = wichtiger). Der erste ist die grosse Karte,
// die nächsten drei stehen als Zeilen darunter. Die Rangfolge hängt von der Tageszeit ab: morgens Mitnehmen, ab 15 Uhr
// fehlende Zutaten, ab 17 Uhr die Abfuhr, sonst das Menü.
function agenda() {
  const h = new Date().getHours();
  const list = [];
  const add = (c) => list.push(c);

  const f = focus();
  if (f.card) {
    const meta = { take: ['bag', 'bis 11', '#kuehlschrank', 10], todo: ['check', '', '#todo', 20], fridge: ['leftovers', 'heute', '#kuehlschrank', 50] }[f.kind] || ['bolt', '', '#heute', 50];
    add({ rank: meta[3], kind: f.kind, ic: meta[0], when: meta[1], hash: meta[2], hero: f.card });
  }

  const wn = wasteNow();
  if (wn) {
    const names = wn.first.map((k) => k.short).join(' und ');
    const tone = wasteTone(wn.first[0].short);
    add({
      rank: wn.n === 0 ? 12 : h >= 17 ? 40 : 80, kind: 'waste', ic: wasteIcon(wn.first[0].short), tone, action: 'waste', when: wn.n === 0 ? 'heute' : 'ab 17',
      hero: {
        eyebrow: 'Abfuhr', title: wn.n === 0 ? `Heute: ${names}` : `Morgen: ${names} rausstellen`,
        note: `${fmtShort(wn.day)}${wn.n === 1 ? ' · am besten heute Abend' : ''}`,
        buttons: [`<button type="button" class="tile-btn" data-action="wasteOut" data-day="${esc(wn.day)}">${icon('check', 'icon-sm')} Draussen</button>`,
          '<button type="button" class="tile-btn tile-btn-soft" data-action="waste">Abfuhrkalender</button>'],
      },
    });
  }

  const closed = closedMeals();
  if (closed) {
    const label = (x) => (closed.several ? `${x.name}: ${mealTitle(x.meal)}` : mealTitle(x.meal));
    add({
      rank: h >= 15 && closed.missing.length ? 30 : 75, kind: 'closed', ic: 'cart', hash: '#woche', when: 'morgen',
      hero: {
        eyebrow: `Morgen ${closed.names} · Läden zu`, title: closed.meals.map(label).join(' · '),
        note: closed.missing.length ? `${closed.missing.length} ${closed.missing.length === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'}` : 'An den Einkauf denken',
        buttons: closed.missing.length ? [`<button type="button" class="tile-btn" data-action="shopClosed">${icon('cart', 'icon-sm')} ${closed.missing.length} heute einkaufen</button>`] : [],
      },
    });
  }

  const t = todaysMeal();
  if (!t) {
    add({ rank: 70, kind: 'meal', ic: 'calendar', hash: '#woche', when: 'planen', row: { eyebrow: 'Heute', title: 'Noch kein Menü geplant' } });
  } else if (t.meal.away) {
    add({ rank: 65, kind: 'meal', ic: awayIcon(t.meal.title), hash: '#woche', when: t.slot === 'abend' ? 'Abend' : 'Mittag', row: { eyebrow: t.slot === 'abend' ? 'Znacht' : 'Zmittag', title: mealTitle(t.meal), note: 'Kein Kochen nötig' } });
  } else {
    const cooked = Boolean(state.plan[t.day]?.[t.slot]?.cooked);
    const missing = cooked ? [] : missingFor(t.meal);
    const known = state.ideas.some((i) => i.id === t.meal.ideaId);
    const url = safeLink(state.ideas.find((i) => i.id === t.meal.ideaId)?.url);
    const data = `data-day="${t.day}" data-slot="${t.slot}"`;
    const note = cooked ? 'Gekocht ✓' : missing.length ? `${missing.length} ${missing.length === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'}` : known ? 'Alle Zutaten da ✓' : '';
    const buttons = cooked
      ? [`<button type="button" class="tile-btn" data-action="mealLeftovers" ${data}>${icon('leftovers', 'icon-sm')} Reste</button>`,
        `<button type="button" class="tile-btn tile-btn-soft" data-action="mealCooked" ${data} aria-pressed="true">Doch nicht</button>`]
      : [...(missing.length ? [`<button type="button" class="tile-btn" data-action="shopMeal">${icon('cart', 'icon-sm')} ${missing.length} auf die Liste</button>`] : []),
        `<button type="button" class="tile-btn${missing.length ? ' tile-btn-soft' : ''}" data-action="mealCooked" ${data} aria-pressed="false">${icon('check', 'icon-sm')} Gekocht</button>`,
        ...(url ? [`<a class="tile-btn tile-btn-soft" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link', 'icon-sm')} Rezept</a>`] : [])];
    add({
      rank: cooked ? 95 : missing.length && h >= 15 ? 35 : 60, kind: 'meal', ic: 'utensils', hash: '#woche', when: t.slot === 'abend' ? 'Abend' : 'Mittag',
      hero: { eyebrow: `Heute ${t.slot === 'abend' ? 'Abend' : 'Mittag'}`, title: mealTitle(t.meal), note, buttons },
      row: { eyebrow: t.slot === 'abend' ? 'Znacht' : 'Zmittag', title: mealTitle(t.meal), note },
    });
  }
  return list.sort((a, b) => a.rank - b.rank);
}

const heroHtml = (c) => `<div class="tile wide tile-hero hero-b">
  <span class="hb-eyebrow">${esc(c.hero.eyebrow)}</span>
  <div class="hb-title">${esc(c.hero.title)}</div>
  ${c.hero.note ? `<div class="hb-sub">${esc(c.hero.note)}</div>` : ''}
  ${c.hero.buttons.length ? `<div class="tile-acts">${c.hero.buttons.join('')}</div>` : ''}
</div>`;

const nextRowHtml = (c) => {
  const r = c.row || { eyebrow: c.hero.eyebrow, title: c.hero.title, note: c.hero.note };
  const go = c.action ? `data-action="${c.action}"` : `data-action="go" data-hash="${esc(c.hash || '#heute')}"`;
  return `<button type="button" class="na-row" ${go}>
    <span class="na-dot k-${c.kind} ${c.tone || ''}" aria-hidden="true">${icon(c.ic, 'icon-sm')}</span>
    <span class="na-text"><strong>${esc(r.title)}</strong><small>${esc([r.eyebrow, r.note].filter(Boolean).join(' · '))}</small></span>
    <span class="na-when">${esc(c.when || '')}</span>
  </button>`;
};

// «Morgen»: Abfuhr, geschlossene Läden, Menü und Termine des nächsten Tages als kleine Chips
function tomorrowChips() {
  const tmr = addDays(new Date(), 1);
  const key = dateKey(tmr);
  const chips = [];
  for (const k of nextPickups(todayKey()).filter((x) => x.next === key)) chips.push({ text: `${k.short}-Abfuhr`, tone: wasteTone(k.short) });
  if (shopsClosed(tmr) && !shopsClosed(new Date())) chips.push({ text: `${dayName(tmr)}: Läden zu` });
  const entry = state.plan[key] || {};
  const meal = entry.abend || entry.mittag;
  if (meal && !meal.away && !meal.undecided) chips.push({ text: `${entry.abend ? 'Znacht' : 'Zmittag'}: ${mealTitle(meal)}` });
  const events = eventsOn(key).length;
  if (events) chips.push({ text: `${events} ${events === 1 ? 'Termin' : 'Termine'}` });
  return chips;
}

// ---------- Parmesan-Alarm ----------
// Steht kein Parmesan offen auf der Einkaufsliste:
// gelbe Käse-Karte mit „!“ ganz oben, noch vor „Jetzt wichtig“. „Später“ blendet sie auf diesem Gerät bis morgen aus.
const PARMESAN = /parmesan|parmigiano/i;
const PARMESAN_LATER = 'haushalt.parmesanLater';
let wobbled = false; // das „!“ wackelt nur beim ersten Anzeigen, nicht bei jedem Neuzeichnen

function parmesanAlarm() {
  const items = state.shopping.filter((i) => PARMESAN.test(i.name));
  if (items.some((i) => !i.done)) return null;
  const last = Math.max(0, ...items.map((i) => i.doneAt || 0));
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

  // Oben das Datum (gross, mit Kalenderwoche) und der Gruss; dann die grosse Karte, „Als Nächstes“, „Morgen“ und
  // darunter der Rest (Abfuhr-Übersicht, Sport, Dein Tag, ToDos, Kühlschrank)
  render() {
    const now = new Date();
    const fmt = (o) => new Intl.DateTimeFormat('de-CH', o).format(now);
    const [hero, ...rest] = agenda();
    const next = rest.slice(0, 3);
    const items = hero ? [hero, ...next] : [];
    const chips = tomorrowChips();
    // Kachelfarben reihum (tile-auto → tile-1/2/3) in der Reihenfolge, in der die Kacheln heute erscheinen – so
    // haben zwei Kacheln nacheinander nie dieselbe Farbe, auch wenn einzelne fehlen
    let n = 0;
    return `
      <div class="heute-date">
        <span class="hd-num">${now.getDate()}</span>
        <span class="hd-text"><b>${esc(holidayName(now) || fmt({ weekday: 'long' }))}</b>${esc(fmt({ month: 'long', year: 'numeric' }))}</span>
        <span class="hd-kw">KW ${isoWeek(now)}</span>
      </div>
      <p class="heute-greet">${esc(greeting())}</p>
      <div class="bento">
        ${parmesanTile()}
        ${hero ? heroHtml(hero) : ''}
        ${next.length ? `<section class="na-list" aria-label="Als Nächstes"><h3 class="na-h">Als Nächstes</h3>${next.map(nextRowHtml).join('')}</section>` : ''}
        ${chips.length ? `<section class="na-list" aria-label="Morgen"><h3 class="na-h">Morgen</h3><div class="na-chips">${chips.map((c) => `<span class="na-chip ${c.tone || ''}">${esc(c.text)}</span>`).join('')}</div></section>` : ''}
        ${wasteTile()}
        ${sportStrip()}
        ${dayTile()}
        ${todoTile()}
        ${items.some((c) => c.kind === 'fridge') ? '' : fridgeTile()}
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
    // Menü von heute als gekocht abhaken (oder zurück) – am Eintrag im Wochenplan, damit es alle sehen
    mealCooked(el) {
      const { day, slot } = el.dataset;
      let done = false;
      update((s) => {
        const meal = s.plan[day]?.[slot];
        if (!meal) return;
        done = !meal.cooked;
        if (done) meal.cooked = true;
        else delete meal.cooked;
      });
      if (done) {
        toast('Gekocht – fehlende Zutaten ausgeblendet', {
          label: 'Rückgängig',
          run: () => update((s) => { if (s.plan[day]?.[slot]) delete s.plan[day][slot].cooked; }),
        });
      }
    },
    // Reste nach dem Kochen in den Kühlschrank (mit „Morgen mitnehmen“)
    mealLeftovers(el) {
      const meal = state.plan[el.dataset.day]?.[el.dataset.slot];
      if (meal) leftovers(cookedMeal(meal));
    },
    // Mitnehmen: eingepackt = aus dem Kühlschrank; bleibt hier = nur die Erinnerung weg
    takeDone(el) {
      const ids = el.dataset.ids.split(',');
      update((s) => { s.fridge = s.fridge.filter((x) => !ids.includes(x.id)); });
      toast('Eingepackt – en Guete!');
    },
    takeStay(el) {
      for (const id of el.dataset.ids.split(',')) setTake(id, false);
    },
    wasteOut(el) {
      update((s) => { s.settings.wasteOut = el.dataset.day; });
      toast('Danke! Für alle als erledigt markiert');
    },
    fridgeUsed(el) {
      const f = state.fridge.find((x) => x.id === el.dataset.id);
      if (!f) return;
      removeFridgeItem(f.id);
      toast(`${f.name} ${daysLeft(f) < 0 ? 'weggeworfen' : 'aus dem Kühlschrank entfernt'}`);
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
