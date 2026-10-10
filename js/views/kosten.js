// Kostenaufstellung: Ausgaben pro Monat, nach Kategorie zusammengefasst.
// Wer bezahlt hat und auf wen es aufgeteilt wird, fliesst in die Abrechnung.

import { memberById, state, update, uid, refresh } from '../store.js';
import { closeSheet, esc, icon, money, openSheet, parseMoney, toast } from '../ui.js';
import { fmtMonthYear, fmtShort, monthKey, todayKey } from '../dates.js';
import { currentMember } from '../login.js';

let monthOffset = 0; // 0 = dieser Monat

const currentMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1);
};

export function editExpense(id) {
  const e = state.expenses.find((x) => x.id === id);
  const { members, settings } = state;
  if (!members.length) return toast('Zuerst Personen im Haushalt erfassen (oben rechts)');
  const split = new Set(e?.splitIds || members.map((m) => m.id));
  const payerId = e?.payerId || currentMember()?.id; // neu: „Bezahlt von“ = wer am Gerät angemeldet ist
  openSheet({
    title: e ? 'Ausgabe bearbeiten' : 'Neue Ausgabe',
    body: `
      <div class="row">
        <label class="field"><span>Betrag (${esc(settings.currency)})</span>
          <input class="input" name="amount" inputmode="decimal" value="${e ? (e.amount / 100).toFixed(2) : ''}" placeholder="0.00" required autocomplete="off">
        </label>
        <label class="field"><span>Datum</span>
          <input class="input" type="date" name="date" value="${esc(e?.date || todayKey())}" required>
        </label>
      </div>
      <label class="field"><span>Wofür?</span>
        <input class="input" name="title" value="${esc(e?.title)}" placeholder="z. B. Wocheneinkauf" required autocomplete="off">
      </label>
      <label class="field"><span>Kategorie</span>
        <select class="select" name="category">${settings.categories.map((c) => `<option ${c === e?.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Bezahlt von</span>
        <select class="select" name="payerId">${members.map((m) => `<option value="${m.id}" ${m.id === payerId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      </label>
      <div class="field"><span>Aufteilen auf</span>
        <div class="chips">${members.map((m) => `
          <label class="chip chip-toggle"><input type="checkbox" name="split" value="${m.id}" ${split.has(m.id) ? 'checked' : ''}>${esc(m.name)}</label>`).join('')}
        </div>
      </div>`,
    submitLabel: 'Speichern',
    footer: e ? `<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Ausgabe löschen</button>` : '',
    actions: {
      remove() {
        update((s) => { s.expenses = s.expenses.filter((x) => x.id !== e.id); });
        closeSheet();
      },
    },
    onSubmit(data) {
      const amount = parseMoney(data.get('amount'));
      const splitIds = data.getAll('split').map(String);
      if (!amount) { toast('Bitte einen gültigen Betrag eingeben'); return false; }
      if (!splitIds.length) { toast('Mindestens eine Person zum Aufteilen wählen'); return false; }
      const values = {
        kind: 'expense',
        title: String(data.get('title')).trim(),
        amount,
        date: String(data.get('date')),
        category: String(data.get('category')),
        payerId: String(data.get('payerId')),
        splitIds,
      };
      update((s) => {
        if (e) Object.assign(s.expenses.find((x) => x.id === e.id), values);
        else s.expenses.push({ id: uid(), ...values });
      });
    },
  });
}

export default {
  id: 'kosten',
  title: 'Kosten',
  icon: 'wallet',

  render() {
    const month = currentMonth();
    const key = monthKey(month);
    const list = state.expenses
      .filter((e) => e.kind === 'expense' && e.date.startsWith(key))
      .sort((a, b) => b.date.localeCompare(a.date));
    const total = list.reduce((sum, e) => sum + e.amount, 0);
    const byCategory = [...list.reduce((map, e) => map.set(e.category, (map.get(e.category) || 0) + e.amount), new Map())]
      .sort((a, b) => b[1] - a[1]);
    const max = byCategory[0]?.[1] || 1;

    return `
      <div class="week-nav">
        <button type="button" class="icon-btn" data-action="month" data-step="-1" aria-label="Vorheriger Monat">${icon('left')}</button>
        <strong>${fmtMonthYear(month)}</strong>
        <button type="button" class="icon-btn" data-action="month" data-step="1" aria-label="Nächster Monat">${icon('right')}</button>
      </div>
      <section class="card">
        <div class="muted small">Ausgaben im Monat</div>
        <div class="hero-number">${money(total)}</div>
        ${byCategory.length ? `<div class="bars" role="list" aria-label="Ausgaben nach Kategorie">
          ${byCategory.map(([cat, sum]) => `
            <div class="bar-row" role="listitem">
              <span>${esc(cat)}</span><span class="bar-value">${money(sum)}</span>
              <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${(sum / max) * 100}%"></div></div>
            </div>`).join('')}
        </div>` : ''}
      </section>
      ${list.length ? `
        <h2 class="section-title">Einträge</h2>
        <ul class="list">${list.map((e) => `
          <li>
            <button type="button" class="list-main" data-action="edit" data-id="${e.id}">
              ${esc(e.title)}
              <small>${fmtShort(e.date)} · ${esc(e.category)} · ${esc(memberById(e.payerId)?.name || '–')}</small>
            </button>
            <span class="list-value">${money(e.amount)}</span>
          </li>`).join('')}
        </ul>`
        : `<div class="empty"><strong>Keine Ausgaben</strong>Mit + eine Ausgabe erfassen.</div>`}
      <button type="button" class="fab" data-action="edit" aria-label="Neue Ausgabe">${icon('plus')}</button>`;
  },

  actions: {
    month(el) {
      monthOffset += Number(el.dataset.step);
      refresh();
    },
    edit(el) { editExpense(el.dataset.id); },
  },
};
