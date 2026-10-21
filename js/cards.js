// Kundenkarten (Migros Cumulus, Coop Supercard …): Nummer erfassen, die App zeichnet den Strichcode (js/barcode.js).
// Gespeichert nur auf diesem Gerät, pro Haushalt und Person (wie die persönlichen ToDo-Listen) – nie in Supabase,
// nicht in der Sicherung. Mehrere Karten: im Fenster zur Seite wischen, die zuletzt gezeigte kommt zuerst.
//   cards [{ id, name, number, format?, usedAt }]   format: 'auto' (Standard) oder 'code128' (falls die Karte so gedruckt ist)

import { owner } from './personal.js';
import { uid } from './store.js';
import { barcodeSvg } from './barcode.js';
import { closeSheet, esc, icon, openSheet, toast } from './ui.js';

const PREFIX = 'haushalt.cards.';
const SHOPS = ['Migros', 'Coop', 'Denner', 'Lidl', 'Aldi', 'Volg', 'Manor'];

const key = () => PREFIX + owner();
export function cards() {
  try {
    const list = JSON.parse(localStorage.getItem(key()) || '[]');
    return Array.isArray(list) ? list.sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0)) : [];
  } catch {
    return [];
  }
}
function saveCards(list) {
  try { localStorage.setItem(key(), JSON.stringify(list)); } catch { toast('Karte konnte nicht gespeichert werden'); }
}
const clean = (number) => String(number || '').replace(/\s+/g, '');
const codeFor = (c) => barcodeSvg(clean(c.number), c.format);

function markUsed(id) {
  saveCards(cards().map((c) => (c.id === id ? { ...c, usedAt: Date.now() } : c)));
}

const cardHtml = (c, n) => {
  const code = codeFor(c);
  return `<article class="loyalty-card loyalty-${(n % 3) + 1}" data-id="${esc(c.id)}">
    <header><strong>${esc(c.name)}</strong>
      <button type="button" class="icon-btn" data-sheet-action="edit" data-id="${esc(c.id)}" aria-label="${esc(c.name)} bearbeiten">${icon('settings', 'icon-sm')}</button>
    </header>
    <div class="loyalty-code">${code ? code.svg : '<p class="small">Strichcode lässt sich nicht darstellen</p>'}
      <div class="loyalty-number">${esc(c.number)}</div>
    </div>
  </article>`;
};

// Karten zeigen (zum Scannen an der Kasse). Ohne Karte gleich zum Erfassen.
export function showCards() {
  const list = cards();
  if (!list.length) return editCard();
  const form = openSheet({
    title: list.length > 1 ? 'Kundenkarten' : list[0].name,
    body: `
      <div class="loyalty-track" tabindex="0" aria-label="Kundenkarten – zur Seite wischen">${list.map(cardHtml).join('')}</div>
      ${list.length > 1 ? `<div class="loyalty-dots" aria-hidden="true">${list.map((_, n) => `<i class="${n ? '' : 'is-on'}"></i>`).join('')}</div>` : ''}
      <p class="muted small" style="text-align:center;margin:10px 0 0">Nur auf diesem Gerät gespeichert${list.length > 1 ? ' · zur Seite wischen für die nächste Karte' : ''}</p>`,
    footer: '<button type="button" class="btn btn-block" data-sheet-action="add">Karte hinzufügen</button>',
    actions: {
      add() { editCard(); },
      edit(btn) { editCard(btn.dataset.id); },
    },
  });
  markUsed(list[0].id);
  // Gewischt: Punkte nachführen und die gezeigte Karte als zuletzt benutzt merken
  const track = form.querySelector('.loyalty-track');
  let timer;
  track.addEventListener('scroll', () => {
    const n = Math.round(track.scrollLeft / track.clientWidth);
    form.querySelectorAll('.loyalty-dots i').forEach((dot, i) => dot.classList.toggle('is-on', i === n));
    clearTimeout(timer);
    timer = setTimeout(() => { if (list[n]) markUsed(list[n].id); }, 400);
  });
}

function editCard(id) {
  const card = cards().find((c) => c.id === id);
  const form = openSheet({
    title: card ? 'Karte bearbeiten' : 'Kundenkarte hinzufügen',
    body: `
      <label class="field"><span>Laden</span>
        <input class="input" name="name" value="${esc(card?.name)}" required maxlength="40" autocomplete="off" placeholder="z. B. Migros">
      </label>
      <div class="chips" style="margin:-4px 0 14px">${SHOPS.map((s) => `<button type="button" class="chip" data-sheet-action="shop" data-name="${s}">${s}</button>`).join('')}</div>
      <label class="field"><span>Kartennummer (steht unter dem Strichcode)</span>
        <input class="input" name="number" value="${esc(card?.number)}" required maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="numeric">
      </label>
      <div class="loyalty-preview" aria-live="polite"></div>
      <details class="field link-field"><summary>Strichcode sieht anders aus als auf der Karte?</summary>
        <label class="check-field small" style="margin-top:6px"><input type="checkbox" name="code128" ${card?.format === 'code128' ? 'checked' : ''}> Als Code 128 darstellen (statt EAN)</label>
      </details>
      <p class="muted small" style="margin:6px 0 0">${icon('lock', 'icon-xs')} Nur auf diesem Gerät gespeichert, nicht in Supabase und für die anderen im Haushalt nicht sichtbar.</p>`,
    submitLabel: 'Speichern',
    footer: card ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Karte löschen</button>' : '',
    actions: {
      shop(btn, f) {
        f.elements.name.value = btn.dataset.name;
        f.elements.number.focus();
      },
      remove() {
        if (!confirm(`Karte „${card.name}“ löschen?`)) return;
        saveCards(cards().filter((c) => c.id !== card.id));
        closeSheet();
        if (cards().length) showCards();
      },
      change(_, f) { preview(f); },
    },
    onSubmit(data) {
      const name = String(data.get('name') || '').trim().slice(0, 40);
      const number = String(data.get('number') || '').trim().slice(0, 40);
      const format = data.get('code128') ? 'code128' : 'auto';
      if (!name || !number) return false;
      if (!codeFor({ number, format })) { toast('Diese Nummer lässt sich nicht als Strichcode darstellen'); return false; }
      const list = cards();
      if (card) saveCards(list.map((c) => (c.id === card.id ? { ...c, name, number, format, usedAt: Date.now() } : c)));
      else saveCards([...list, { id: uid(), name, number, format, usedAt: Date.now() }]);
      closeSheet();
      showCards();
      return false;
    },
  });
  form.addEventListener('input', () => preview(form));
  preview(form);
  if (!card) setTimeout(() => form.elements.name.focus(), 50);
}

function preview(form) {
  const number = form.elements.number.value;
  const code = number.trim() && codeFor({ number, format: form.elements.code128.checked ? 'code128' : 'auto' });
  form.querySelector('.loyalty-preview').innerHTML = code
    ? `<div class="loyalty-code">${code.svg}<div class="loyalty-number small">${esc(code.format)} · mit der Karte vergleichen</div></div>`
    : '';
}

