// Geld → Planung: persönliche Finanzplanung, nur auf diesem Gerät (Daten und Rechnen in js/planung.js).
//  - Monat: Einnahmen minus Fixkosten, Abos, für den Monat aktivierte nicht monatliche Kosten und Rechnungen
//    (was im Monat anfällt, mit Ratenplan nur die Rate – js/planung.js billInMonth). Ohne Multiplizieren;
//    „Bis Ende Jahr“ nur auf Wunsch (Fenster). Nicht monatliche Posten zählen im Monat ganz (Kästchen) oder mit
//    einem Teilbetrag („Teil“, auch über mehrere Monate verteilt); angezeigt wird, wie viel im Jahr/Halbjahr/Quartal
//    schon eingeplant ist.
//  - Kosten (fix / wiederkehrend), Rechnungen (Teilzahlungen, Ratenplan, Stand an einem Datum), Abos, Einnahmen.
// Beträge sind verdeckt, bis man sie zeigt – wieder verdeckt beim Verlassen und wenn die App in den Hintergrund geht.

import { refresh, state, uid } from '../store.js';
import { closeSheet, esc, icon, money, openSheet, parseMoney, toast } from '../ui.js';
import { fmtMonthYear, fmtShort, parseKey, todayKey } from '../dates.js';
import { saveFile } from '../backup.js';
import { celebrate } from '../celebrate.js';
import {
  BACKUP_DAYS, addMonths, addPayment, backupDue, backupText, curMonth, hasBackupPassword, isPlanFile, markBackedUp,
  amountIn, monthSums, monthsBetween, notMonthly, openOf, paidOf, partOf, periodMonths, periodOf, plan, plannedInPeriod,
  rateInfo, readBackup, rememberPayee, removePayment, restorePlan, setBackupPassword, setPartFrom, toggleActive, untilSums,
  updatePlan,
} from '../planung.js';

const TABS = [['monat', 'Monat'], ['kosten', 'Kosten'], ['rechnungen', 'Rechnungen'], ['abos', 'Abos'], ['einnahmen', 'Einnahmen']];
const TAB_KEY = 'haushalt.planung.tab';
const RHYTHM = { q: 'alle 3 Monate', h: 'halbjährlich', y: 'jährlich' };

let tab = (() => { try { const v = localStorage.getItem(TAB_KEY); return TABS.some(([id]) => id === v) ? v : 'monat'; } catch { return 'monat'; } })();
let month = curMonth();
let asOf = ''; // Rechnungen: Stand an diesem Datum ('' = heute)
let shown = false;
window.addEventListener('hashchange', () => { shown = false; month = curMonth(); asOf = ''; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && shown) {
    shown = false;
    refresh();
  }
});

const cur = () => state.settings.currency || 'CHF';
const m = (cents, opts) => (shown ? money(cents, opts) : `${cur()} *****`);
const monthLabel = (key) => fmtMonthYear(parseKey(`${key}-01`));
const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
const amountValue = (cents) => (cents ? (cents / 100).toFixed(2) : '');

// ---------- Teile ----------

function monthPart() {
  const s = monthSums(month);
  const rest = s.income - s.fix - s.abos - s.active - s.bills;
  const items = notMonthly();
  const line = (label, v, sign) => `<li><span class="list-main">${label}</span><span class="list-value ${sign > 0 ? 'amount-plus' : ''}">${v ? `${sign > 0 ? '+' : '−'} ${m(v)}` : '–'}</span></li>`;
  return `
    <div class="plan-month">
      <button type="button" class="icon-btn" data-action="plMonth" data-step="-1" aria-label="Monat zurück">${icon('left')}</button>
      <strong>${esc(monthLabel(month))}</strong>
      <button type="button" class="icon-btn" data-action="plMonth" data-step="1" aria-label="Monat vor">${icon('right')}</button>
    </div>
    <section class="card plan-hero">
      <small>Bleibt im ${esc(monthLabel(month).split(' ')[0])}</small>
      <div class="hero-number ${shown && rest < 0 ? 'amount-minus' : ''}">${m(rest, { sign: true })}</div>
    </section>
    <ul class="list plan-lines">
      ${line('Einnahmen', s.income, 1)}
      ${line('Fixkosten', s.fix, -1)}
      ${line('Abos (monatlich)', s.abos, -1)}
      ${items.length ? line('Aktiviert in diesem Monat', s.active, -1) : ''}
      ${line('Rechnungen in diesem Monat', s.bills, -1)}
    </ul>
    ${items.length ? `
      <h2 class="section-title">Nicht monatlich – für ${esc(monthLabel(month).split(' ')[0])} aktivieren</h2>
      <ul class="list plan-nm">${items.map((x) => {
        const here = amountIn(month, x);
        const part = partOf(month, x.id);
        const planned = plannedInPeriod(month, x);
        const [from, to] = periodOf(month, x.rhythm);
        const period = x.rhythm === 'y' ? from.slice(0, 4) : `${monthLabel(from).split(' ')[0].slice(0, 3)}–${monthLabel(to).split(' ')[0].slice(0, 3)}`;
        return `
        <li class="${here ? '' : 'is-off'}">
          <button type="button" class="check ${here ? 'is-on' : ''}" data-action="plActive" data-id="${esc(x.id)}" aria-pressed="${Boolean(here)}" aria-label="${esc(x.name)} ${here ? 'nicht mehr' : 'ganz'} in diesem Monat zählen">${icon('check', 'icon-sm')}</button>
          <span class="list-main">${esc(x.name)}<small>${x.src === 'abo' ? 'Abo · ' : ''}${esc(RHYTHM[x.rhythm] || '')} · ${esc(period)}: <span class="${shown && planned > x.amount ? 'amount-minus' : ''}">${m(planned)}</span> von ${m(x.amount)}${shown && planned > x.amount ? ' – mehr als nötig' : ''}</small></span>
          <span class="list-value">${part ? `<small class="plan-part">Teil</small>${m(part)}` : m(x.amount)}</span>
          <button type="button" class="btn btn-sm plan-part-btn" data-action="plPart" data-id="${esc(x.id)}" aria-label="Teilbetrag für ${esc(x.name)}">Teil</button>
        </li>`;
      }).join('')}</ul>
      <p class="muted small" style="margin:6px 2px 0">Kästchen = ganzer Betrag in diesem Monat · „Teil“ = nur ein Teil, auch über mehrere Monate verteilt.</p>` : ''}
    <button type="button" class="btn btn-block" data-action="plUntil" style="margin-top:14px">${icon('calendar', 'icon-sm')} Bis Ende Jahr berechnen …</button>`;
}

const row = (action, x, sub, value = m(x.amount)) => `
  <li><button type="button" class="list-main plan-row" data-action="${action}" data-id="${esc(x.id)}">${esc(x.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>
    <span class="list-value">${value}</span></li>`;

function costsPart() {
  const fix = plan().costs.filter((c) => c.kind === 'fix');
  const rep = plan().costs.filter((c) => c.kind === 'repeat');
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="plCost">${icon('plus', 'icon-sm')} Kosten erfassen</button>
    ${fix.length || rep.length ? '' : '<div class="empty"><strong>Noch keine Kosten</strong>Fixkosten (z. B. Miete) und wiederkehrende Kosten (z. B. Krankenkasse alle 3 Monate) einmal erfassen.</div>'}
    ${fix.length ? `<h2 class="section-title">Fixkosten <span class="plan-sum">${m(sum(fix))} / Monat</span></h2>
      <ul class="list">${fix.map((c) => row('plCost', c, '')).join('')}</ul>` : ''}
    ${rep.length ? `<h2 class="section-title">Wiederkehrend <span class="plan-sum">im Monat aktivieren</span></h2>
      <ul class="list">${rep.map((c) => row('plCost', c, RHYTHM[c.rhythm])).join('')}</ul>` : ''}`;
}

function abosPart() {
  const abos = plan().abos;
  const monthly = sum(abos.filter((a) => a.rhythm !== 'y'));
  const yearly = sum(abos.filter((a) => a.rhythm === 'y'));
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="plAbo">${icon('plus', 'icon-sm')} Abo erfassen</button>
    ${abos.length ? `
      <section class="card plan-hero">
        <small>${abos.length} ${abos.length === 1 ? 'Abo' : 'Abos'} · aufs Jahr gerechnet</small>
        <div class="hero-number">${m(monthly * 12 + yearly)}</div>
        <small>${m(monthly)} pro Monat${yearly ? ` · ${m(yearly)} jährliche` : ''}</small>
      </section>
      <ul class="list">${[...abos].sort((a, b) => b.amount - a.amount).map((a) => row('plAbo', a, a.rhythm === 'y' ? 'jährlich – im Monat aktivieren' : 'monatlich')).join('')}</ul>`
      : '<div class="empty"><strong>Noch keine Abos</strong>Streaming, Zeitung, Handy, Fitness … – für den Überblick, was alles läuft.</div>'}`;
}

function incomesPart() {
  const list = plan().incomes;
  const monthly = list.filter((i) => i.kind === 'm');
  const once = list.filter((i) => i.kind === 'once').sort((a, b) => (b.month || '').localeCompare(a.month || ''));
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="plIncome">${icon('plus', 'icon-sm')} Einnahme erfassen</button>
    ${list.length ? '' : '<div class="empty"><strong>Noch keine Einnahmen</strong>Lohn monatlich, dazu Einmaliges wie 13. Monatslohn, Bonus oder Rückerstattungen.</div>'}
    ${monthly.length ? `<h2 class="section-title">Monatlich <span class="plan-sum">${m(sum(monthly))} / Monat</span></h2>
      <ul class="list">${monthly.map((i) => row('plIncome', i, '')).join('')}</ul>` : ''}
    ${once.length ? `<h2 class="section-title">Einmalig</h2>
      <ul class="list">${once.map((i) => row('plIncome', i, i.month ? monthLabel(i.month) : '')).join('')}</ul>` : ''}`;
}

// until: Stand an diesem Datum ('' = heute, alle Zahlungen)
function billCard(b, until) {
  const paid = paidOf(b, until || undefined);
  const open = Math.max(0, b.amount - paid);
  const info = !until && rateInfo(b);
  const pct = Math.min(100, Math.round((paid / b.amount) * 100));
  return `
    <li class="plan-bill ${open ? '' : 'is-paid'}">
      <button type="button" class="plan-bill-head" data-action="plBill" data-id="${esc(b.id)}" aria-label="${esc(b.name)} bearbeiten">
        <strong>${esc(b.name)}</strong><span>${m(b.amount)}</span>
      </button>
      <div class="mode-bar plan-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small class="plan-bill-info">${open ? `${m(paid)} bezahlt · <b>${m(open)} offen</b>` : 'ganz bezahlt'}${info ? ` · Rate ${m(b.rate)} · ${info.left ? `noch ${info.left} ${info.left === 1 ? 'Rate' : 'Raten'}, fertig ${esc(monthLabel(info.end))}` : ''}` : ''}</small>
      ${(b.payments || []).length ? `<details class="plan-payments"><summary>${b.payments.length} ${b.payments.length === 1 ? 'Zahlung' : 'Zahlungen'}</summary>
        <ul>${b.payments.map((p) => `<li><span>${esc(fmtShort(p.date))}</span><span>${m(p.amount)}</span>
          <button type="button" class="icon-btn" data-action="plUnpay" data-bill="${esc(b.id)}" data-id="${esc(p.id)}" aria-label="Zahlung vom ${esc(fmtShort(p.date))} entfernen">${icon('x', 'icon-sm')}</button></li>`).join('')}</ul>
      </details>` : ''}
      ${open && !until ? `<div class="row plan-bill-actions">
        <button type="button" class="btn btn-sm" data-action="plPay" data-id="${esc(b.id)}">${icon('plus', 'icon-sm')} Teilzahlung</button>
        <button type="button" class="btn btn-sm" data-action="plPayAll" data-id="${esc(b.id)}">${icon('check', 'icon-sm')} Ganz bezahlt</button>
      </div>` : ''}
    </li>`;
}

function billsPart() {
  const until = asOf && asOf !== todayKey() ? asOf : '';
  const all = plan().bills;
  const open = all.filter((b) => openOf(b, until || undefined) > 0);
  const paid = all.filter((b) => !open.includes(b));
  return `
    <button type="button" class="btn btn-primary btn-block" data-action="plBill">${icon('plus', 'icon-sm')} Rechnung erfassen</button>
    ${all.length ? `
      <section class="card plan-hero">
        <label class="plan-asof"><small>Offen am</small>
          <input class="input" type="date" data-change="plAsOf" value="${esc(asOf || todayKey())}" aria-label="Stand an diesem Datum"></label>
        <div class="hero-number">${m(open.reduce((s, b) => s + openOf(b, until || undefined), 0))}</div>
        <small>${open.length} ${open.length === 1 ? 'Rechnung' : 'Rechnungen'} offen${until ? ' – Stand an diesem Tag' : ''}</small>
      </section>
      <ul class="list plan-bills">${open.map((b) => billCard(b, until)).join('')}</ul>
      ${paid.length ? `<details class="plan-paid"><summary>Bezahlt (${paid.length})${until ? '' : ' – nach 30 Tagen weg'}</summary>
        <ul class="list plan-bills">${paid.map((b) => billCard(b, until)).join('')}</ul></details>` : ''}`
      : '<div class="empty"><strong>Noch keine Rechnungen</strong>Rechnung mit Betrag erfassen; Teilzahlungen und Ratenplan sind möglich.</div>'}`;
}

// ---------- Fenster ----------

const amountField = (label, x, name = 'amount') => `
  <label class="field"><span>${label} (${esc(cur())})</span>
    <input class="input" name="${name}" inputmode="decimal" value="${amountValue(x?.[name])}" placeholder="0.00" autocomplete="off" ${name === 'amount' ? 'required' : ''}></label>`;
const nameField = (x, placeholder, extra = '') => `
  <label class="field"><span>Bezeichnung</span>
    <input class="input" name="name" required maxlength="60" value="${esc(x?.name || '')}" placeholder="${placeholder}" autocomplete="off" ${extra}></label>`;
const radios = (name, options, value) => `
  <div class="seg seg-wide" role="radiogroup">${options.map(([v, label]) => `
    <label class="seg-btn"><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}>${label}</label>`).join('')}</div>`;
const removeBtn = (x, what) => (x ? `<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">${what} löschen</button>` : '');

// Gemeinsames Fenster für Kosten, Abos und Einnahmen
function editItem(listKey, x, { title, what, placeholder, kinds, kindName, extra = () => '', read }) {
  openSheet({
    title: x ? `${what} bearbeiten` : title,
    body: `${nameField(x, placeholder)}${amountField('Betrag', x)}${radios(kindName, kinds, x?.[kindName] || kinds[0][0])}${extra(x)}`,
    submitLabel: 'Speichern',
    footer: removeBtn(x, what),
    onSubmit(data) {
      const amount = parseMoney(data.get('amount'));
      const name = String(data.get('name')).trim().slice(0, 60);
      if (!name || !amount) {
        toast(!name ? 'Bitte eine Bezeichnung eingeben' : 'Bitte einen Betrag eingeben');
        return false;
      }
      const item = { id: x?.id || uid(), name, amount, [kindName]: String(data.get(kindName)), ...read(data) };
      updatePlan((d) => {
        const i = d[listKey].findIndex((y) => y.id === item.id);
        if (i >= 0) d[listKey][i] = item;
        else d[listKey].push(item);
      });
    },
    actions: {
      remove() {
        if (!confirm(`„${x.name}“ löschen?`)) return;
        updatePlan((d) => { d[listKey] = d[listKey].filter((y) => y.id !== x.id); });
        closeSheet();
      },
      change(el, f) {
        const box = f.querySelector('.plan-extra');
        if (box && el.name === kindName) box.hidden = !box.dataset.for.split(' ').includes(el.value);
      },
    },
  });
}

const editCost = (x) => editItem('costs', x, {
  title: 'Kosten erfassen', what: 'Kosten', placeholder: 'z. B. Miete, Krankenkasse', kindName: 'kind',
  kinds: [['fix', 'Fix (monatlich)'], ['repeat', 'Wiederkehrend']],
  extra: (c) => `<div class="plan-extra field" data-for="repeat" ${c?.kind === 'repeat' ? '' : 'hidden'}><span>Wie oft</span>
    ${radios('rhythm', [['q', 'alle 3 Mt.'], ['h', 'halbjährlich'], ['y', 'jährlich']], c?.rhythm || 'y')}
    <p class="muted small" style="margin:-6px 0 0">Zählt nur in den Monaten, in denen du sie unter „Monat“ aktivierst.</p></div>`,
  read: (data) => (data.get('kind') === 'repeat' ? { rhythm: String(data.get('rhythm') || 'y') } : {}),
});

const editAbo = (x) => editItem('abos', x, {
  title: 'Abo erfassen', what: 'Abo', placeholder: 'z. B. Netflix, Zeitung', kindName: 'rhythm',
  kinds: [['m', 'Monatlich'], ['y', 'Jährlich']],
  extra: () => '<p class="muted small" style="margin:-6px 0 0">Jährliche Abos zählen nur in dem Monat, in dem du sie unter „Monat“ aktivierst.</p>',
  read: () => ({}),
});

const monthOptions = (selected) => [...new Set([...Array.from({ length: 25 }, (_, i) => addMonths(curMonth(), i - 6)), selected])].sort()
  .map((k) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(monthLabel(k))}</option>`).join('');

const editIncome = (x) => editItem('incomes', x, {
  title: 'Einnahme erfassen', what: 'Einnahme', placeholder: 'z. B. Lohn, 13. Monatslohn', kindName: 'kind',
  kinds: [['m', 'Monatlich'], ['once', 'Einmalig']],
  extra: (i) => `<label class="plan-extra field" data-for="once" ${i?.kind === 'once' ? '' : 'hidden'}><span>Im Monat</span>
    <select class="select" name="month">${monthOptions(i?.month || month)}</select></label>`,
  read: (data) => (data.get('kind') === 'once' ? { month: String(data.get('month') || month) } : {}),
});

function editBill(b) {
  const payees = plan().payees;
  openSheet({
    title: b ? 'Rechnung bearbeiten' : 'Rechnung erfassen',
    body: `
      ${nameField(b, 'z. B. Steuern 2025, Zahnarzt', 'list="plan-payees"')}
      <datalist id="plan-payees">${payees.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      ${amountField('Betrag', b)}
      <label class="check-field"><input type="checkbox" name="hasRate" ${b?.rate ? 'checked' : ''}> Ratenplan (monatlich einen Teil zahlen)</label>
      <div class="plan-rate" ${b?.rate ? '' : 'hidden'}>${amountField('Rate pro Monat', b, 'rate')}
        <p class="muted small" style="margin:-6px 0 12px">Im Monat zählt dann nur die Rate, nicht der ganze offene Betrag.</p></div>
      ${b?.payments?.length ? `<p class="muted small">${b.payments.length} ${b.payments.length === 1 ? 'Zahlung' : 'Zahlungen'} erfasst · ${m(paidOf(b))} bezahlt</p>` : ''}`,
    submitLabel: 'Speichern',
    footer: removeBtn(b, 'Rechnung'),
    onSubmit(data) {
      const name = String(data.get('name')).trim().slice(0, 60);
      const amount = parseMoney(data.get('amount'));
      const rate = data.get('hasRate') ? parseMoney(data.get('rate')) : null;
      if (!name || !amount) {
        toast(!name ? 'Bitte eine Bezeichnung eingeben' : 'Bitte einen Betrag eingeben');
        return false;
      }
      if (data.get('hasRate') && !rate) {
        toast('Bitte die Rate pro Monat eingeben');
        return false;
      }
      updatePlan((d) => {
        const bill = d.bills.find((x) => x.id === b?.id);
        if (bill) {
          Object.assign(bill, { name, amount });
          if (rate) bill.rate = rate;
          else delete bill.rate;
          if (paidOf(bill) >= bill.amount) bill.doneAt ||= Date.now();
          else delete bill.doneAt;
        } else d.bills.push({ id: uid(), name, amount, ...(rate ? { rate } : {}), payments: [], addedAt: Date.now() });
        rememberPayee(d, name, amount);
      });
    },
    actions: {
      remove() {
        if (!confirm(`Rechnung „${b.name}“ löschen?`)) return;
        updatePlan((d) => { d.bills = d.bills.filter((x) => x.id !== b.id); });
        closeSheet();
      },
      change(el, f) {
        if (el.name === 'hasRate') f.querySelector('.plan-rate').hidden = !el.checked;
        // Gemerkter Rechnungssteller: letzten Betrag übernehmen, solange noch keiner eingetippt ist
        if (el.name === 'name' && !f.elements.amount.value) {
          const p = payees.find((x) => x.name.toLowerCase() === el.value.trim().toLowerCase());
          if (p) f.elements.amount.value = amountValue(p.amount);
        }
      },
    },
  });
}

function payBill(b) {
  const open = openOf(b);
  const last = (b.payments || []).at(-1)?.amount;
  const suggest = Math.min(open, b.rate || last || open);
  openSheet({
    title: `Teilzahlung · ${b.name}`,
    body: `
      <p class="muted small" style="margin-top:0">Offen: ${m(open)}</p>
      <div class="row">
        <label class="field"><span>Betrag (${esc(cur())})</span><input class="input" name="amount" inputmode="decimal" value="${amountValue(suggest)}" required autocomplete="off"></label>
        <label class="field"><span>Bezahlt am</span><input class="input" type="date" name="date" value="${todayKey()}" required></label>
      </div>`,
    submitLabel: 'Zahlung erfassen',
    onSubmit(data) {
      const amount = parseMoney(data.get('amount'));
      if (!amount) {
        toast('Bitte einen Betrag eingeben');
        return false;
      }
      addPayment(b.id, Math.min(amount, open), String(data.get('date') || todayKey()));
      if (amount >= open) toast(`${b.name}: ganz bezahlt`);
    },
  });
}

// Teilbetrag eines nicht monatlichen Postens: in diesem und auf Wunsch den folgenden Monaten
function partSheet(x) {
  const len = periodMonths(x.rhythm);
  const [, to] = periodOf(month, x.rhythm);
  const restMonths = monthsBetween(month, to) + 1; // bis Ende Jahr/Halbjahr/Quartal
  const existing = partOf(month, x.id);
  // Was in den gewählten Monaten noch fehlt, gleichmässig verteilt (auf 5 Rappen aufgerundet)
  const spread = (count) => {
    let outside = plannedInPeriod(month, x);
    for (let i = 0; i < count; i += 1) {
      const mm = addMonths(month, i);
      if (mm <= to) outside -= amountIn(mm, x);
    }
    return Math.max(0, Math.ceil(Math.max(0, x.amount - outside) / count / 5) * 5);
  };
  const form = openSheet({
    title: `Teilbetrag · ${x.name}`,
    body: `
      <p class="muted small" style="margin-top:0">${esc(RHYTHM[x.rhythm] || '')} ${m(x.amount)} · im Zeitraum eingeplant: ${m(plannedInPeriod(month, x))}</p>
      <div class="row">
        <label class="field"><span>Betrag pro Monat (${esc(cur())})</span>
          <input class="input" name="amount" inputmode="decimal" value="${amountValue(existing || spread(restMonths))}" required autocomplete="off"></label>
        <label class="field" style="flex:0 0 44%"><span>Monate ab ${esc(monthLabel(month).split(' ')[0])}</span>
          <select class="select" name="count">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === (existing ? 1 : restMonths) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-sheet-action="spread">Rest gleichmässig verteilen</button>
      <p class="muted small plan-part-hint" style="margin:8px 0 0"></p>`,
    submitLabel: 'Übernehmen',
    footer: existing ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="clear">Teilbetrag in diesem Monat entfernen</button>' : '',
    onSubmit(data) {
      const cents = parseMoney(data.get('amount'));
      if (!cents) {
        toast('Bitte einen Betrag eingeben');
        return false;
      }
      setPartFrom(month, x.id, cents, Number(data.get('count')) || 1);
    },
    actions: {
      spread(btn, f) {
        f.elements.amount.value = amountValue(spread(Number(f.elements.count.value) || 1));
        hint(f);
      },
      clear() {
        setPartFrom(month, x.id, 0, 1);
        closeSheet();
      },
      change(el, f) { hint(f); },
    },
  });
  // Hinweis: wie viele Monate, bis wann, und Summe
  function hint(f) {
    const count = Number(f.elements.count.value) || 1;
    const cents = parseMoney(f.elements.amount.value) || 0;
    f.querySelector('.plan-part-hint').textContent = `${count} × ${shown ? money(cents) : `${cur()} *****`} = ${shown ? money(cents * count) : `${cur()} *****`}`
      + ` (${monthLabel(month)}${count > 1 ? ` bis ${monthLabel(addMonths(month, count - 1))}` : ''})${len && count > restMonths ? ' – geht über den Zeitraum hinaus' : ''}`;
  }
  form.elements.amount.addEventListener('input', () => hint(form));
  hint(form);
}

function untilSheet() {
  const year = curMonth().slice(0, 4);
  let end = `${year}-12`;
  if (end < curMonth()) end = curMonth();
  const parts = [['income', 'Einnahmen', 1], ['fix', 'Fixkosten', -1], ['abos', 'Abos (monatlich)', -1], ['active', 'Nicht monatliche (aktiviert/Teile)', -1], ['bills', 'Rechnungen (offen bzw. Raten)', -1]];
  const result = (f) => {
    const s = untilSums(f.elements.end.value);
    const on = (k) => f.elements[`p_${k}`]?.checked;
    const total = parts.reduce((t, [k, , sign]) => t + (on(k) ? sign * s[k] : 0), 0);
    const out = parts.filter(([k]) => on(k)).reduce((t, [k, , sign]) => t + (sign < 0 ? s[k] : 0), 0);
    f.querySelector('.plan-until-result').innerHTML = `
      <small>${s.months} ${s.months === 1 ? 'Monat' : 'Monate'} (${esc(monthLabel(curMonth()))} bis ${esc(monthLabel(f.elements.end.value))})</small>
      <div class="plan-until-out">Noch zu zahlen <b>${m(out)}</b></div>
      ${on('income') ? `<div class="hero-number ${shown && total < 0 ? 'amount-minus' : ''}">${m(total, { sign: true })}</div><small>bleibt</small>` : ''}`;
    for (const [k] of parts) f.querySelector(`[data-part="${k}"]`).textContent = m(s[k]);
  };
  const form = openSheet({
    title: 'Bis Ende Jahr',
    body: `
      <label class="field"><span>Bis und mit</span>
        <select class="select" name="end">${Array.from({ length: 24 }, (_, i) => addMonths(curMonth(), i)).map((k) => `<option value="${k}" ${k === end ? 'selected' : ''}>${esc(monthLabel(k))}</option>`).join('')}</select></label>
      <p class="muted small" style="margin:-4px 0 10px">Monatliches × Anzahl Monate, dazu was in diesen Monaten aktiviert ist und die offenen Rechnungen (mit Ratenplan nur die Raten bis dahin).</p>
      <ul class="list plan-until">${parts.map(([k, label]) => `
        <li><label class="check-field" style="margin:0;flex:1"><input type="checkbox" name="p_${k}" checked> ${label}</label><span class="list-value" data-part="${k}"></span></li>`).join('')}</ul>
      <section class="card plan-hero plan-until-result"></section>`,
    actions: { change(el, f) { result(f); } },
  });
  result(form);
}

// Passwort festlegen (zweimal), dann gleich sichern
function backupPasswordSheet() {
  openSheet({
    title: 'Passwort für die Sicherung',
    body: `
      <p class="small" style="margin-top:0">Die Sicherungsdatei wird mit diesem Passwort verschlüsselt. Ohne Passwort lässt sie sich nicht öffnen – auch nicht in iCloud. Gut aufbewahren!</p>
      <p class="muted small">Auf diesem Gerät musst du es danach nicht mehr eingeben: neue Sicherungen brauchen nur ein Antippen.</p>
      <label class="field"><span>Passwort (mind. 8 Zeichen)</span><input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
      <label class="field"><span>Nochmals</span><input class="input" type="password" name="pw2" required autocomplete="new-password"></label>`,
    submitLabel: 'Festlegen und sichern',
    onSubmit(data) {
      const pw = String(data.get('pw'));
      if (pw.length < 8) { toast('Mindestens 8 Zeichen'); return false; }
      if (pw !== data.get('pw2')) { toast('Die Passwörter stimmen nicht überein'); return false; }
      setBackupPassword(pw).then(() => { closeSheet(); doBackup(); });
      return false;
    },
  });
}

async function doBackup() {
  if (!hasBackupPassword()) return backupPasswordSheet();
  try {
    const ok = await saveFile(await backupText(), `haushalt-planung-${todayKey()}.json`);
    if (ok) {
      markBackedUp();
      toast('Sicherung erstellt');
    }
  } catch (err) {
    toast(err.message);
  }
}

function backupSheet() {
  const at = plan().backup.at;
  openSheet({
    title: 'Sicherung der Planung',
    body: `
      <p class="small" style="margin-top:0">Die Planung liegt nur auf diesem Gerät – nicht in der Datenbank, nicht bei den anderen im Haushalt. Wird die App gelöscht, ist sie weg. Darum ab und zu eine verschlüsselte Sicherungsdatei ablegen (z. B. „In Dateien sichern“ → iCloud Drive).</p>
      <p class="muted small">${at ? `Letzte Sicherung: ${esc(fmtShort(new Date(at).toISOString().slice(0, 10)))}` : 'Noch keine Sicherung.'} Erinnerung, wenn seit ${BACKUP_DAYS} Tagen etwas geändert und nicht gesichert ist.</p>
      <button type="button" class="btn btn-primary btn-block" data-sheet-action="backup" style="margin-bottom:10px">${icon('lock', 'icon-sm')} Jetzt sichern</button>
      <label class="btn btn-block" style="margin-bottom:10px">${icon('refresh', 'icon-sm')} Sicherung laden<input type="file" name="file" accept=".json,application/json" hidden></label>
      ${hasBackupPassword() ? '<button type="button" class="btn btn-ghost btn-block" data-sheet-action="password">Passwort ändern</button>' : ''}`,
    actions: {
      backup() { doBackup(); },
      password() { backupPasswordSheet(); },
      async change(el) {
        if (el.name !== 'file' || !el.files[0]) return;
        let file;
        try { file = JSON.parse(await el.files[0].text()); } catch { file = null; }
        if (!isPlanFile(file)) return toast('Das ist keine Sicherung der Planung');
        restoreSheet(file);
      },
    },
  });
}

function restoreSheet(file) {
  openSheet({
    title: 'Sicherung laden',
    body: `
      <p class="small" style="margin-top:0">Sicherung vom ${esc(fmtShort(String(file.created || '').slice(0, 10) || todayKey()))}. Ersetzt die Planung auf diesem Gerät.</p>
      <label class="field"><span>Passwort der Sicherung</span><input class="input" type="password" name="pw" required autocomplete="current-password"></label>`,
    submitLabel: 'Laden',
    onSubmit(data) {
      const pw = String(data.get('pw'));
      readBackup(file, pw)
        .then((content) => restorePlan(content, pw))
        .then(() => { closeSheet(); toast('Planung geladen'); })
        .catch((err) => toast(err.message));
      return false;
    },
  });
}

// ---------- Ansicht ----------

const PARTS = { monat: monthPart, kosten: costsPart, rechnungen: billsPart, abos: abosPart, einnahmen: incomesPart };

export default {
  id: 'planung',
  title: 'Planung',
  short: 'Planung 🔒',

  render() {
    const due = backupDue();
    const at = plan().backup.at;
    return `
      <div class="plan-top">
        <span class="muted small">${icon('lock', 'icon-xs')} Nur auf diesem Gerät</span>
        <span class="plan-top-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="plBackup">Sicherung</button>
          <button type="button" class="btn btn-sm" data-action="plShow" aria-pressed="${shown}" aria-label="${shown ? 'Beträge verbergen' : 'Beträge zeigen'}">${shown ? 'Verbergen' : 'Zeigen'}</button>
        </span>
      </div>
      ${due ? `<button type="button" class="plan-backup-due" data-action="plBackupNow">${icon('warning', 'icon-sm')}
        <span><strong>Sicherung fällig</strong><small>${at ? `Letzte vor ${Math.floor((Date.now() - at) / 86400000)} Tagen` : 'Noch nie gesichert'} – jetzt sichern</small></span></button>` : ''}
      <div class="seg seg-wide seg-parts plan-tabs" role="group" aria-label="Planung">
        ${TABS.map(([id, label]) => `<button type="button" class="seg-btn" data-action="plTab" data-tab="${id}" aria-pressed="${id === tab}">${label}</button>`).join('')}
      </div>
      ${PARTS[tab]()}`;
  },

  actions: {
    plTab(el) {
      tab = el.dataset.tab;
      try { localStorage.setItem(TAB_KEY, tab); } catch { /* privates Fenster */ }
      refresh();
    },
    plShow() { shown = !shown; refresh(); },
    plMonth(el) { month = addMonths(month, Number(el.dataset.step)); refresh(); },
    plActive(el) { toggleActive(month, el.dataset.id); },
    plPart(el) {
      const x = notMonthly().find((y) => y.id === el.dataset.id);
      if (x) partSheet(x);
    },
    plUntil() { untilSheet(); },
    plCost(el) { editCost(plan().costs.find((x) => x.id === el.dataset.id)); },
    plAbo(el) { editAbo(plan().abos.find((x) => x.id === el.dataset.id)); },
    plIncome(el) { editIncome(plan().incomes.find((x) => x.id === el.dataset.id)); },
    plBill(el) { editBill(plan().bills.find((x) => x.id === el.dataset.id)); },
    plPay(el) {
      const b = plan().bills.find((x) => x.id === el.dataset.id);
      if (b) payBill(b);
    },
    plPayAll(el) {
      const b = plan().bills.find((x) => x.id === el.dataset.id);
      if (!b) return;
      const rect = el.getBoundingClientRect();
      addPayment(b.id, openOf(b));
      celebrate(rect);
    },
    plUnpay(el) {
      if (confirm('Diese Zahlung entfernen?')) removePayment(el.dataset.bill, el.dataset.id);
    },
    plBackup() { backupSheet(); },
    plBackupNow() { doBackup(); },
  },

  // Datum gewählt (change, nicht input: am iPhone schliesst ein Neuzeichnen das Datumsrad sonst nach dem ersten Drehen)
  change: {
    plAsOf(el) {
      asOf = el.value;
      refresh();
    },
  },
};
