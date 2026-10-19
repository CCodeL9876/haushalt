// Kühlschrank (Teil von Essen): Reste und Angebrochenes mit „aufbrauchen bis“, das Dringendste zuoberst.
// Erfassen hier oder im Wochenplan beim Gericht („Reste in den Kühlschrank“). Logik und Richtwerte: js/fridge.js.

import { state } from '../store.js';
import { closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { addDays, dateKey, fmtShort, parseKey } from '../dates.js';
import { DAY_CHOICES, addToFridge, addedDay, changeFridgeItem, fridgeSorted, isUrgent, leftLabel, removeFridgeItem } from '../fridge.js';

const MAX_QUICK = 8;
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

const item = (f) => `
  <li class="${isUrgent(f) ? 'is-urgent' : ''}">
    <button type="button" class="check" data-action="fridgeUsed" data-id="${f.id}" aria-label="Aufgebraucht: ${esc(f.name)}">${icon('check', 'icon-sm')}</button>
    <button type="button" class="list-main" data-action="fridgeEdit" data-id="${f.id}" aria-label="${esc(f.name)} bearbeiten">
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
      toss() { done(f, 'entfernt'); },
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
    const quick = quickPicks();
    return `
      <form class="add-row" data-form="addFridge">
        <input class="input" id="fridge-input" name="name" placeholder="Was ist übrig? z. B. Pesto" autocomplete="off" enterkeyhint="done" required maxlength="80">
        <button type="submit" class="btn btn-primary" aria-label="In den Kühlschrank">${icon('plus')}</button>
      </form>
      ${quick.length ? `<div class="suggest">${quick.map((q) => `<button type="button" class="chip suggest-chip" data-action="fridgeQuick" data-name="${esc(q.name)}">${icon('plus', 'icon-sm')}${esc(q.name)}</button>`).join('')}</div>` : ''}
      ${items.length
        ? `<ul class="list fridge-list">${items.map(item).join('')}</ul>`
        : `<div class="empty"><strong>Nichts vermerkt</strong>Bleibt etwas übrig, z. B. Pesto, hier eintragen – oder im Wochenplan beim Gericht „Reste in den Kühlschrank“.</div>`}
      <p class="muted small fridge-note">Die App schlägt vor, wie lange etwas gekühlt hält (offen oder gekocht, vorsichtig gerechnet). Im Zweifel anschauen und riechen. Abhaken, wenn es aufgebraucht ist.</p>`;
  },

  actions: {
    fridgeUsed(el) {
      const f = state.fridge.find((x) => x.id === el.dataset.id);
      if (f) done(f, 'aufgebraucht');
    },
    fridgeEdit(el) { editItem(el.dataset.id); },
    fridgeQuick(el) {
      addToFridge([{ name: el.dataset.name }]);
      added();
    },
  },

  submit: {
    addFridge(form) {
      const name = form.elements.name.value.trim();
      if (!name) return;
      addToFridge([{ name }]);
      added();
      document.getElementById('fridge-input')?.focus();
    },
  },
};
