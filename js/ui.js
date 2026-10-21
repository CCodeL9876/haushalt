// Gemeinsame Bausteine der Oberfläche: Symbole, Geldbeträge, Bottom-Sheet, Meldungen.

import { state } from './store.js';

// Text aus Eingaben immer hierüber in HTML einsetzen
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Symbole (Strichzeichnungen im Stil von Lucide) ----------
const PATHS = {
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  calendarPlus: '<path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M16 2v4M8 2v4M3 10h18M19 16v6M16 19h6"/>',
  calendarCheck: '<path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m16 19 2 2 4-4"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2Z"/>',
  listCheck: '<path d="M11 6h10M11 12h10M11 18h10"/><path d="m3 6 1.5 1.5L7 5"/><path d="m3 12 1.5 1.5L7 11"/><path d="m3 18 1.5 1.5L7 17"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/><path d="M5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  star: '<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

export const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;

// ---------- Geld: intern ganze Rappen/Cent, damit 0.1 + 0.2 keine Rundungsfehler macht ----------
export function money(cents, { sign = false } = {}) {
  const text = new Intl.NumberFormat('de-CH', { style: 'currency', currency: state.settings.currency }).format(Math.abs(cents) / 100);
  if (!sign || cents === 0) return cents < 0 ? `−${text}` : text;
  return cents > 0 ? `+${text}` : `−${text}`;
}

// „12.50“, „12,5“, „CHF 12“ → 1250; ungültig → null
export function parseMoney(text) {
  const clean = String(text).replace(/[^\d.,-]/g, '').replace(',', '.');
  const value = Number.parseFloat(clean);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

// Gespeicherte Werte kommen aus der Datenbank oder einer Sicherungsdatei und könnten verändert sein:
// Beim Anzeigen in Farben (style) und Links (href) nur erwartete Formen zulassen.
export const safeColor = (value) => (/^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#888888');
export function safeLink(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

// „Anna Muster“ → „AM“, „Anna“ → „A“
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : (parts[0] || '?')[0]).toUpperCase();
}
export const avatar = (member) =>
  `<span class="avatar" style="background:${safeColor(member?.color)}" aria-hidden="true">${esc(initials(member?.name))}</span>`;

// ---------- Bottom-Sheet ----------
// Ein <dialog> für alle Formulare. `body` ist fertiges HTML (Werte mit esc!).
// onSubmit(formData, form) – gibt es false zurück, bleibt das Fenster offen.
// actions: { name: (button, form) => … } für Knöpfe mit data-sheet-action="name".
// headerActions: zusätzliche kleine Knöpfe oben neben dem Schliessen-Kreuz (fertiges HTML).
const sheet = document.getElementById('sheet');

export function openSheet({ title, body, submitLabel, onSubmit, actions = {}, footer = '', headerActions = '' }) {
  sheet.innerHTML = `
    <form class="sheet-form" novalidate>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <div class="sheet-head-actions">
          ${headerActions}
          <button type="button" class="icon-btn" data-close aria-label="Schliessen">${icon('x')}</button>
        </div>
      </header>
      <div class="sheet-body">${body}</div>
      ${submitLabel || footer ? `<footer class="sheet-foot">
        ${submitLabel ? `<button type="submit" class="btn btn-primary btn-block">${esc(submitLabel)}</button>` : ''}
        ${footer}
      </footer>` : ''}
    </form>`;
  const form = sheet.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (onSubmit?.(new FormData(form), form) !== false) closeSheet();
  });
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) return closeSheet();
    const btn = e.target.closest('[data-sheet-action]');
    if (btn) actions[btn.dataset.sheetAction]?.(btn, form);
  };
  sheet.onchange = (e) => actions.change?.(e.target, form);
  if (!sheet.open) sheet.showModal();
  return form;
}

export const closeSheet = () => sheet.open && sheet.close();

// iPhone: die Bildschirmtastatur überdeckt sonst den unteren Teil des Sheets
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

// ---------- Kurze Meldung unten ----------
const toastEl = document.getElementById('toast');
let toastTimer;
export function toast(text) {
  // Ein offenes Sheet liegt über allem – die Meldung muss dann darin stehen, sonst bleibt sie verdeckt
  (sheet.open ? sheet : document.body).append(toastEl);
  toastEl.textContent = text;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2400);
}
