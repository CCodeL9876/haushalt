// Abrechnung: Wer schuldet wem wie viel – und eine fortlaufende Liste aller Rechnungen und Rückzahlungen.
//  - Rechnung: jemand hat etwas bezahlt. Die Schuld der anderen steigt um den ganzen Betrag (z. B. nur für die
//    andere Person gekauft) oder um ihren Anteil (gemeinsame Ausgabe, z. B. Wocheneinkauf).
//  - Rückzahlung: jemand zahlt der anderen Person Geld zurück (Twint, Neon, Überweisung …) – die Schuld sinkt.
//    Zahlt dagegen die Person mit Schulden eine Rechnung (z. B. Strom für beide), ist das eine Rechnung von ihr –
//    die Schuld sinkt dann um den Anteil der anderen. Beide Formulare zeigen, wie hoch die Schuld danach ist.
// Gespeichert in state.expenses wie bisher: Rechnung = kind 'expense' (payerId hat bezahlt, splitIds tragen es),
// Rückzahlung = kind 'transfer' (payerId zahlt an splitIds[0]). Neu dazu: note (Was beinhaltet es?) und method.
// Ältere Einträge aus „Kosten“ erscheinen ganz normal in der Liste.

import { memberById, refresh, state, update, uid } from '../store.js';
import { avatar, closeSheet, esc, icon, money, openSheet, parseMoney, toast } from '../ui.js';
import { fmtDayMonth, fmtMonthYear, parseKey, todayKey } from '../dates.js';
import { balances } from '../settle.js';
import { currentMember } from '../login.js';

const isPayment = (e) => e.kind === 'transfer';
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
const name = (id) => memberById(id)?.name || '–';
const others = (id) => state.members.filter((m) => m.id !== id);

// Bei zwei Personen: wer schuldet aktuell wem (debtor → creditor) und wie viel. Bei 0 die erste Person als „Gläubiger“.
function pair() {
  const [a, b] = state.members;
  const bal = balances([a, b], state.expenses).get(a.id); // > 0: b schuldet a
  return bal >= 0 ? { creditor: a, debtor: b, amount: bal } : { creditor: b, debtor: a, amount: -bal };
}

// Wirkung eines Eintrags auf die Schuld debtor → creditor (+ = Schuld steigt, − = sinkt)
const effect = (e, p) => balances([p.creditor, p.debtor], [e]).get(p.creditor.id);

function shareLabel(e) {
  if (isPayment(e)) return '';
  const split = e.splitIds || [];
  if (split.length === 1 && split[0] !== e.payerId) return `ganz für ${name(split[0])}`;
  if (split.includes(e.payerId) && split.length > 1) return `${split.length === 2 ? 'Hälfte' : `1/${split.length}`} von ${money(e.amount)}`;
  return '';
}

// ---------- Formulare ----------

// „Danach: Ben schuldet Anna CHF 20.00“ – Stand, wenn der Eintrag so gespeichert wird (nur bei zwei Personen).
// Beim Bearbeiten zählt der bisherige Eintrag nicht mehr, dafür der geänderte.
function standAfter(e, values) {
  if (state.members.length !== 2) return '';
  const [a, b] = state.members;
  const list = state.expenses.filter((x) => x.id !== e?.id);
  if (values) list.push(values);
  const v = balances([a, b], list).get(a.id);
  if (v === 0) return 'Danach seid ihr quitt.';
  return v > 0 ? `Danach: ${b.name} schuldet ${a.name} ${money(v)}.` : `Danach: ${a.name} schuldet ${b.name} ${money(-v)}.`;
}

const methodOptions = (current) => {
  const list = [...state.settings.methods];
  if (current && !list.includes(current)) list.push(current); // ältere oder gelöschte Zahlungsart beibehalten
  return `<option value="">–</option>${list.map((m) => `<option ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
};
const memberOptions = (selected, list = state.members) => list.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

function removeButton(e) {
  return e ? `<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">${isPayment(e) ? 'Rückzahlung' : 'Rechnung'} löschen</button>` : '';
}
const removeAction = (e) => () => {
  if (!confirm(`${isPayment(e) ? 'Diese Rückzahlung' : 'Diese Rechnung'} löschen?`)) return;
  update((s) => { s.expenses = s.expenses.filter((x) => x.id !== e.id); });
  closeSheet();
};

const amountField = (label, e, hint = '') => `
  <div class="row">
    <label class="field"><span>${label} (${esc(state.settings.currency)})</span>
      <input class="input" name="amount" inputmode="decimal" value="${e ? (e.amount / 100).toFixed(2) : ''}" placeholder="0.00" required autocomplete="off">
      ${hint}
    </label>
    <label class="field"><span>Datum</span>
      <input class="input" type="date" name="date" value="${esc(e?.date || todayKey())}" required>
    </label>
  </div>`;

// Rückzahlung: from zahlt Geld an to. preset: { from, to, amount } = aktueller Stand („Ganzer Betrag“)
function editPayment(e, preset = {}) {
  const from = e?.payerId || preset.from || state.members[0].id;
  const to = e?.splitIds?.[0] || preset.to || others(from)[0]?.id;
  // Neue Rückzahlung: zuletzt benutzte Zahlungsart vorschlagen
  const lastMethod = [...state.expenses].filter((x) => isPayment(x) && x.method).sort(byDateDesc)[0]?.method;
  const method = e ? e.method : lastMethod;
  openSheet({
    title: e ? 'Rückzahlung bearbeiten' : 'Rückzahlung erfassen',
    body: `
      <p class="muted small kind-hint">Geld direkt an die andere Person zurückgezahlt. Wer stattdessen eine Rechnung bezahlt hat (z. B. Strom), erfasst sie als <strong>Rechnung</strong>.</p>
      ${amountField('Betrag', e, preset.amount ? `<button type="button" class="btn btn-ghost btn-sm pay-all" data-sheet-action="all">Ganzer Betrag: ${money(preset.amount)}</button>` : '')}
      <div class="row">
        <label class="field"><span>Von</span><select class="select" name="from">${memberOptions(from)}</select></label>
        <label class="field"><span>An</span><select class="select" name="to">${memberOptions(to)}</select></label>
      </div>
      <label class="field"><span>Bezahlt per</span><select class="select" name="method">${methodOptions(method)}</select></label>
      <label class="field"><span>Notiz (optional)</span>
        <input class="input" name="note" value="${esc(e?.note ?? (e && e.title !== 'Ausgleich' ? e.title : ''))}" placeholder="z. B. Miete Oktober, Teil der Ferien" autocomplete="off" maxlength="200">
      </label>
      <p class="small stand-hint" aria-live="polite"></p>`,
    submitLabel: 'Speichern',
    footer: removeButton(e),
    actions: {
      remove: e && removeAction(e),
      all(_, form) {
        form.elements.amount.value = (preset.amount / 100).toFixed(2);
        paymentHint(form, e);
      },
      change(_, form) { paymentHint(form, e); },
    },
    onSubmit(data) {
      const amount = parseMoney(data.get('amount'));
      const payerId = String(data.get('from'));
      const toId = String(data.get('to'));
      if (!amount) { toast('Bitte einen gültigen Betrag eingeben'); return false; }
      if (payerId === toId) { toast('„Von“ und „An“ müssen verschieden sein'); return false; }
      const note = String(data.get('note') || '').trim();
      const values = { kind: 'transfer', title: note || 'Rückzahlung', note, amount, date: String(data.get('date')), payerId, splitIds: [toId], method: String(data.get('method') || ''), category: '' };
      save(e, values);
    },
  });
  const form = document.querySelector('#sheet form');
  form.addEventListener('input', () => paymentHint(form, e));
  paymentHint(form, e);
}

function paymentHint(form, e) {
  const amount = parseMoney(form.elements.amount.value);
  const from = form.elements.from.value;
  const to = form.elements.to.value;
  form.querySelector('.stand-hint').textContent = amount && from !== to
    ? standAfter(e, { kind: 'transfer', amount, payerId: from, splitIds: [to] })
    : '';
}

// Rechnung: payer hat bezahlt; share 'split' = alle teilen, 'full' = ganz für eine andere Person
// Neue Rechnung von aussen (Plus für alles, js/quickadd.js): { note, amount (Franken) }
export function newBill({ note = '', amount } = {}) {
  editBill(null, { note });
  const form = document.querySelector('#sheet form');
  if (amount && form) {
    form.elements.amount.value = amount.toFixed(2);
    form.dispatchEvent(new Event('input'));
  }
}

function editBill(e, preset = {}) {
  const payer = e?.payerId || preset.payer || currentMember()?.id || state.members[0].id;
  const split = e?.splitIds || [];
  const full = e ? split.length === 1 && split[0] !== e.payerId : Boolean(preset.full);
  const forId = full ? (e ? split[0] : preset.forId) : others(payer)[0]?.id;
  const twoPeople = state.members.length === 2;
  openSheet({
    title: e ? 'Rechnung bearbeiten' : 'Rechnung erfassen',
    body: `
      ${amountField('Betrag', e)}
      <label class="field"><span>Was beinhaltet die Rechnung?</span>
        <input class="input" name="note" value="${esc(e?.note ?? e?.title ?? preset.note ?? '')}" placeholder="z. B. Wocheneinkauf Migros, Stromrechnung" required autocomplete="off" maxlength="200">
      </label>
      <label class="field"><span>Wer hat die Rechnung bezahlt?</span><select class="select" name="payer">${memberOptions(payer)}</select></label>
      <div class="field"><span>Wer trägt es?</span>
        <div class="seg seg-wide" role="radiogroup">
          <label class="seg-btn seg-radio"><input type="radio" name="share" value="split" ${full ? '' : 'checked'}>${twoPeople ? 'Hälfte' : 'Alle teilen'}</label>
          <label class="seg-btn seg-radio"><input type="radio" name="share" value="full" ${full ? 'checked' : ''}>Ganzer Betrag</label>
        </div>
        <p class="muted small share-hint" style="margin:0"></p>
        <label class="field share-for" style="margin:8px 0 0" ${full && !twoPeople ? '' : 'hidden'}><span>Ganz für</span>
          <select class="select" name="forId">${memberOptions(forId, others(payer))}</select>
        </label>
      </div>
      <label class="field"><span>Bezahlt per (optional)</span><select class="select" name="method">${methodOptions(e?.method)}</select></label>
      <p class="small stand-hint" aria-live="polite"></p>`,
    submitLabel: 'Speichern',
    footer: removeButton(e),
    actions: {
      remove: e && removeAction(e),
      // Hinweis und Auswahl „Ganz für“ nachführen, wenn sich Betrag, Zahler oder Anteil ändern
      change(_, form) { billHint(form, twoPeople, e); },
    },
    onSubmit(data) {
      const amount = parseMoney(data.get('amount'));
      if (!amount) { toast('Bitte einen gültigen Betrag eingeben'); return false; }
      const payerId = String(data.get('payer'));
      const isFull = data.get('share') === 'full';
      const target = twoPeople ? others(payerId)[0].id : String(data.get('forId'));
      if (isFull && (!target || target === payerId)) { toast('Bitte wählen, für wen die Rechnung ist'); return false; }
      const note = String(data.get('note')).trim();
      const values = {
        kind: 'expense', title: note, note, amount, date: String(data.get('date')), payerId,
        splitIds: isFull ? [target] : state.members.map((m) => m.id),
        method: String(data.get('method') || ''), category: e?.category || '',
      };
      save(e, values);
    },
  });
  const form = document.querySelector('#sheet form');
  form.addEventListener('input', () => billHint(form, twoPeople, e));
  billHint(form, twoPeople, e);
}

function billHint(form, twoPeople, e) {
  const payerId = form.elements.payer.value;
  const full = form.elements.share.value === 'full';
  const amount = parseMoney(form.elements.amount.value) || 0;
  const forSel = form.elements.forId;
  // „Ganz für“: nur andere Personen als der Zahler
  if (!twoPeople) {
    const keep = forSel.value;
    forSel.innerHTML = memberOptions(others(payerId).some((m) => m.id === keep) ? keep : others(payerId)[0]?.id, others(payerId));
  }
  form.querySelector('.share-for').hidden = !full || twoPeople;
  const n = state.members.length;
  const who = full ? name(twoPeople ? others(payerId)[0].id : forSel.value) : (twoPeople ? name(others(payerId)[0].id) : 'Jede andere Person');
  const part = full ? amount : Math.round(amount / n);
  form.querySelector('.share-hint').textContent = amount
    ? `${who === 'Jede andere Person' ? who : `Anteil von ${who}`}: ${money(part)}`
    : full ? 'Die andere Person trägt den ganzen Betrag.' : `Jede Person trägt ${twoPeople ? 'die Hälfte' : 'den gleichen Anteil'}.`;
  const target = full ? (twoPeople ? others(payerId)[0]?.id : forSel.value) : null;
  form.querySelector('.stand-hint').textContent = amount
    ? standAfter(e, { kind: 'expense', amount, payerId, splitIds: full ? [target] : state.members.map((m) => m.id) })
    : '';
}

function save(e, values) {
  update((s) => {
    if (e) Object.assign(s.expenses.find((x) => x.id === e.id), values);
    else s.expenses.push({ id: uid(), createdAt: Date.now(), ...values });
  });
  toast(e ? 'Gespeichert' : isPayment(values) ? 'Rückzahlung erfasst' : 'Rechnung erfasst');
}

// ---------- Ansicht ----------

function entryRow(e, p, after) {
  const pay = isPayment(e);
  const kind = pay ? 'Rückzahlung' : 'Rechnung';
  const title = e.note || (e.title === 'Ausgleich' ? '' : e.title) || kind;
  const meta = [
    title === kind ? '' : kind, // ohne Notiz steht die Art schon als Titel da
    e.date ? fmtDayMonth(parseKey(e.date)) : '',
    pay ? `${name(e.payerId)} → ${name(e.splitIds?.[0])}` : `${name(e.payerId)} bezahlt`,
    shareLabel(e),
    e.method,
  ].filter(Boolean).join(' · ');
  let right = `<span class="list-value">${money(e.amount)}</span>`;
  if (p) {
    // Betrag, um den sich die Schuld verändert (Rückzahlung: der Betrag, Rechnung: der Anteil der anderen),
    // darunter in Worten, wer danach wem schuldet – unabhängig davon, wer gerade Schulden hat
    const d = Math.abs(effect(e, p));
    const [a, b] = [p.creditor, p.debtor];
    const owes = after > 0 ? b.name : a.name;
    right = `<span class="ledger-value">
      <span class="${pay ? 'ledger-pay' : ''}">${money(d)}</span>
      <small class="muted">${after === 0 ? 'quitt' : `${esc(owes)} schuldet ${total(Math.abs(after))}`}</small>
    </span>`;
  }
  return `
    <li>
      <span class="ledger-kind ${pay ? 'is-payment' : 'is-bill'}" aria-hidden="true">${icon(pay ? 'arrow' : 'receipt', 'icon-sm')}</span>
      <button type="button" class="list-main" data-action="edit" data-id="${esc(e.id)}" aria-label="${pay ? 'Rückzahlung' : 'Rechnung'} ${esc(title)} bearbeiten">
        ${esc(title)}<small>${esc(meta)}</small>
      </button>
      ${right}
    </li>`;
}

// Gesamtstand verdeckt („CHF *****“), bis man ihn antippt – auf den ersten Blick soll er nicht zu sehen sein.
// Wieder verdeckt, sobald man die Abrechnung verlässt oder die App in den Hintergrund geht.
let totalShown = false;
const hiddenMoney = () => `${state.settings.currency} *****`;
const total = (cents, opts) => (totalShown ? money(cents, opts) : hiddenMoney());
window.addEventListener('hashchange', () => { totalShown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && totalShown) {
    totalShown = false;
    refresh();
  }
});
const totalButton = (inner, cls = '') => `<button type="button" class="total-toggle ${cls}" data-action="toggleTotal" aria-pressed="${totalShown}" aria-label="${totalShown ? 'Betrag verbergen' : 'Betrag anzeigen'}">${inner}</button>`;

function ledger(p) {
  const entries = [...state.expenses].sort(byDateDesc);
  if (!entries.length) return '';
  // Laufender Stand nach jedem Eintrag (älteste zuerst aufsummieren)
  const after = new Map();
  if (p) {
    let run = 0;
    for (const e of [...entries].reverse()) {
      run += effect(e, p);
      after.set(e.id, run);
    }
  }
  const groups = new Map();
  for (const e of entries) {
    const m = (e.date || '').slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(e);
  }
  return [...groups].map(([m, list]) => `
    <h2 class="section-title">${m ? fmtMonthYear(parseKey(`${m}-01`)) : 'Ohne Datum'}</h2>
    <ul class="list ledger">${list.map((e) => entryRow(e, p, after.get(e.id))).join('')}</ul>`).join('');
}

export default {
  id: 'abrechnung',
  title: 'Abrechnung',
  tab: 'Geld', // kurz, damit neben dem Plus alle Bereiche in die Tab-Leiste passen
  icon: 'wallet',
  aliases: ['kosten'],
  enter() {},

  render() {
    if (state.members.length < 2) {
      return `<div class="empty"><strong>Mindestens zwei Personen nötig</strong>Personen oben rechts unter „Haushalt“ erfassen.</div>`;
    }
    const two = state.members.length === 2;
    const p = two ? pair() : null;
    let head;
    if (p) {
      head = `
        <section class="card balance-card">
          ${p.amount ? `
            <div class="balance-who">${avatar(p.debtor)}<span>${esc(p.debtor.name)} schuldet ${esc(p.creditor.name)}</span>${avatar(p.creditor)}</div>
            ${totalButton(`<span class="hero-number">${total(p.amount)}</span><small>${totalShown ? 'Antippen zum Verbergen' : 'Antippen zum Anzeigen'}</small>`, 'total-hero')}`
            : `<div class="balance-who"><span>Ihr seid quitt</span></div><div class="hero-number">${money(0)}</div>`}
        </section>`;
    } else {
      const bal = balances(state.members, state.expenses);
      head = `<ul class="list">${state.members.map((m) => {
        const v = bal.get(m.id);
        return `<li>${avatar(m)}<span class="list-main">${esc(m.name)}<small>${v > 0 ? 'bekommt' : v < 0 ? 'schuldet' : 'ausgeglichen'}</small></span>
          ${totalButton(`<span class="list-value ${v > 0 ? 'amount-plus' : v < 0 ? 'amount-minus' : 'muted'}">${total(v, { sign: true })}</span>`)}</li>`;
      }).join('')}</ul>`;
    }
    const list = ledger(p);
    return `
      ${head}
      <div class="row balance-actions">
        <button type="button" class="btn btn-primary" data-action="newPayment">${icon('arrow', 'icon-sm')} Rückzahlung</button>
        <button type="button" class="btn" data-action="newBill">${icon('receipt', 'icon-sm')} Rechnung</button>
      </div>
      ${list || `<div class="empty"><strong>Noch keine Einträge</strong>Schuldet jemand schon etwas? Den aktuellen Betrag als Startwert erfassen.
        <p><button type="button" class="btn btn-sm" data-action="opening" style="margin-top:12px">Startbetrag erfassen</button></p></div>`}`;
  },

  actions: {
    toggleTotal() {
      totalShown = !totalShown;
      refresh();
    },
    newPayment() {
      const p = state.members.length === 2 ? pair() : null;
      editPayment(null, p && p.amount ? { from: p.debtor.id, to: p.creditor.id, amount: p.amount } : { from: currentMember()?.id });
    },
    newBill() { editBill(null); },
    // Anfangsstand: eine Rechnung über den ganzen Betrag, die die Schuld auf den heutigen Stand bringt
    opening() {
      const me = currentMember() || state.members[0];
      editBill(null, { payer: me.id, full: true, forId: others(me.id)[0]?.id, note: 'Startbetrag (bisherige Schuld)' });
    },
    edit(el) {
      const e = state.expenses.find((x) => x.id === el.dataset.id);
      if (!e) return;
      if (isPayment(e)) editPayment(e);
      else editBill(e);
    },
  },
};
