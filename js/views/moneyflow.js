// Geld → Moneyflow: gemeinsame Planung des Haushalts – alle sehen und bearbeiten dasselbe (state.flow, js/store.js).
// Anders als die persönliche Planung (js/views/planung.js) liegt sie in der Datenbank und die Beträge sind sichtbar.
//  - Monat: Einnahmen minus Fixkosten minus Rechnungen, die in diesem Monat zählen → was bleibt.
//  - Rechnungen: kommende Rechnungen mit Fälligkeitsdatum, wer bezahlt (gemeinsames Konto oder eine Person),
//    ganz / in Raten / auf Monate verteilt, auf Wunsch jährlich oder vierteljährlich wiederholt.
//    Zahlt eine Person, kann die Zahlung gleich als Rechnung in die Abrechnung (state.expenses) übernommen werden.
//  - Fix: monatliche gemeinsame Kosten (Miete, Nebenkosten …), Einnahmen: monatliche Einzahlungen.

import { memberById, refresh, state, uid, update } from '../store.js';
import { avatar, closeSheet, esc, icon, money, openSheet, parseMoney, toast, undoRemove } from '../ui.js';
import { dateKey, fmtMonthYear, fmtShort, parseKey, todayKey } from '../dates.js';
import { addMonths, curMonth } from '../planung.js';
import { currentMember } from '../login.js';
import { celebrate } from '../celebrate.js';

const TABS = [['monat', 'Monat'], ['rechnungen', 'Rechnungen'], ['fix', 'Fix'], ['einnahmen', 'Einnahmen']];
const TAB_KEY = 'haushalt.moneyflow.tab';
const FILTERS = [['open', 'Offen'], ['paid', 'Bezahlt'], ['all', 'Alle']];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const REPEAT = { q: 'vierteljährlich', y: 'jährlich' };

let tab = (() => { try { const v = localStorage.getItem(TAB_KEY); return TABS.some(([id]) => id === v) ? v : 'monat'; } catch { return 'monat'; } })();
let month = curMonth();
let filter = 'open';
window.addEventListener('hashchange', () => { month = curMonth(); });

const cur = () => state.settings.currency || 'CHF';
const sum = (list) => list.reduce((s, x) => s + (x.amount || 0), 0);
const amountValue = (cents) => (cents ? (cents / 100).toFixed(2) : '');
const monthLabel = (key) => fmtMonthYear(parseKey(`${key}-01`));
const monthName = (key) => monthLabel(key).split(' ')[0];
const items = (type) => state.flow.filter((x) => x.type === type);

// ---------- Rechnen ----------

const paidOf = (b) => (b.payments || []).reduce((s, p) => s + p.amount, 0);
const openOf = (b) => Math.max(0, b.amount - paidOf(b));
const dueMonth = (b) => (b.due || todayKey()).slice(0, 7);

// Wann zählt wie viel: { 'JJJJ-MM': Rappen } – ganz im Fälligkeitsmonat, in Raten oder gleichmässig verteilt
function scheduleOf(b) {
  const start = dueMonth(b);
  const out = {};
  if (b.when === 'rate' && b.rate > 0) {
    for (let i = 0, left = b.amount; left > 0 && i < 120; i += 1, left -= b.rate) out[addMonths(start, i)] = Math.min(b.rate, left);
  } else if (b.when === 'spread' && b.spread > 1) {
    const each = Math.floor(b.amount / b.spread);
    for (let i = 0; i < b.spread; i += 1) out[addMonths(start, i)] = each + (i === 0 ? b.amount - each * b.spread : 0);
  } else out[start] = b.amount;
  return out;
}
const inMonth = (b, key) => scheduleOf(b)[key] || 0;

// Raten: «Rate 2 von 3» nach dem, was schon bezahlt ist
function rateLabel(b) {
  const n = Object.keys(scheduleOf(b)).length;
  if (n < 2) return '';
  const paid = paidOf(b);
  let k = 1;
  for (const v of Object.values(scheduleOf(b)).slice(0, -1)) { if (paid >= v * k) k += 1; else break; }
  return openOf(b) ? `${Math.min(k, n)}/${n}` : `${n}/${n}`;
}

// Überfällig: ganz fällige Rechnung nach dem Datum offen; Raten: was vor diesem Monat hätte bezahlt sein sollen
function overdueOf(b) {
  const open = openOf(b);
  if (!open) return 0;
  if (Object.keys(scheduleOf(b)).length < 2) return b.due < todayKey() ? open : 0;
  const due = Object.entries(scheduleOf(b)).filter(([k]) => k < curMonth()).reduce((s, [, v]) => s + v, 0);
  return Math.max(0, due - paidOf(b));
}

// Was bis Ende dieses Monats bezahlt sein sollte und noch offen ist (Raten: nur die fälligen Raten)
const dueBy = (b, key) => Math.max(0, Object.entries(scheduleOf(b)).filter(([k]) => k <= key).reduce((s, [, v]) => s + v, 0) - paidOf(b));

const payerLabel = (b) => (b.payer && b.payer !== 'joint' ? `${memberById(b.payer)?.name || '–'} bezahlt` : 'gemeinsames Konto');
const stamp = () => ({ by: currentMember()?.id || null, changedAt: Date.now() });
const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || (a.addedAt || 0) - (b.addedAt || 0);
const lastPaid = (b) => (b.payments || []).reduce((d, p) => (p.date > d ? p.date : d), '');

function dueBadge(b) {
  const d = parseKey(b.due || todayKey());
  const soon = openOf(b) && b.due >= todayKey() && (d - parseKey(todayKey())) / 86400000 <= 7;
  return `<span class="mf-due ${overdueOf(b) ? 'is-late' : soon ? 'is-soon' : ''}" aria-hidden="true"><b>${d.getDate()}</b><small>${MON[d.getMonth()]}${b.due.slice(0, 4) === todayKey().slice(0, 4) ? '' : ` ${b.due.slice(2, 4)}`}</small></span>`;
}

// Eine Zeile pro Rechnung; value: angezeigter Betrag (im Monat: was dort zählt)
function billRow(b, value = b.amount) {
  const open = openOf(b);
  const paid = paidOf(b);
  const rate = rateLabel(b);
  const late = overdueOf(b);
  const info = [
    open ? payerLabel(b) : `bezahlt ${esc(fmtShort(lastPaid(b) || todayKey()))}`,
    open && paid ? `noch ${money(open)} offen` : '',
    b.repeat ? REPEAT[b.repeat] : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="mf-bill ${open ? '' : 'is-paid'}">
      <button type="button" class="mf-row" data-action="mfBill" data-id="${esc(b.id)}">
        ${dueBadge(b)}
        <span class="list-main">${esc(b.name)}${rate ? ` <span class="mf-tag">${rate}</span>` : ''}${late ? ' <span class="mf-tag is-late">überfällig</span>' : ''}<small>${info}</small></span>
        <span class="list-value">${money(value)}</span>
      </button>
    </li>`;
}

function lastChange() {
  const x = [...state.flow].filter((y) => y.changedAt).sort((a, b) => b.changedAt - a.changedAt)[0];
  if (!x) return '';
  const who = memberById(x.by);
  const d = new Date(x.changedAt);
  const days = Math.round((parseKey(todayKey()) - parseKey(dateKey(d))) / 86400000);
  const when = days <= 0 ? `heute ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : days === 1 ? 'gestern' : fmtShort(dateKey(d));
  return `<p class="mf-who">${who ? avatar(who) : ''}<span>${who ? `${esc(who.name)} hat «${esc(x.name)}» geändert` : `Zuletzt geändert: «${esc(x.name)}»`} · ${esc(when)}</span></p>`;
}

// ---------- Teile ----------

function monthPart() {
  const income = sum(items('income'));
  const fix = sum(items('fix'));
  const bills = items('bill').map((b) => [b, inMonth(b, month)]).filter(([, v]) => v > 0).sort(([a], [b]) => byDue(a, b));
  const billSum = bills.reduce((s, [, v]) => s + v, 0);
  const rest = income - fix - billSum;
  const line = (label, v, sign, sub, go) => `<li><span class="list-main">${label}${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="list-value ${sign > 0 && v ? 'amount-plus' : ''}">${v ? `${sign > 0 ? '+' : '−'} ${money(v)}` : '–'}</span>
    ${go ? `<button type="button" class="icon-btn" data-action="mfTab" data-tab="${go}" aria-label="${label} bearbeiten">${icon('right', 'icon-sm')}</button>` : ''}</li>`;
  const names = (list) => list.slice(0, 3).map((x) => x.name).join(', ') + (list.length > 3 ? ' …' : '');
  return `
    <div class="plan-month">
      <button type="button" class="icon-btn" data-action="mfMonth" data-step="-1" aria-label="Monat zurück">${icon('left')}</button>
      <strong>${esc(monthLabel(month))}</strong>
      <button type="button" class="icon-btn" data-action="mfMonth" data-step="1" aria-label="Monat vor">${icon('right')}</button>
    </div>
    <section class="card plan-hero">
      <small>Bleibt im ${esc(monthName(month))}</small>
      <span class="hero-number ${rest < 0 ? 'amount-minus' : ''}">${money(rest, { sign: true })}</span>
      <small>${money(income)} rein · ${money(fix + billSum)} verplant</small>
    </section>
    <ul class="list plan-lines">
      ${line('Einnahmen', income, 1, names(items('income')), 'einnahmen')}
      ${line('Fixkosten', fix, -1, names(items('fix')), 'fix')}
      ${line(`Rechnungen im ${esc(monthName(month))}`, billSum, -1, bills.length ? `${bills.length} ${bills.length === 1 ? 'Rechnung' : 'Rechnungen'}` : '')}
    </ul>
    ${bills.length ? `<h2 class="section-title">Rechnungen im ${esc(monthName(month))}</h2>
      <ul class="list mf-bills">${bills.map(([b, v]) => billRow(b, v)).join('')}</ul>` : ''}
    <button type="button" class="btn btn-primary btn-block mf-add" data-action="mfBill">${icon('plus', 'icon-sm')} Rechnung erfassen</button>`;
}

function billsPart() {
  const all = items('bill');
  const open = all.filter((b) => openOf(b) > 0).sort(byDue);
  const paid = all.filter((b) => !openOf(b)).sort((a, b) => lastPaid(b).localeCompare(lastPaid(a)));
  const thisMonth = open.reduce((s, b) => s + dueBy(b, curMonth()), 0);
  const late = open.reduce((s, b) => s + overdueOf(b), 0);
  const paidNow = all.flatMap((b) => b.payments || []).filter((p) => p.date.startsWith(curMonth())).reduce((s, p) => s + p.amount, 0);
  const list = filter === 'open' ? open : filter === 'paid' ? paid : [...open, ...paid];
  const next = open.find((b) => b.due >= todayKey());
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="mfBill">${icon('plus', 'icon-sm')} Rechnung erfassen</button>
    ${all.length ? `
      <section class="card plan-hero">
        <small>Offen</small>
        <span class="hero-number">${money(open.reduce((s, b) => s + openOf(b), 0))}</span>
        <small>${open.length} ${open.length === 1 ? 'Rechnung' : 'Rechnungen'}${next ? ` · nächste am ${esc(fmtShort(next.due))}` : ''}</small>
      </section>
      <div class="mf-mini">
        <div><small>Bis Ende ${esc(monthName(curMonth()))}</small><b>${money(thisMonth)}</b></div>
        <div><small>Überfällig</small><b class="${late ? 'amount-minus' : ''}">${money(late)}</b></div>
        <div><small>Bezahlt im ${esc(monthName(curMonth()).slice(0, 3))}.</small><b>${money(paidNow)}</b></div>
      </div>
      <div class="seg mf-filter" role="group" aria-label="Rechnungen zeigen">
        ${FILTERS.map(([id, label]) => `<button type="button" class="seg-btn" data-action="mfFilter" data-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join('')}
      </div>
      ${list.length ? `<ul class="list mf-bills">${list.map((b) => billRow(b)).join('')}</ul>`
        : `<div class="empty"><strong>${filter === 'paid' ? 'Noch nichts bezahlt' : 'Keine offenen Rechnungen'}</strong></div>`}`
      : '<div class="empty"><strong>Noch keine Rechnungen</strong>Kommende Rechnungen mit Fälligkeitsdatum erfassen – ganz, in Raten oder auf Monate verteilt.</div>'}`;
}

function listPart(type) {
  const list = items(type);
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="mfItem" data-type="${type}">${icon('plus', 'icon-sm')} ${type === 'fix' ? 'Fixkosten' : 'Einnahme'} erfassen</button>
    ${list.length ? `
      <h2 class="section-title">${type === 'fix' ? 'Fixkosten' : 'Einnahmen'} <span class="plan-sum">${money(sum(list))} / Monat</span></h2>
      <ul class="list">${[...list].sort((a, b) => b.amount - a.amount).map((x) => `
        <li><button type="button" class="mf-row" data-action="mfItem" data-type="${type}" data-id="${esc(x.id)}">
          ${type === 'income' && memberById(x.memberId) ? avatar(memberById(x.memberId)) : ''}
          <span class="list-main">${esc(x.name)}${type === 'income' && sum(list) ? `<small>${Math.round((x.amount / sum(list)) * 100)} %</small>` : ''}</span>
          <span class="list-value ${type === 'income' ? 'amount-plus' : ''}">${type === 'income' ? '+ ' : ''}${money(x.amount)}</span>
        </button></li>`).join('')}</ul>`
      : `<div class="empty"><strong>Noch keine ${type === 'fix' ? 'Fixkosten' : 'Einnahmen'}</strong>${type === 'fix'
        ? 'Was jeden Monat gemeinsam rausgeht: Miete, Nebenkosten, Strom, Lebensmittel …'
        : 'Was jeden Monat ins Gemeinsame kommt, z. B. die Einzahlung jeder Person.'}</div>`}`;
}

// ---------- Fenster ----------

const amountField = (label, value, name = 'amount', required = true) => `
  <label class="field"><span>${label} (${esc(cur())})</span>
    <input class="input" name="${name}" inputmode="decimal" value="${amountValue(value)}" placeholder="0.00" autocomplete="off" ${required ? 'required' : ''}></label>`;
const radios = (name, options, value, label) => `
  <div class="seg seg-wide" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, text]) => `
    <label class="seg-btn"><input type="radio" name="${name}" value="${esc(v)}" ${v === value ? 'checked' : ''}>${esc(text)}</label>`).join('')}</div>`;

function save(item) {
  update((s) => {
    const i = s.flow.findIndex((x) => x.id === item.id);
    if (i >= 0) s.flow[i] = item;
    else s.flow.push(item);
  });
}

function removeItem(x) {
  const i = state.flow.findIndex((y) => y.id === x.id);
  const settled = (x.payments || []).some((p) => p.expenseId);
  update((s) => { s.flow = s.flow.filter((y) => y.id !== x.id); });
  closeSheet();
  undoRemove(`«${x.name}» gelöscht${settled ? ' – die Abrechnung bleibt' : ''}`, update, (s) => s.flow, [[i, x]]);
}

function editItem(type, x) {
  const income = type === 'income';
  openSheet({
    title: `${income ? 'Einnahme' : 'Fixkosten'} ${x ? 'bearbeiten' : 'erfassen'}`,
    body: `
      <label class="field"><span>Bezeichnung</span>
        <input class="input" name="name" required maxlength="60" value="${esc(x?.name || '')}" placeholder="${income ? 'z. B. Einzahlung Anna' : 'z. B. Miete, Nebenkosten'}" autocomplete="off"></label>
      ${amountField('Betrag pro Monat', x?.amount)}
      ${income && state.members.length ? `<div class="field"><span>Von wem</span>
        ${radios('memberId', [['', 'Niemand bestimmtes'], ...state.members.map((m) => [m.id, m.name])], x?.memberId || '', 'Von wem')}</div>` : ''}`,
    submitLabel: 'Speichern',
    footer: x ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Löschen</button>' : '',
    onSubmit(data) {
      const name = String(data.get('name')).trim().slice(0, 60);
      const amount = parseMoney(data.get('amount'));
      if (!name || !amount) { toast(!name ? 'Bitte eine Bezeichnung eingeben' : 'Bitte einen Betrag eingeben'); return false; }
      const item = { ...(x || {}), id: x?.id || uid(), type, name, amount, ...stamp() };
      if (income) {
        const m = String(data.get('memberId') || '');
        if (m) item.memberId = m;
        else delete item.memberId;
      }
      save(item);
    },
    actions: { remove() { removeItem(x); } },
  });
}

function editBill(b) {
  const when = b?.when || 'whole';
  const payers = [['joint', 'Gemeinsames Konto'], ...state.members.map((m) => [m.id, m.name])];
  const show = (f) => {
    const v = f.querySelector('[name="when"]:checked').value;
    f.querySelector('.mf-rate').hidden = v !== 'rate';
    f.querySelector('.mf-spread').hidden = v !== 'spread';
  };
  openSheet({
    title: b ? 'Rechnung bearbeiten' : 'Rechnung erfassen',
    body: `
      <label class="field"><span>Wofür?</span>
        <input class="input" name="name" required maxlength="60" value="${esc(b?.name || '')}" placeholder="z. B. Serafe, Steuern, Zahnarzt" autocomplete="off"></label>
      <div class="row">
        ${amountField('Betrag', b?.amount)}
        <label class="field"><span>Fällig am</span><input class="input" type="date" name="due" value="${esc(b?.due || todayKey())}" required></label>
      </div>
      <div class="field"><span>Wer bezahlt?</span>${radios('payer', payers, b?.payer || 'joint', 'Wer bezahlt?')}</div>
      <div class="field"><span>Zählt im Monat</span>
        ${radios('when', [['whole', 'Ganz'], ['rate', 'In Raten'], ['spread', 'Verteilen']], when, 'Zählt im Monat')}</div>
      <div class="mf-rate" ${when === 'rate' ? '' : 'hidden'}>${amountField('Rate pro Monat', b?.rate, 'rate', false)}
        <p class="muted small" style="margin:-6px 0 12px">Ab dem Fälligkeitsmonat zählt jeden Monat die Rate, bis der Betrag erreicht ist.</p></div>
      <label class="field mf-spread" ${when === 'spread' ? '' : 'hidden'}><span>Auf wie viele Monate (ab Fälligkeit)</span>
        <input class="input" type="number" name="spread" min="2" max="24" value="${esc(b?.spread || 2)}"></label>
      <div class="field"><span>Wiederholen</span>
        ${radios('repeat', [['', 'Nein'], ['q', 'Vierteljährlich'], ['y', 'Jährlich']], b?.repeat || '', 'Wiederholen')}</div>
      <p class="muted small" style="margin:-4px 0 0">Wiederkehrende Rechnungen: Ist sie ganz bezahlt, wird die nächste automatisch angelegt.</p>`,
    submitLabel: 'Speichern',
    footer: b ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Rechnung löschen</button>' : '',
    onSubmit(data) {
      const name = String(data.get('name')).trim().slice(0, 60);
      const amount = parseMoney(data.get('amount'));
      const mode = String(data.get('when') || 'whole');
      const rate = mode === 'rate' ? parseMoney(data.get('rate')) : null;
      const spread = mode === 'spread' ? Number(data.get('spread')) : null;
      if (!name || !amount) { toast(!name ? 'Bitte eine Bezeichnung eingeben' : 'Bitte einen Betrag eingeben'); return false; }
      if (mode === 'rate' && !rate) { toast('Bitte die Rate pro Monat eingeben'); return false; }
      if (mode === 'spread' && !(Number.isInteger(spread) && spread >= 2 && spread <= 24)) { toast('Anzahl Monate: 2 bis 24'); return false; }
      const bill = {
        ...(b || { payments: [], addedAt: Date.now() }),
        id: b?.id || uid(), type: 'bill', name, amount, due: String(data.get('due') || todayKey()),
        payer: String(data.get('payer') || 'joint'), when: mode, ...stamp(),
      };
      for (const [k, v] of [['rate', rate], ['spread', spread], ['repeat', String(data.get('repeat') || '')]]) {
        if (v) bill[k] = v;
        else delete bill[k];
      }
      if (paidOf(bill) >= bill.amount) bill.doneAt ||= Date.now();
      else delete bill.doneAt;
      save(bill);
      if (!b) {
        // Neue Rechnung: dorthin, wo man sie sieht
        filter = 'open';
      }
    },
    actions: {
      remove() { removeItem(b); },
      change(el, f) { if (el.name === 'when') show(f); },
    },
  });
}

// Wiederkehrende Rechnung ganz bezahlt: die nächste anlegen (einmal)
function nextOf(s, b) {
  if (!b.repeat || b.nextId || paidOf(b) < b.amount) return null;
  const step = b.repeat === 'q' ? 3 : 12;
  const [y, m, d] = b.due.split('-').map(Number);
  const target = new Date(y, m - 1 + step, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const due = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  const next = { ...b, id: uid(), due, payments: [], addedAt: Date.now(), ...stamp() };
  delete next.doneAt;
  delete next.nextId;
  s.flow.push(next);
  return next;
}

function addPayment(b, amount, date, toSettle) {
  let next = null;
  update((s) => {
    const bill = s.flow.find((x) => x.id === b.id);
    if (!bill) return;
    const pay = { id: uid(), date, amount };
    if (toSettle && memberById(bill.payer)) {
      const cat = (s.settings.categories || []).includes('Wohnen') ? 'Wohnen' : (s.settings.categories || []).at(-1) || '';
      const e = { id: uid(), kind: 'expense', title: bill.name, note: 'Aus Moneyflow', amount, payerId: bill.payer, splitIds: s.members.map((m) => m.id), category: cat, date, createdAt: Date.now() };
      s.expenses.push(e);
      pay.expenseId = e.id;
    }
    bill.payments = [...(bill.payments || []), pay];
    Object.assign(bill, stamp());
    if (paidOf(bill) >= bill.amount) {
      bill.doneAt ||= Date.now();
      next = nextOf(s, bill);
      if (next) bill.nextId = next.id;
    }
  });
  if (next) toast(`Nächste «${next.name}» am ${fmtShort(next.due)} angelegt`);
  else if (toSettle && memberById(b.payer)) toast('Bezahlt · in der Abrechnung eingetragen');
}

function removePayment(billId, payId) {
  update((s) => {
    const bill = s.flow.find((x) => x.id === billId);
    if (!bill) return;
    const pay = (bill.payments || []).find((p) => p.id === payId);
    bill.payments = (bill.payments || []).filter((p) => p.id !== payId);
    if (pay?.expenseId) s.expenses = s.expenses.filter((e) => e.id !== pay.expenseId);
    if (paidOf(bill) < bill.amount) delete bill.doneAt;
    Object.assign(bill, stamp());
  });
}

// Antippen einer Rechnung: Zahlung erfassen (ganz oder teilweise), Zahlungen ansehen, bearbeiten
function billSheet(b) {
  const open = openOf(b);
  const person = memberById(b.payer);
  // Vorschlag: die nächste noch offene Rate (bzw. der ganze offene Betrag)
  let upTo = 0;
  const step = Object.values(scheduleOf(b)).map((v) => (upTo += v)).find((t) => t > paidOf(b));
  const suggest = Math.min(open, step ? step - paidOf(b) : open);
  const settleLabel = person && state.members.length > 1 ? `In die Abrechnung übernehmen (${esc(person.name)} hat bezahlt, geteilt durch ${state.members.length})` : '';
  openSheet({
    title: b.name,
    body: `
      <p class="mf-sheet-info"><b>${money(b.amount)}</b> · fällig ${esc(fmtShort(b.due))} · ${esc(payerLabel(b))}${b.repeat ? ` · ${REPEAT[b.repeat]}` : ''}
        ${open < b.amount ? `<br><span class="muted">${money(paidOf(b))} bezahlt${open ? ` · <b>${money(open)} offen</b>` : ''}</span>` : ''}</p>
      ${open ? `
        <div class="row">
          ${amountField('Bezahlt', suggest)}
          <label class="field"><span>Am</span><input class="input" type="date" name="date" value="${todayKey()}" required></label>
        </div>
        ${settleLabel ? `<label class="check-field"><input type="checkbox" name="settle" checked> ${settleLabel}</label>` : ''}` : '<p class="muted">Ganz bezahlt.</p>'}
      ${(b.payments || []).length ? `<h3 class="mf-sheet-sub">Zahlungen</h3>
        <ul class="list mf-payments">${b.payments.map((p) => `<li><span class="list-main">${esc(fmtShort(p.date))}${p.expenseId ? '<small>auch in der Abrechnung</small>' : ''}</span>
          <span class="list-value">${money(p.amount)}</span>
          <button type="button" class="icon-btn" data-sheet-action="unpay" data-id="${esc(p.id)}" aria-label="Zahlung vom ${esc(fmtShort(p.date))} entfernen">${icon('x', 'icon-sm')}</button></li>`).join('')}</ul>` : ''}`,
    submitLabel: open ? 'Zahlung erfassen' : '',
    footer: `<button type="button" class="btn btn-block" data-sheet-action="edit">Bearbeiten</button>`,
    onSubmit(data, f) {
      const amount = parseMoney(data.get('amount'));
      if (!amount) { toast('Bitte einen Betrag eingeben'); return false; }
      const rect = f.querySelector('[type="submit"]')?.getBoundingClientRect();
      closeSheet(); // zuerst schliessen: Meldungen landen sonst im Fenster und verschwinden mit ihm
      addPayment(b, Math.min(amount, open), String(data.get('date') || todayKey()), data.get('settle') === 'on');
      if (amount >= open && rect) celebrate(rect);
    },
    actions: {
      edit() { editBill(b); },
      unpay(btn) {
        const p = b.payments.find((x) => x.id === btn.dataset.id);
        if (!p || !confirm(`Zahlung vom ${fmtShort(p.date)} entfernen?${p.expenseId ? ' Der Eintrag in der Abrechnung wird auch entfernt.' : ''}`)) return;
        removePayment(b.id, p.id);
        closeSheet();
      },
    },
  });
}

// ---------- Ansicht ----------

const PARTS = { monat: monthPart, rechnungen: billsPart, fix: () => listPart('fix'), einnahmen: () => listPart('income') };

export default {
  id: 'moneyflow',
  title: 'Moneyflow',

  render() {
    return `
      <div class="plan-top">
        <span class="muted small">${icon('users', 'icon-xs')} Gemeinsam – alle sehen und bearbeiten es</span>
      </div>
      <div class="seg seg-wide seg-parts plan-tabs" role="group" aria-label="Moneyflow">
        ${TABS.map(([id, label]) => `<button type="button" class="seg-btn" data-action="mfTab" data-tab="${id}" aria-pressed="${id === tab}">${label}</button>`).join('')}
      </div>
      ${PARTS[tab]()}
      ${lastChange()}`;
  },

  actions: {
    mfTab(el) {
      tab = el.dataset.tab;
      try { localStorage.setItem(TAB_KEY, tab); } catch { /* privates Fenster */ }
      refresh();
      window.scrollTo(0, 0);
    },
    mfMonth(el) { month = addMonths(month, Number(el.dataset.step)); refresh(); },
    mfFilter(el) { filter = el.dataset.filter; refresh(); },
    mfBill(el) {
      const b = state.flow.find((x) => x.id === el.dataset.id && x.type === 'bill');
      if (b) billSheet(b);
      else editBill(null);
    },
    mfItem(el) { editItem(el.dataset.type, state.flow.find((x) => x.id === el.dataset.id)); },
  },
};
