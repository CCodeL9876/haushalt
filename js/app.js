// Einstieg: Tab-Leiste, Wechsel zwischen den Ansichten (über #einkauf, #woche …) und Weiterleitung der Klicks.
//
// Eine Ansicht (js/views/*.js) ist ein Objekt mit
//   id, title, icon       – für Adresse, Kopfzeile und Tab-Leiste (tab: kürzere Beschriftung, falls nötig)
//   render()              – gibt das HTML der Ansicht zurück (wird bei jeder Datenänderung neu gezeichnet)
//   actions.name(el)      – Klick auf ein Element mit data-action="name"
//   submit.name(form)     – Absenden eines Formulars mit data-form="name"
//   input.name(el, root)  – Eingabe in ein Feld mit data-input="name"
//   aliases, enter(id)   – weitere Adressen, die zu dieser Ansicht führen (z. B. #woche → Essen, Teil Wochenplan)
//   data-keep-focus       – an Knöpfen: Antippen lässt den Fokus (und die iPhone-Tastatur) im Eingabefeld
// Neuer Bereich = neue Datei in js/views/ und hier in VIEWS eintragen.

import { pull, session, setSyncErrorHandler, subscribe } from './store.js';
import { icon, toast } from './ui.js';
import { boot, currentMember, ensureMe } from './login.js';
import { refreshPush } from './push.js';
import { refreshReminder } from './reminder.js';
import { AccessError } from './remote.js';
import { setupPullToRefresh } from './refresh.js';
import einkauf from './views/einkauf.js';
import todo from './views/todo.js';
import essen from './views/essen.js';
import abrechnung from './views/abrechnung.js';
import { openSettings } from './views/einstellungen.js';

// Reihenfolge der Tab-Leiste: Einkauf neben Essen. Start (und unbekannte Adressen) bleibt der Einkauf.
const VIEWS = [todo, einkauf, essen, abrechnung];
const START = einkauf;

const root = document.getElementById('view');
const titleEl = document.getElementById('view-title');
const tabbar = document.getElementById('tabbar');
let current = START;

tabbar.innerHTML = VIEWS.map((v) => `<a class="tab" href="#${v.id}" data-tab="${v.id}">${icon(v.icon)}<span>${v.tab || v.title}</span></a>`).join('');

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
  root.innerHTML = current.render();
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
  if (session.mode !== 'shared') return;
  refreshPush(currentMember()?.id); // Push-Abo dieses Geräts in Supabase auffrischen (js/push.js)
  refreshReminder(); // persönliche Liste der Morgen-Erinnerung nachführen (js/reminder.js)
  // Änderungen der anderen holen: regelmässig und sobald die App wieder in den Vordergrund kommt
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => pull());
});

setupPullToRefresh();

// Offline-Betrieb und „Zum Home-Bildschirm“ (nur über https oder localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
