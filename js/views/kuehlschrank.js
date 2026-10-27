// Kühlschrank (Teil von Essen): Reste und Angebrochenes mit „aufbrauchen bis“, das Dringendste zuoberst.
// Erfassen hier oder im Wochenplan beim Gericht („Reste in den Kühlschrank“). Logik und Richtwerte: js/fridge.js.

import { state } from '../store.js';
import { closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { addDays, dateKey, fmtShort, parseKey } from '../dates.js';
import { DAY_CHOICES, addToFridge, addedDay, changeFridgeItem, daysLeft, fridgeSorted, isUrgent, leftLabel, removeFridgeItem } from '../fridge.js';

const MAX_QUICK = 8;
const MAX_IDEAS = 6;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Schnellwahl: Esswaren, die schon einmal im Kühlschrank waren und gerade nicht drin sind
function quickPicks() {
  const inside = new Set(state.fridge.map((f) => f.name.toLowerCase()));
  return Object.keys(state.settings.fridgeDays || {})
    .filter((k) => !inside.has(k))
    .slice(-MAX_QUICK)
    .reverse()
    .map((k) => ({ name: capital(k), days: state.settings.fridgeDays[k] }));
}

// Menüideen (Essen) als Vorschlag: passend zum Getippten, sonst die ersten; was schon drin ist, fällt weg
function ideaPicks(text = '') {
  const q = text.trim().toLowerCase();
  const inside = new Set(state.fridge.map((f) => f.name.toLowerCase()));
  return state.ideas
    .filter((i) => i.kind !== 'drink' && i.title && !inside.has(i.title.toLowerCase()) && (!q || i.title.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
    .slice(0, MAX_IDEAS);
}

function suggestHtml(text = '') {
  const q = text.trim().toLowerCase();
  const ideas = ideaPicks(text).map((i) => `<button type="button" class="chip suggest-chip suggest-idea" data-action="fridgeQuick" data-name="${esc(i.title)}" data-keep-focus>${icon('star', 'icon-sm')}${esc(i.title)}</button>`);
  const quick = quickPicks().filter((x) => !q || x.name.toLowerCase().includes(q))
    .map((x) => `<button type="button" class="chip suggest-chip" data-action="fridgeQuick" data-name="${esc(x.name)}" data-keep-focus>${icon('plus', 'icon-sm')}${esc(x.name)}</button>`);
  return [...ideas, ...quick].join('');
}

// Ist der Name eine Menüidee? Dann wird er markiert (für die Morgen-Mitteilung „Nicht vergessen“)
const isIdea = (name) => state.ideas.some((i) => i.kind !== 'drink' && i.title?.toLowerCase() === name.trim().toLowerCase());

const item = (f) => `
  <li class="${isUrgent(f) ? 'is-urgent' : ''}">
    ${daysLeft(f) < 0
      ? `<button type="button" class="check check-toss" data-action="fridgeUsed" data-id="${esc(f.id)}" aria-label="Weggeworfen: ${esc(f.name)}">${icon('trash', 'icon-sm')}</button>`
      : `<button type="button" class="check" data-action="fridgeUsed" data-id="${esc(f.id)}" aria-label="Aufgebraucht: ${esc(f.name)}">${icon('check', 'icon-sm')}</button>`}
    <button type="button" class="list-main" data-action="fridgeEdit" data-id="${esc(f.id)}" aria-label="${esc(f.name)} bearbeiten">
      ${esc(f.name)}
      <small><span class="${isUrgent(f) ? 'amount-minus' : ''}">${esc(leftLabel(f))}</span>${f.from ? ` · von ${esc(f.from)}` : ''}</small>
    </button>
  </li>`;

// Meldung nach dem Erfassen: bis wann es hält (antippen in der Liste ändert das)
function added() {
  const f = state.fridge.at(-1);
  if (f) toast(`${f.name}: ${leftLabel(f)}`);
}

const daysBetween = (from, to) => Math.round((parseKey(to) - parseKey(from)) / 86400000);

function editItem(id) {
  const f = state.fridge.find((x) => x.id === id);
  if (!f) return;
  const start = addedDay(f);
  const form = openSheet({
    title: 'Im Kühlschrank',
    body: `
      <label class="field"><span>Was</span>
        <input class="input" name="name" value="${esc(f.name)}" required maxlength="80" autocomplete="off">
      </label>
      <label class="field"><span>Aufbrauchen bis</span>
        <input class="input" type="date" name="useBy" value="${esc(f.useBy)}" min="${start}" required>
      </label>
      <div class="field"><span>Haltbar ab ${esc(fmtShort(start))}</span>
        <div class="chips fridge-days">${DAY_CHOICES.map((d) => `<button type="button" class="chip" data-sheet-action="days" data-days="${d}">${d} ${d === 1 ? 'Tag' : 'Tage'}</button>`).join('')}</div>
      </div>
      <p class="muted small" style="margin:-4px 0 0">${f.from ? `Rest von ${esc(f.from)}. ` : ''}Die gewählte Haltbarkeit schlägt die App beim nächsten Mal wieder vor.</p>`,
    submitLabel: 'Speichern',
    footer: `<button type="button" class="btn btn-block" data-sheet-action="used">${icon('check', 'icon-sm')} Aufgebraucht</button>
      <button type="button" class="btn btn-danger btn-block" data-sheet-action="toss">Weggeworfen</button>`,
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      const useBy = String(data.get('useBy'));
      if (!name || !useBy) return false;
      changeFridgeItem(id, { name, useBy, days: useBy !== f.useBy ? Math.max(0, daysBetween(start, useBy)) : null });
    },
    actions: {
      days(btn, form) {
        form.elements.useBy.value = dateKey(addDays(parseKey(start), Number(btn.dataset.days)));
        markDays(form);
      },
      change(el, form) { if (el.name === 'useBy') markDays(form); },
      used() { done(f, 'aufgebraucht'); },
      toss() { done(f, 'weggeworfen'); },
    },
  });
  // Gewählte Anzahl Tage als aktiv zeigen
  const markDays = (fm) => {
    const n = daysBetween(start, fm.elements.useBy.value || start);
    for (const b of fm.querySelectorAll('[data-sheet-action="days"]')) b.classList.toggle('is-on', Number(b.dataset.days) === n);
  };
  markDays(form);
}

function done(f, what) {
  removeFridgeItem(f.id);
  closeSheet();
  toast(`${f.name} ${what}`);
}

export default {
  id: 'kuehlschrank',
  title: 'Kühlschrank',

  render() {
    const items = fridgeSorted();
    return `
      <form class="add-row" data-form="addFridge">
        <input class="input" id="fridge-input" name="name" placeholder="Was ist übrig? z. B. Pesto" autocomplete="off" enterkeyhint="done" required maxlength="80" data-input="fridgeSuggest">
        <button type="submit" class="btn btn-primary" aria-label="In den Kühlschrank">${icon('plus')}</button>
      </form>
      <div class="suggest" id="fridge-suggest" aria-label="Vorschläge – Stern: Menüidee">${suggestHtml()}</div>
      ${items.length
        ? `<ul class="list fridge-list">${items.map(item).join('')}</ul>`
        : `<div class="empty"><strong>Nichts vermerkt</strong>Bleibt etwas übrig, z. B. Pesto, hier eintragen – oder im Wochenplan beim Gericht „Reste in den Kühlschrank“.</div>`}
      <p class="muted small fridge-note">Die App schlägt vor, wie lange etwas gekühlt hält (offen oder gekocht, vorsichtig gerechnet). Im Zweifel anschauen und riechen. Abhaken, wenn es aufgebraucht ist.</p>`;
  },

  input: {
    fridgeSuggest(el, root) { root.querySelector('#fridge-suggest').innerHTML = suggestHtml(el.value); },
  },

  actions: {
    fridgeUsed(el) {
      const f = state.fridge.find((x) => x.id === el.dataset.id);
      if (f) done(f, daysLeft(f) < 0 ? 'weggeworfen' : 'aufgebraucht');
    },
    fridgeEdit(el) { editItem(el.dataset.id); },
    fridgeQuick(el) {
      addToFridge([{ name: el.dataset.name, idea: isIdea(el.dataset.name) }]);
      added();
    },
  },

  submit: {
    addFridge(form) {
      const name = form.elements.name.value.trim();
      if (!name) return;
      addToFridge([{ name, idea: isIdea(name) }]);
      added();
      document.getElementById('fridge-input')?.focus();
    },
  },
};
