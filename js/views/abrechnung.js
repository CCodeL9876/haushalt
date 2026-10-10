// Schuldenverrechnung: Saldo pro Person über alle Ausgaben, Vorschlag für möglichst wenige Ausgleichszahlungen.
// Eine erledigte Zahlung wird als „transfer“ gespeichert und gleicht den Saldo aus.

import { memberById, state, update, uid } from '../store.js';
import { avatar, esc, icon, money, toast } from '../ui.js';
import { fmtShort, todayKey } from '../dates.js';
import { balances, suggestTransfers } from '../settle.js';

export default {
  id: 'abrechnung',
  title: 'Abrechnung',
  icon: 'swap',

  render() {
    if (state.members.length < 2) {
      return `<div class="empty"><strong>Mindestens zwei Personen nötig</strong>Personen oben rechts unter „Haushalt“ erfassen.</div>`;
    }
    const bal = balances(state.members, state.expenses);
    const transfers = suggestTransfers(bal);
    const history = state.expenses.filter((e) => e.kind === 'transfer').sort((a, b) => b.date.localeCompare(a.date));

    return `
      <h2 class="section-title" style="margin-top:4px">Stand</h2>
      <ul class="list">${state.members.map((m) => {
        const v = bal.get(m.id);
        const label = v > 0 ? 'bekommt' : v < 0 ? 'schuldet' : 'ausgeglichen';
        return `<li>
          ${avatar(m)}
          <span class="list-main">${esc(m.name)}<small>${label}</small></span>
          <span class="list-value ${v > 0 ? 'amount-plus' : v < 0 ? 'amount-minus' : 'muted'}">${money(v, { sign: true })}</span>
        </li>`;
      }).join('')}</ul>

      <h2 class="section-title">So wird ausgeglichen</h2>
      ${transfers.length ? `<ul class="list">${transfers.map((t) => `
        <li class="transfer">
          ${avatar(memberById(t.from))}${icon('arrow', 'icon-sm muted')}${avatar(memberById(t.to))}
          <span class="list-main">${esc(memberById(t.from).name)} → ${esc(memberById(t.to).name)}<small>${money(t.amount)}</small></span>
          <button type="button" class="btn btn-sm btn-primary" data-action="settle" data-from="${t.from}" data-to="${t.to}" data-amount="${t.amount}">Bezahlt</button>
        </li>`).join('')}</ul>`
        : `<div class="card" style="text-align:center"><strong>Alles ausgeglichen</strong></div>`}

      ${history.length ? `
        <h2 class="section-title">Bisherige Ausgleichszahlungen</h2>
        <ul class="list">${history.map((h) => `
          <li>
            <span class="list-main">${esc(memberById(h.payerId)?.name || '–')} → ${esc(memberById(h.splitIds[0])?.name || '–')}<small>${fmtShort(h.date)}</small></span>
            <span class="list-value">${money(h.amount)}</span>
            <button type="button" class="icon-btn" data-action="undo" data-id="${h.id}" aria-label="Zahlung rückgängig machen">${icon('trash', 'icon-sm')}</button>
          </li>`).join('')}
        </ul>` : ''}`;
  },

  actions: {
    settle(el) {
      const amount = Number(el.dataset.amount);
      update((s) => {
        s.expenses.push({ id: uid(), kind: 'transfer', title: 'Ausgleich', amount, payerId: el.dataset.from, splitIds: [el.dataset.to], category: '', date: todayKey() });
      });
      toast(`${money(amount)} als bezahlt erfasst`);
    },
    undo(el) {
      if (!confirm('Diese Ausgleichszahlung entfernen?')) return;
      update((s) => { s.expenses = s.expenses.filter((x) => x.id !== el.dataset.id); });
    },
  },
};
