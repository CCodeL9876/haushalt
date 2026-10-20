// Wochenmenüplan: Montag bis Sonntag, je Mittag und Abend. Gerichte frei eintragen oder aus den Menüideen wählen.
// Oben ein Hinweis auf Reste im Kühlschrank; beim Gericht lassen sich Reste dorthin eintragen (js/fridge.js).

import { refresh, state, update } from '../store.js';
import { closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { addDays, dateKey, fmtDayMonth, fmtShort, fmtWeekday, isoWeek, startOfWeek, todayKey } from '../dates.js';
import { shopIngredients } from './einkauf.js';
import { isStaple, splitIngredient } from '../ingredients.js';
import { addToFridge, fridgeSorted, isUrgent, leftLabel, suggestDays } from '../fridge.js';

export const SLOTS = [
  { id: 'mittag', label: 'Mittag' },
  { id: 'abend', label: 'Abend' },
];

let weekOffset = 0; // 0 = diese Woche

const ideaByTitle = (title) => state.ideas.find((i) => i.title.toLowerCase() === title.trim().toLowerCase());
const ideaOf = (meal) => (meal?.ideaId && state.ideas.find((i) => i.id === meal.ideaId)) || null;
// Name im Plan: der aktuelle Name der verknüpften Menüidee (wurde sie umbenannt, gilt der neue), sonst der eingetragene
export const mealTitle = (meal) => ideaOf(meal)?.title || meal?.title || '';

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

// Reste eines Gerichts in den Kühlschrank: das Gericht selbst oder einzelne Zutaten der Menüidee (z. B. Pesto)
function leftovers(meal) {
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
      <p class="muted small" style="margin:0 0 10px">Was ist von „${esc(title)}“ übrig geblieben?</p>
      <div class="pick-list">${names.map((name, n) => `
        <label class="pick-row">
          <input type="checkbox" name="i${n}">
          <span class="list-main">${esc(name)}<small>${n === 0 ? 'das Gericht selbst · ' : ''}hält etwa ${suggestDays(name)} ${suggestDays(name) === 1 ? 'Tag' : 'Tage'}</small></span>
        </label>`).join('')}
      </div>
      <label class="field" style="margin-top:12px"><span>Anderes (optional)</span>
        <input class="input" name="other" maxlength="80" autocomplete="off" placeholder="z. B. Parmesan, Sauce">
      </label>`,
    submitLabel: 'In den Kühlschrank',
    onSubmit(data) {
      const chosen = names.filter((_, n) => data.get(`i${n}`));
      const other = String(data.get('other') || '').split(',').map((x) => x.trim()).filter(Boolean);
      const count = addToFridge([...chosen, ...other].map((name) => ({ name, from: name === title ? '' : title })));
      if (!count) return false;
      toast(count === 1 ? `${[...chosen, ...other][0]} im Kühlschrank` : `${count} Reste im Kühlschrank`);
    },
  });
  form.querySelector('input[type="checkbox"]')?.focus();
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

function editMeal(day, slot) {
  const meal = state.plan[day]?.[slot];
  const slotLabel = SLOTS.find((s) => s.id === slot).label;
  openSheet({
    title: `${fmtShort(day)} · ${slotLabel}`,
    body: `
      <label class="field"><span>Gericht</span>
        <input class="input" name="title" list="idea-list" value="${esc(mealTitle(meal))}" placeholder="z. B. Gemüsecurry" autocomplete="off">
        <datalist id="idea-list">${state.ideas.map((i) => `<option value="${esc(i.title)}">`).join('')}</datalist>
      </label>
      ${state.ideas.length ? `
        <div class="field"><span>Aus den Menüideen</span>
          <div class="chips">${state.ideas.map((i) => `<button type="button" class="chip" data-sheet-action="pick" data-title="${esc(i.title)}">${esc(i.title)}</button>`).join('')}</div>
        </div>` : ''}
      <label class="check-field"><input type="checkbox" name="shop"> Zutaten auf die Einkaufsliste</label>`,
    submitLabel: 'Speichern',
    footer: meal ? `${ideaOf(meal)?.ingredients?.length ? `<button type="button" class="btn btn-block" data-sheet-action="shop">${icon('cart', 'icon-sm')} Zutaten einkaufen (${ideaOf(meal).ingredients.length})</button>` : ''}
      <button type="button" class="btn btn-block" data-sheet-action="leftovers">Reste in den Kühlschrank</button>
      <button type="button" class="btn btn-danger btn-block" data-sheet-action="clear">Eintrag entfernen</button>` : '',
    actions: {
      pick(btn, form) { form.elements.title.value = btn.dataset.title; },
      leftovers() { leftovers(meal); },
      // Zutaten der verknüpften Menüidee auswählen und auf die Einkaufsliste
      shop() { shopIngredients(ideaOf(meal).ingredients, `für ${mealTitle(meal)}`); },
      clear() { setMeal(day, slot, ''); closeSheet(); },
    },
    onSubmit(data) {
      const title = String(data.get('title') || '');
      const idea = setMeal(day, slot, title);
      if (data.get('shop')) {
        if (!idea?.ingredients.length) toast('Keine Zutaten hinterlegt – in den Menüideen ergänzen');
        else {
          shopIngredients(idea.ingredients, `für ${idea.title}`);
          return false; // das Fenster zeigt jetzt die Auswahl der Zutaten
        }
      }
    },
  });
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
                return `<button type="button" class="slot slot-${s.id} ${meal ? '' : 'is-empty'}" data-action="edit" data-day="${key}" data-slot="${s.id}">
                  <span class="slot-label">${s.label}</span>
                  <span class="slot-title">${meal ? esc(mealTitle(meal)) : 'Noch nichts geplant'}</span>
                  ${meal ? '' : icon('plus', 'icon-sm')}
                </button>`;
              }).join('')}
            </div>
          </section>`;
      }).join('')}
      <button type="button" class="btn btn-block week-shop" data-action="shopWeek">${icon('cart', 'icon-sm')} Zutaten der Woche einkaufen</button>`;
  },

  actions: {
    week(el) {
      const step = Number(el.dataset.step);
      weekOffset = step === 0 ? 0 : weekOffset + step;
      refresh();
    },
    edit(el) { editMeal(el.dataset.day, el.dataset.slot); },
    shopWeek() {
      const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
      const ingredients = [];
      for (let i = 0; i < 7; i += 1) {
        for (const meal of Object.values(state.plan[dateKey(addDays(monday, i))] || {})) ingredients.push(...(ideaOf(meal)?.ingredients || []));
      }
      if (!ingredients.length) return toast('Keine Gerichte mit Zutaten in dieser Woche');
      shopIngredients(ingredients, 'für den Wochenplan');
    },
  },
};
