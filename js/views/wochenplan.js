// Wochenmenüplan: Montag bis Sonntag, je Mittag und Abend. Gerichte frei eintragen oder aus den Menüideen wählen.

import { refresh, state, update } from '../store.js';
import { closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { addDays, dateKey, fmtDayMonth, fmtShort, fmtWeekday, isoWeek, startOfWeek, todayKey } from '../dates.js';
import { shopIngredients } from './einkauf.js';

export const SLOTS = [
  { id: 'mittag', label: 'Mittag' },
  { id: 'abend', label: 'Abend' },
];

let weekOffset = 0; // 0 = diese Woche

const ideaByTitle = (title) => state.ideas.find((i) => i.title.toLowerCase() === title.trim().toLowerCase());
const ideaOf = (meal) => (meal?.ideaId && state.ideas.find((i) => i.id === meal.ideaId)) || null;

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

function editMeal(day, slot) {
  const meal = state.plan[day]?.[slot];
  const slotLabel = SLOTS.find((s) => s.id === slot).label;
  openSheet({
    title: `${fmtShort(day)} · ${slotLabel}`,
    body: `
      <label class="field"><span>Gericht</span>
        <input class="input" name="title" list="idea-list" value="${esc(meal?.title)}" placeholder="z. B. Gemüsecurry" autocomplete="off">
        <datalist id="idea-list">${state.ideas.map((i) => `<option value="${esc(i.title)}">`).join('')}</datalist>
      </label>
      ${state.ideas.length ? `
        <div class="field"><span>Aus den Menüideen</span>
          <div class="chips">${state.ideas.map((i) => `<button type="button" class="chip" data-sheet-action="pick" data-title="${esc(i.title)}">${esc(i.title)}</button>`).join('')}</div>
        </div>` : ''}
      <label class="check-field"><input type="checkbox" name="shop"> Zutaten auf die Einkaufsliste</label>`,
    submitLabel: 'Speichern',
    footer: meal ? `<button type="button" class="btn btn-danger btn-block" data-sheet-action="clear">Eintrag entfernen</button>` : '',
    actions: {
      pick(btn, form) { form.elements.title.value = btn.dataset.title; },
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
  icon: 'calendar',

  render() {
    const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const today = todayKey();
    return `
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
        return `
          <section class="card day ${key === today ? 'is-today' : ''}">
            <div class="day-head"><strong>${fmtWeekday(d)}${key === today ? ' <span class="today-pill">Heute</span>' : ''}</strong><span class="muted small">${fmtDayMonth(d)}</span></div>
            <div class="slots">
              ${SLOTS.map((s) => {
                const meal = state.plan[key]?.[s.id];
                return `<button type="button" class="slot slot-${s.id} ${meal ? '' : 'is-empty'}" data-action="edit" data-day="${key}" data-slot="${s.id}">
                  <span class="slot-label">${s.label}</span>
                  <span class="slot-title">${meal ? esc(meal.title) : 'Noch nichts geplant'}</span>
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
