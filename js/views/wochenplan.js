// Wochenmenüplan: Montag bis Sonntag, je Mittag und Abend. Gerichte frei eintragen oder aus den Menüideen wählen.
// Oben ein Hinweis auf Reste im Kühlschrank; beim Gericht lassen sich Reste dorthin eintragen (js/fridge.js).
// Platzhalter („Auswärts essen“, „Bestellen, juhu Pizza!“): Mahlzeit ohne Kochen (away) – zählt als geplant, ohne Zutaten.

import { refresh, state, update } from '../store.js';
import { avatar, closeSheet, esc, icon, openSheet, safeLink, toast } from '../ui.js';
import { addDays, dateKey, fmtDayMonth, fmtShort, fmtWeekday, isoWeek, startOfWeek, todayKey } from '../dates.js';
import { shopIngredients } from './einkauf.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { addToFridge, fridgeSorted, isUrgent, leftLabel, suggestDays, tomorrowKey } from '../fridge.js';
import { currentMember } from '../login.js';
import { pickMenus } from '../menuroll.js';

export const SLOTS = [
  { id: 'mittag', label: 'Mittag' },
  { id: 'abend', label: 'Abend' },
];

let weekOffset = 0; // 0 = diese Woche

const ideaByTitle = (title) => state.ideas.find((i) => i.title.toLowerCase() === title.trim().toLowerCase());
const ideaOf = (meal) => (meal?.ideaId && state.ideas.find((i) => i.id === meal.ideaId)) || null;
// Name im Plan: der aktuelle Name der verknüpften Menüidee (wurde sie umbenannt, gilt der neue), sonst der eingetragene
export const mealTitle = (meal) => ideaOf(meal)?.title || meal?.title || '';
// Rezept-Link der verknüpften Menüidee (nur http/https), sonst ''
export const recipeLink = (meal) => safeLink(ideaOf(meal)?.url);

export const PLACEHOLDERS = ['Auswärts essen', 'Bestellen, juhu Pizza!'];
// Symbol eines Platzhalters: Bestellen → Pizzastück, sonst Türe (auswärts)
export const awayIcon = (title) => (/^bestell/i.test(String(title || '').trim()) ? 'pizza' : 'away');

// Pro Person (others): Standard ist „alle essen dasselbe“ (der Haupteintrag). Wer etwas anderes isst, steht in
// others[memberId] = { title, ideaId, away? } – z. B. Anna kocht Gemüsecurry, Ben isst auswärts. Einkauf und „Heute“
// richten sich nach dem Haupteintrag; Menüs einzelner Personen kommen beim Einkaufen zusätzlich dazu.
const othersOf = (meal) => Object.entries(meal?.others || {}).filter(([id]) => state.members.some((m) => m.id === id));
const choiceOf = (title) => {
  const t = String(title || '').trim();
  if (!t) return null;
  if (PLACEHOLDERS.includes(t)) return { title: t, ideaId: null, away: true };
  const idea = ideaByTitle(t);
  return { title: idea?.title || t, ideaId: idea?.id || null };
};
// Auswahl pro Person aus dem Formular (select p_<memberId>); gleich wie der Haupteintrag = keine Abweichung
function othersFromForm(form, main) {
  const others = {};
  for (const m of state.members) {
    const c = choiceOf(form.elements[`p_${m.id}`]?.value);
    if (c && !(main && c.title === main.title && Boolean(c.away) === Boolean(main.away))) others[m.id] = c;
  }
  return Object.keys(others).length ? others : null;
}
// Was gekocht wird: der Haupteintrag – ist der ein Platzhalter (z. B. Bestellen), aber eine Person kocht ein Menü,
// dann dieses Menü (für „Heute“: Anzeige und fehlende Zutaten)
export const cookedMeal = (meal) => (meal?.away || meal?.undecided ? othersOf(meal).map(([, c]) => c).find((c) => !c.away) || meal : meal);

function setOthers(day, slot, others) {
  update((s) => {
    const meal = s.plan[day]?.[slot];
    if (!meal) return;
    if (others) meal.others = others;
    else delete meal.others;
  });
}

function setAway(day, slot, title) {
  update((s) => { s.plan[day] = { ...(s.plan[day] || {}), [slot]: { title, ideaId: null, away: true } }; });
}

export function setMeal(day, slot, title) {
  const idea = ideaByTitle(title);
  update((s) => {
    const entry = { ...(s.plan[day] || {}) };
    if (title.trim()) entry[slot] = { title: idea?.title || title.trim(), ideaId: idea?.id || null };
    else delete entry[slot];
    if (Object.keys(entry).length) s.plan[day] = entry;
    else delete s.plan[day];
  });
  return idea;
}

// Reste eines Gerichts in den Kühlschrank: das Gericht selbst oder einzelne Zutaten der Menüidee (z. B. Pesto).
// «Morgen mitnehmen»: am nächsten Morgen erinnert eine Mitteilung (und Heute) daran, das Gericht mitzunehmen.
export function leftovers(meal) {
  const title = mealTitle(meal);
  const seen = new Set([title.toLowerCase()]);
  const names = [title];
  for (const line of ideaOf(meal)?.ingredients || []) {
    const { name } = splitIngredient(line);
    if (!name || isStaple(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  const form = openSheet({
    title: 'Reste in den Kühlschrank',
    body: `
      <p class="muted small" style="margin:0 0 10px">Was ist von „${esc(title)}“ übrig geblieben? Das Gericht ist schon angewählt.</p>
      <div class="pick-list">${names.map((name, n) => `
        <label class="pick-row">
          <input type="checkbox" name="i${n}" ${n === 0 ? 'checked' : ''}>
          <span class="list-main">${esc(name)}<small>${n === 0 ? 'das Gericht selbst · ' : ''}hält etwa ${suggestDays(name)} ${suggestDays(name) === 1 ? 'Tag' : 'Tage'}</small></span>
        </label>`).join('')}
      </div>
      <label class="field" style="margin-top:12px"><span>Anderes (optional)</span>
        <input class="input" name="other" maxlength="80" autocomplete="off" placeholder="z. B. Parmesan, Sauce">
      </label>
      <label class="check-field"><input type="checkbox" name="take"> ${icon('bag', 'icon-xs')} Morgen mitnehmen – am Morgen daran erinnern</label>`,
    submitLabel: 'In den Kühlschrank',
    onSubmit(data) {
      const chosen = names.filter((_, n) => data.get(`i${n}`));
      const other = String(data.get('other') || '').split(',').map((x) => x.trim()).filter(Boolean);
      const take = data.get('take') ? { day: tomorrowKey(), for: currentMember()?.id } : null;
      const count = addToFridge([...chosen, ...other].map((name) => ({ name, from: name === title ? '' : title, take })));
      if (!count) return false;
      closeSheet(); // zuerst schliessen: die Meldung landet sonst im Fenster und verschwindet mit ihm
      const what = count === 1 ? [...chosen, ...other][0] : `${count} Reste`;
      toast(take ? `${what} im Kühlschrank – morgen früh erinnere ich dich ans Mitnehmen` : `${what} im Kühlschrank`);
    },
  });
  form.querySelector('[type="submit"]')?.focus();
}

// Hinweis oben im Wochenplan: was im Kühlschrank wartet, das Dringendste zuerst (antippen → Kühlschrank)
function fridgeHint() {
  const items = fridgeSorted();
  if (!items.length) return '';
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return `<button type="button" class="card fridge-hint${items.some(isUrgent) ? ' is-urgent' : ''}" data-action="essenPart" data-part="kuehlschrank">
    <span class="list-main"><strong>Im Kühlschrank</strong>
      <small>${shown.map((f) => `${esc(f.name)} (${esc(leftLabel(f).replace(/ · bis .*/, ''))})`).join(', ')}${more > 0 ? ` und ${more} weitere` : ''}</small>
    </span>${icon('right', 'icon-sm')}
  </button>`;
}

// Zutaten eines Menüs mit Tag – auf der Einkaufsliste lassen sie sich dann bis zu diesem Tag ausblenden
export const forMeal = (day, meal) => {
  // Haupteintrag und Menüs einzelner Personen (je Menüidee nur einmal)
  const ideas = [ideaOf(meal), ...othersOf(meal).map(([, c]) => ideaOf(c))].filter(Boolean);
  return [...new Map(ideas.map((i) => [i.id, i])).values()]
    .flatMap((idea) => (idea.ingredients || []).map((line) => ({ line, gf: Boolean(idea.glutenfree), meal: { day, title: idea.title } })));
};

// «Woche auswürfeln»: freie Abende der angezeigten Woche (ab heute) füllen. Frühere Würfe (auto) werden beim nächsten
// Würfeln neu gewürfelt – von Hand geänderte, gekochte und Einträge mit Personen-Abweichung bleiben.
const rerollable = (m) => Boolean(m?.auto) && !m.cooked && !othersOf(m).length;
const weekDays = () => Array.from({ length: 7 }, (_, i) => dateKey(addDays(addDays(startOfWeek(new Date()), weekOffset * 7), i)));
const rollDays = () => weekDays().filter((k) => k >= todayKey() && (!state.plan[k]?.abend || rerollable(state.plan[k].abend)));

function rollWeek() {
  const days = rollDays();
  if (!days.length) return toast('Alle Abende sind schon geplant');
  if (!mealIdeas().length) return toast('Zuerst Menüideen erfassen – daraus wird gewürfelt');
  // Was in den Tagen rundherum schon geplant ist (14 Tage vor/nach der Woche), zählt als «schon gehabt»
  const first = addDays(startOfWeek(new Date()), weekOffset * 7);
  const taken = new Set();
  for (let i = -14; i < 21; i += 1) {
    const k = dateKey(addDays(first, i));
    for (const [slot, meal] of Object.entries(state.plan[k] || {})) {
      if (meal && !meal.away && !meal.undecided && !(slot === 'abend' && days.includes(k))) taken.add(mealTitle(meal).toLowerCase());
    }
  }
  const fridge = fridgeSorted().map((f) => ({ name: f.name, urgent: isUrgent(f) }));
  const picks = pickMenus({ ideas: mealIdeas(), count: days.length, taken, fridge });
  const before = days.map((k) => [k, state.plan[k]?.abend]);
  update((s) => {
    days.forEach((k, n) => { s.plan[k] = { ...(s.plan[k] || {}), abend: { title: picks[n].title, ideaId: picks[n].id, auto: true } }; });
  });
  toast(`${days.length === 1 ? '1 Abend' : `${days.length} Abende`} gewürfelt`, {
    label: 'Rückgängig',
    run: () => update((s) => {
      for (const [k, old] of before) {
        const entry = { ...(s.plan[k] || {}) };
        if (old) entry.abend = old; else delete entry.abend;
        if (Object.keys(entry).length) s.plan[k] = entry; else delete s.plan[k];
      }
    }),
  });
}

// Getränke (js/views/ideen.js) gehören nicht in die Menüauswahl
const mealIdeas = () => state.ideas.filter((i) => i.kind !== 'drink');
const ideaChips = () => mealIdeas().map((i) => `<button type="button" class="chip" data-sheet-action="pick" data-title="${esc(i.title)}">${esc(i.title)}</button>`).join('');

// Auswahl pro Person: zugeklappt „Für alle gleich“; aufgeklappt (oder wenn schon jemand abweicht) je Person ein Feld
function personsHtml(meal) {
  if (state.members.length < 2) return '';
  const others = Object.fromEntries(othersOf(meal));
  const options = (sel) => `<option value="">Wie alle</option>
    <optgroup label="Platzhalter">${PLACEHOLDERS.map((t) => `<option ${sel === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>
    ${mealIdeas().length ? `<optgroup label="Menüideen">${mealIdeas().map((i) => `<option ${sel === i.title ? 'selected' : ''}>${esc(i.title)}</option>`).join('')}</optgroup>` : ''}
    ${sel && !PLACEHOLDERS.includes(sel) && !mealIdeas().some((i) => i.title === sel) ? `<option selected>${esc(sel)}</option>` : ''}`;
  return `<details class="field ideas-field persons-field" ${Object.keys(others).length ? 'open' : ''}>
      <summary>Für einzelne Personen anders${Object.keys(others).length ? ` (${Object.keys(others).length})` : ' – sonst für alle gleich'}</summary>
      <div class="person-rows">${state.members.map((m) => `
        <label class="person-row">${avatar(m)}<span class="person-name">${esc(m.name)}</span>
          <select class="select" name="p_${esc(m.id)}" aria-label="${esc(m.name)} isst">${options(others[m.id] ? mealTitle(others[m.id]) : '')}</select>
        </label>`).join('')}</div>
    </details>`;
}

function editMeal(day, slot) {
  const meal = state.plan[day]?.[slot];
  const slotLabel = SLOTS.find((s) => s.id === slot).label;
  openSheet({
    title: `${fmtShort(day)} · ${slotLabel}`,
    body: `
      <label class="field"><span>Gericht</span>
        <input class="input" name="title" list="idea-list" value="${meal?.away ? '' : esc(mealTitle(meal))}" placeholder="z. B. Gemüsecurry" autocomplete="off">
        <datalist id="idea-list">${mealIdeas().map((i) => `<option value="${esc(i.title)}">`).join('')}</datalist>
      </label>
      ${!mealIdeas().length ? '' : meal
        // Schon ein Menü eingetragen: die Ideen nur auf Wunsch aufklappen (zum Ändern)
        ? `<details class="field ideas-field"><summary>Anderes Menü aus den Menüideen (${mealIdeas().length})</summary>
            <div class="chips" style="margin-top:8px">${ideaChips()}</div>
          </details>`
        : `<div class="field"><span>Aus den Menüideen</span><div class="chips">${ideaChips()}</div></div>`}
      <label class="check-field"><input type="checkbox" name="shop"> Zutaten auf die Einkaufsliste</label>
      <div class="field"><span>Oder Platzhalter</span>
        <div class="chips">${PLACEHOLDERS.map((t) => `<button type="button" class="chip chip-away" data-sheet-action="away" data-title="${esc(t)}">${icon(awayIcon(t), 'icon-xs')} ${esc(t)}</button>`).join('')}</div>
      </div>
      ${personsHtml(meal)}`,
    submitLabel: 'Speichern',
    footer: meal?.away ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="clear">Platzhalter entfernen</button>' : meal ? `${recipeLink(meal) ? `<a class="btn btn-block" href="${esc(recipeLink(meal))}" target="_blank" rel="noopener noreferrer">${icon('link', 'icon-sm')} Rezept öffnen</a>` : ''}
      ${ideaOf(meal)?.ingredients?.length ? `<button type="button" class="btn btn-block" data-sheet-action="shop">${icon('cart', 'icon-sm')} Zutaten einkaufen (${ideaOf(meal).ingredients.length})</button>` : ''}
      <button type="button" class="btn btn-block" data-sheet-action="leftovers">Reste in den Kühlschrank</button>
      <button type="button" class="btn btn-danger btn-block" data-sheet-action="clear">Eintrag entfernen</button>` : '',
    actions: {
      pick(btn, form) { form.elements.title.value = btn.dataset.title; },
      away(btn, form) {
        setAway(day, slot, btn.dataset.title);
        setOthers(day, slot, othersFromForm(form, state.plan[day]?.[slot]));
        closeSheet();
      },
      leftovers() { leftovers(meal); },
      // Zutaten der verknüpften Menüidee auswählen und auf die Einkaufsliste
      shop() { shopIngredients(forMeal(day, meal), `für ${mealTitle(meal)}`); },
      clear() { setMeal(day, slot, ''); closeSheet(); },
    },
    onSubmit(data, form) {
      const title = String(data.get('title') || '');
      // Leeres Gericht, aber ein Platzhalter steht schon: Platzhalter behalten (nur Personen geändert)
      const keepAway = !title.trim() && meal?.away;
      const others = othersFromForm(form, keepAway ? meal : title.trim() ? choiceOf(title) : null);
      let idea = null;
      if (!title.trim() && !keepAway && others) {
        // Nur einzelne Personen geplant (z. B. Ben auswärts), für die anderen noch nichts: Eintrag „noch offen“
        update((s) => { s.plan[day] = { ...(s.plan[day] || {}), [slot]: { title: '', ideaId: null, undecided: true } }; });
      } else if (!keepAway) idea = setMeal(day, slot, title);
      setOthers(day, slot, others);
      if (data.get('shop')) {
        if (!idea?.ingredients.length) toast('Keine Zutaten hinterlegt – in den Menüideen ergänzen');
        else {
          shopIngredients(forMeal(day, state.plan[day]?.[slot]), `für ${idea.title}`);
          return false; // das Fenster zeigt jetzt die Auswahl der Zutaten
        }
      }
    },
  });
}

// Im Plan: eine Zeile pro Person, wenn jemand anders isst (wer dasselbe isst, teilt sich eine Zeile)
function slotPeople(meal) {
  const others = Object.fromEntries(othersOf(meal));
  const groups = new Map();
  for (const m of state.members) {
    const c = others[m.id] || meal;
    const key = `${c.away ? 'a' : 'm'}:${mealTitle(c)}`;
    if (!groups.has(key)) groups.set(key, { c, members: [] });
    groups.get(key).members.push(m);
  }
  return `<span class="slot-people">${[...groups.values()].map(({ c, members }) => `
    <span class="slot-person ${c.away ? 'is-away' : ''} ${c.undecided ? 'is-open' : ''}"><span class="slot-avatars">${members.map(avatar).join('')}</span>
      ${c.away ? icon(awayIcon(c.title), 'icon-xs') : ''}<span class="slot-person-title">${c.undecided ? 'noch offen' : esc(mealTitle(c))}</span></span>`).join('')}</span>`;
}

export default {
  id: 'woche',
  title: 'Wochenplan',
  short: 'Woche', // im Umschalter unter Essen (vier Teile müssen auf die iPhone-Breite passen)
  icon: 'calendar',

  render() {
    const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const today = todayKey();
    return `
      ${fridgeHint()}
      <div class="week-nav">
        <button type="button" class="icon-btn" data-action="week" data-step="-1" aria-label="Vorherige Woche">${icon('left')}</button>
        <div style="text-align:center">
          <strong>KW ${isoWeek(monday)}</strong>
          <div class="muted small">${fmtDayMonth(days[0])} – ${fmtDayMonth(days[6])}</div>
        </div>
        <button type="button" class="icon-btn" data-action="week" data-step="1" aria-label="Nächste Woche">${icon('right')}</button>
      </div>
      ${weekOffset ? `<p style="text-align:center;margin:-4px 0 10px"><button type="button" class="btn btn-ghost btn-sm" data-action="week" data-step="0">Zu dieser Woche</button></p>` : ''}
      ${days.map((d) => {
        const key = dateKey(d);
        // Standard ist nur das Abendessen; Mittag erscheint erst, wenn eines eingetragen ist („+ Mittag“)
        const hasMittag = Boolean(state.plan[key]?.mittag);
        const shown = SLOTS.filter((s) => s.id === 'abend' || hasMittag);
        return `
          <section class="card day ${key === today ? 'is-today' : ''} ${key < today ? 'is-past' : ''}">
            <div class="day-head">
              <strong>${fmtWeekday(d)}${key === today ? ' <span class="today-pill">Heute</span>' : ''}</strong>
              <span class="day-meta">
                ${hasMittag ? '' : `<button type="button" class="add-mittag" data-action="edit" data-day="${key}" data-slot="mittag" aria-label="Mittagessen für ${fmtWeekday(d)} hinzufügen">${icon('plus', 'icon-xs')} Mittag</button>`}
                <span class="muted small">${fmtDayMonth(d)}</span>
              </span>
            </div>
            <div class="slots">
              ${shown.map((s) => {
                const meal = state.plan[key]?.[s.id];
                // Rezept-Link neben dem Eintrag (ein Link darf nicht im Knopf stecken, darum daneben in einer Hülle)
                const url = recipeLink(meal);
                return `<div class="slot-wrap">
                  <button type="button" class="slot slot-${s.id} ${meal ? '' : 'is-empty'} ${meal?.away && !othersOf(meal).length ? 'is-away' : ''} ${url ? 'has-recipe' : ''}" data-action="edit" data-day="${key}" data-slot="${esc(s.id)}">
                    <span class="slot-label">${s.label}</span>
                    ${meal && othersOf(meal).length ? slotPeople(meal) : `<span class="slot-title">${meal ? esc(mealTitle(meal)) : 'Noch nichts geplant'}</span>
                    ${meal ? (meal.away ? icon(awayIcon(meal.title), 'icon-sm') : '') : icon('plus', 'icon-sm')}`}
                  </button>
                  ${url ? `<a class="slot-recipe" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Rezept öffnen: ${esc(mealTitle(meal))}" title="Rezept öffnen">${icon('link', 'icon-sm')}</a>` : ''}
                </div>`;
              }).join('')}
            </div>
          </section>`;
      }).join('')}
      ${rollDays().length ? `<button type="button" class="btn btn-block week-dice" data-action="rollWeek">${icon('dice', 'icon-sm')} ${weekDays().some((k) => rerollable(state.plan[k]?.abend)) ? 'Nochmals würfeln' : 'Freie Abende auswürfeln'}</button>` : ''}
      <button type="button" class="btn btn-block week-shop" data-action="shopWeek">${icon('cart', 'icon-sm')} Zutaten der Woche einkaufen</button>`;
  },

  actions: {
    week(el) {
      const step = Number(el.dataset.step);
      weekOffset = step === 0 ? 0 : weekOffset + step;
      refresh();
    },
    rollWeek,
    edit(el) { editMeal(el.dataset.day, el.dataset.slot); },
    shopWeek() {
      const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
      const ingredients = [];
      for (let i = 0; i < 7; i += 1) {
        const day = dateKey(addDays(monday, i));
        // Vergangene Tage nicht mehr einkaufen
        if (day < todayKey()) continue;
        for (const meal of Object.values(state.plan[day] || {})) ingredients.push(...forMeal(day, meal));
      }
      if (!ingredients.length) return toast('Keine kommenden Gerichte mit Zutaten in dieser Woche');
      shopIngredients(ingredients, 'für den Wochenplan');
    },
  },
};
