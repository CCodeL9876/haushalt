// Einstieg: Tab-Leiste, Wechsel zwischen den Ansichten (über #einkauf, #woche …) und Weiterleitung der Klicks.
//
// Eine Ansicht (js/views/*.js) ist ein Objekt mit
//   id, title, icon       – für Adresse, Kopfzeile und Tab-Leiste (tab: kürzere Beschriftung, falls nötig)
//   render()              – gibt das HTML der Ansicht zurück (wird bei jeder Datenänderung neu gezeichnet)
//   actions.name(el)      – Klick auf ein Element mit data-action="name"
//   submit.name(form)     – Absenden eines Formulars mit data-form="name"
//   input.name(el, root)  – Eingabe in ein Feld mit data-input="name"
//   change.name(el, root) – Feld mit data-change="name" geändert (z. B. Datum gewählt)
//   aliases, enter(id)   – weitere Adressen, die zu dieser Ansicht führen (z. B. #woche → Essen, Teil Wochenplan)
//   data-keep-focus       – an Knöpfen: Antippen lässt den Fokus (und die iPhone-Tastatur) im Eingabefeld
// Neuer Bereich = neue Datei in js/views/ und hier in VIEWS eintragen.

import { pull, session, setSyncErrorHandler, subscribe } from './store.js';
import { icon, toast } from './ui.js';
import { boot, currentMember, ensureMe } from './login.js';
import { refreshPush } from './push.js';
import { refreshCalendars } from './calendars.js';
import { refreshReminder } from './reminder.js';
import { refreshBrief } from './brief.js';
import { cleanup } from './cleanup.js';
import { setupSwipe } from './swipe.js';
import { quickAdd } from './quickadd.js';
import { scheduleAlarmSync } from './alarms.js';
import { AccessError } from './remote.js';
import { setupPullToRefresh } from './refresh.js';
import heute from './views/heute.js';
import einkauf from './views/einkauf.js';
import todo from './views/todo.js';
import essen from './views/essen.js';
import geld from './views/geld.js';
import { openSettings } from './views/einstellungen.js';

// Reihenfolge der Tab-Leiste: Heute zuerst, Einkauf neben Essen. Start (und unbekannte Adressen) ist „Heute“.
const VIEWS = [heute, todo, einkauf, essen, geld];
const START = heute;

const root = document.getElementById('view');
const titleEl = document.getElementById('view-title');
const tabbar = document.getElementById('tabbar');
let current = START;

// In der Mitte das Plus für alles (js/quickadd.js): einfach eintippen, die App erkennt die Art
const tabHtml = VIEWS.map((v) => `<a class="tab" href="#${v.id}" data-tab="${v.id}">${icon(v.icon)}<span>${v.tab || v.title}</span></a>`);
tabHtml.splice(2, 0, `<button type="button" class="tab-plus" id="btn-quick" aria-label="Neu: Einkauf, ToDo, Menü oder Rechnung">${icon('plus')}</button>`);
tabbar.innerHTML = tabHtml.join('');
document.getElementById('btn-quick').addEventListener('click', quickAdd);

// Änderung von einem anderen Gerät, während man hier gerade etwas eintippt: erst danach neu zeichnen,
// sonst wäre der angefangene Text weg. Ist das Feld leer, gleich neu zeichnen und den Cursor zurücksetzen.
let renderLater = false;
const typing = () => {
  const el = document.activeElement;
  return root.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.value.trim() !== '';
};
const renderIfDone = () => { if (renderLater && !typing()) render(); };
root.addEventListener('focusout', () => setTimeout(renderIfDone));
root.addEventListener('input', renderIfDone);

function render(source = 'local') {
  ensureMe();
  if (source === 'remote' && typing()) {
    renderLater = true;
    return;
  }
  renderLater = false;
  const focusedId = root.contains(document.activeElement) ? document.activeElement.id : '';
  // Seitwärts gescrollte Leisten (data-keep-scroll, z. B. „Sport diese Woche“) beim Neuzeichnen nicht zurückspringen lassen
  const scrolled = [...root.querySelectorAll('[data-keep-scroll]')].map((el) => [el.dataset.keepScroll, el.scrollLeft]);
  root.innerHTML = current.render();
  for (const [key, x] of scrolled) { const el = root.querySelector(`[data-keep-scroll="${key}"]`); if (el) el.scrollLeft = x; }
  if (focusedId) document.getElementById(focusedId)?.focus();
}

// Farbe der iPhone-Statusleiste = Hintergrund des offenen Bereichs (auch nach Wechsel hell/dunkel)
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);

function route() {
  // Adresse wie #todo/shared/<id>: Bereich vor dem ersten „/“, der Rest geht an enter() der Ansicht
  const [id, ...rest] = location.hash.slice(1).split('/');
  const next = VIEWS.find((v) => v.id === id || v.aliases?.includes(id)) || START;
  if (next.aliases?.includes(id) || rest.length) next.enter?.(id, rest);
  const changed = next !== current;
  current = next;
  // Bereich als Merkmal am <html>, z. B. für eigene Farben pro Bereich (css/styles.css, :root[data-view=…])
  document.documentElement.dataset.view = current.id;
  syncThemeColor();
  titleEl.textContent = current.title;
  document.title = `${current.title} · Haushalt`;
  // Alte Adresse (#woche) durch die des Tabs ersetzen, damit Zurück/Neuladen stimmt
  if ((id !== current.id && next.aliases?.includes(id)) || rest.length) history.replaceState(null, '', `#${current.id}`);
  for (const tab of tabbar.children) {
    if (tab.dataset.tab === current.id) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  render();
  if (changed) window.scrollTo(0, 0);
}

// Knöpfe mit data-keep-focus (z. B. Vorschläge beim Einkauf) nehmen dem Eingabefeld den Fokus nicht weg –
// so bleibt am iPhone die Tastatur offen und man kann gleich weiterschreiben.
for (const type of ['pointerdown', 'mousedown']) {
  root.addEventListener(type, (e) => { if (e.target.closest('[data-keep-focus]')) e.preventDefault(); });
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) current.actions?.[el.dataset.action]?.(el, e);
});
root.addEventListener('submit', (e) => {
  e.preventDefault();
  current.submit?.[e.target.dataset.form]?.(e.target);
});
root.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el) current.input?.[el.dataset.input]?.(el, root);
});
root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) current.change?.[el.dataset.change]?.(el, root);
});

document.getElementById('btn-settings').innerHTML = icon('settings');
document.getElementById('btn-settings').addEventListener('click', openSettings);

subscribe(render);
window.addEventListener('hashchange', route);
// Mitteilung angetippt, während die App offen war (sw.js): zum passenden Bereich, z. B. #kuehlschrank
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open' && /^#[a-z]+(\/[a-z]+\/[a-z0-9]+)?$/i.test(e.data.hash || '')) location.hash = e.data.hash;
});

setSyncErrorHandler((err) => {
  // Zugangscode inzwischen geändert: neu laden → Anmeldung fragt den neuen Code ab
  if (err instanceof AccessError) return location.reload();
  toast(err instanceof TypeError || err.name === 'TimeoutError' ? 'Offline – wird nachgeholt, sobald wieder Netz da ist' : `Nicht gespeichert: ${err.message}`);
});

// Erst Anmeldung (Link, Code, „Wer bist du?“), dann die App
boot(() => {
  route();
  cleanup(); // Erledigtes und Abgerechnetes nach der Frist löschen (js/cleanup.js)
  setupSwipe(root);
  if (session.mode !== 'shared') return;
  // Push-Abo dieses Geräts in Supabase auffrischen (js/push.js), danach die Morgen-Erinnerung (js/reminder.js) –
  // nach einem neuen Zugangscode sind beide in Supabase gelöscht und werden so wieder hinterlegt
  refreshPush(currentMember()?.id).then(() => { refreshReminder(); refreshBrief(); });
  scheduleAlarmSync(); // Erinnerungen vor ToDos in Supabase nachführen (js/alarms.js)
  // Änderungen der anderen holen: regelmässig und sobald die App wieder in den Vordergrund kommt. Kalender
  // (js/calendars.js) dabei auch – sie laden selbst nur, wenn ihr Stand älter als 15 Minuten ist
  refreshCalendars();
  setInterval(() => { if (document.visibilityState === 'visible') { pull(); refreshCalendars(); } }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pull(); refreshCalendars(); } });
  window.addEventListener('online', () => pull());
});

setupPullToRefresh();

// Offline-Betrieb und „Zum Home-Bildschirm“ (nur über https oder localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
