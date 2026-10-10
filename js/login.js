// Anmeldung wie bei Mallorca:
//  1. Link öffnen (…/#haushalt=<geheimer Schlüssel>) – ohne Link kommt man nicht hinein
//  2. Zugangscode eingeben (einmal pro Gerät, wird gemerkt)
//  3. „Wer bist du?“ – sich aus der Liste wählen oder neu eintragen (einmal pro Gerät)
// Danach zeigen die Initialen oben rechts, wer an diesem Gerät angemeldet ist; antippen = wechseln oder abmelden.
// Ohne eingerichtetes Supabase (js/config.js) entfällt das alles: Die App läuft lokal mit Beispieldaten.

import { AccessError, Remote, sharingConfigured, validCodeChars } from './remote.js';
import { cachedName, hasCache, MEMBER_COLORS, session, startLocal, startShared, state, uid, update } from './store.js';
import { keyFromText, loadSession, logout, myMemberId, saveSession, setMyMemberId, takeKeyFromUrl } from './session.js';
import { closeSheet, esc, icon, initials, openSheet, toast } from './ui.js';

const gate = document.getElementById('gate');
const appParts = ['.topbar', '#view', '#tabbar'].map((sel) => document.querySelector(sel));
let onReady = null;
let started = false;

export const currentMember = () =>
  (session.mode === 'shared' && state.members.find((m) => m.id === myMemberId(session.key))) || null;

// ---------- Ablauf ----------

export async function boot(ready) {
  onReady = ready;
  if (!sharingConfigured()) {
    startLocal();
    return finish();
  }
  const fromUrl = takeKeyFromUrl();
  // Link zu einem anderen Haushalt als bisher: dessen Code ist noch nicht bekannt
  if (fromUrl && fromUrl !== loadSession().key) saveSession(fromUrl, '');
  const { key, code } = loadSession();
  if (!key) return showNoLink();
  if (!code) return showCode(key);
  return connect(key, code);
}

async function connect(key, code) {
  showGate(`<p class="gate-text">Verbinde …</p>`);
  const remote = new Remote(key, code);
  try {
    const name = await remote.login();
    saveSession(key, code);
    await startShared(remote, name);
  } catch (err) {
    if (err instanceof AccessError && err.status === 'unknown') {
      saveSession(null, '');
      return showNoLink('Zu diesem Link gibt es keinen Haushalt. Bitte den aktuellen Link öffnen.');
    }
    if (err instanceof AccessError) return showCode(key, loadSession().code ? 'Der gespeicherte Code stimmt nicht mehr. Bitte den aktuellen Code eingeben.' : 'Dieser Code stimmt nicht.', true);
    // Keine Verbindung: mit dem letzten Stand dieses Geräts weiter, sofern man hier schon angemeldet war
    if (hasCache(key) && code === loadSession().code) {
      await startShared(remote, cachedName(key), { offline: true });
      toast('Offline – du siehst den letzten Stand');
    } else {
      return showCode(key, `Keine Verbindung (${err.message}). Bitte später nochmals versuchen.`);
    }
  }
  return finish();
}

function finish() {
  if (session.mode === 'shared' && !currentMember()) return showWho();
  hideGate();
  renderMe();
  if (!started) {
    started = true;
    onReady();
  }
}

// Läuft bei jedem Neuzeichnen: Wurde die eigene Person (auf einem anderen Gerät) entfernt, gleich neu wählen.
export function ensureMe() {
  renderMe();
  if (started && gate.hidden && session.mode === 'shared' && !currentMember()) showWho();
}

// ---------- Vollbild vor der App ----------

function showGate(html) {
  gate.innerHTML = `<div class="gate-inner">
      <div class="gate-logo">${icon('home')}</div>
      ${html}
    </div>`;
  gate.hidden = false;
  appParts.forEach((el) => { el.inert = true; });
  closeSheet();
}

function hideGate() {
  gate.hidden = true;
  gate.innerHTML = '';
  appParts.forEach((el) => { el.inert = false; });
}

function showNoLink(error = '') {
  showGate(`
    <h1 class="gate-title">Haushalt</h1>
    <p class="gate-text">Öffne den Link, den du für euren Haushalt bekommen hast – oder füge ihn hier ein.</p>
    <form class="gate-form" id="gate-form">
      <input class="input" name="link" placeholder="Link einfügen" autocomplete="off" autocapitalize="off" spellcheck="false" required>
      <p class="gate-error" role="alert">${esc(error)}</p>
      <button type="submit" class="btn btn-primary btn-block">Weiter</button>
    </form>`);
  gate.querySelector('#gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = keyFromText(e.target.elements.link.value);
    if (!key) {
      gate.querySelector('.gate-error').textContent = 'Das ist kein gültiger Haushalt-Link.';
      return;
    }
    saveSession(key, '');
    showCode(key);
  });
}

function showCode(key, error = '', shake = false) {
  showGate(`
    <h1 class="gate-title">Zugangscode</h1>
    <p class="gate-text">Dieser Haushalt ist geschützt. Den Code musst du auf diesem Gerät nur einmal eingeben.</p>
    <form class="gate-form ${shake ? 'is-shaking' : ''}" id="gate-form">
      <input class="input" type="password" name="code" placeholder="Code" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
      <label class="check-field small"><input type="checkbox" name="show"> Code anzeigen</label>
      <p class="gate-error" role="alert">${esc(error)}</p>
      <button type="submit" class="btn btn-primary btn-block">Öffnen</button>
    </form>`);
  const form = gate.querySelector('#gate-form');
  const input = form.elements.code;
  form.elements.show.addEventListener('change', (e) => { input.type = e.target.checked ? 'text' : 'password'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    if (!validCodeChars(code)) {
      form.querySelector('.gate-error').textContent = 'Der Code enthält Zeichen, die hier nicht gehen (z. B. Umlaute).';
      return;
    }
    connect(key, code);
  });
  if (shake) navigator.vibrate?.(120);
  setTimeout(() => input.focus(), 50);
}

const memberButtons = (currentId) => state.members.map((m) => `
  <button type="button" class="who-btn" data-who="${esc(m.id)}" aria-pressed="${m.id === currentId}">
    <span class="avatar" style="background:${esc(m.color)}" aria-hidden="true">${esc(initials(m.name))}</span>
    <span>${esc(m.name)}</span>
  </button>`).join('');

function showWho() {
  showGate(`
    <h1 class="gate-title">Wer bist du?</h1>
    <p class="gate-text">Einmal pro Gerät: Wähle dich aus${state.members.length ? '' : ' – oder trage dich ein'}. Danach bist du z. B. bei „Bezahlt von“ schon vorausgewählt.</p>
    ${state.members.length ? `<div class="who-list">${memberButtons(null)}</div>` : ''}
    <form class="gate-form" id="gate-form">
      <label class="field"><span>${state.members.length ? 'Neu dabei? Dein Name' : 'Dein Name'}</span>
        <input class="input" name="name" maxlength="30" autocomplete="given-name" required>
      </label>
      <p class="gate-error" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block">Das bin ich</button>
    </form>`);
  gate.querySelector('.who-list')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-who]')?.dataset.who;
    if (id) chooseMe(id);
  });
  gate.querySelector('#gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    if (name) chooseMe(addMember(name).id);
  });
}

// Gibt es den Namen schon (z. B. auf einem anderen Gerät angelegt), diese Person nehmen – kein Doppeleintrag
export function addMember(name) {
  const existing = state.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const member = { id: uid(), name: name.slice(0, 30), color: MEMBER_COLORS[state.members.length % MEMBER_COLORS.length], createdAt: Date.now() };
  update((s) => { s.members.push(member); });
  return member;
}

function chooseMe(id) {
  setMyMemberId(session.key, id);
  const wasStarted = started;
  finish();
  if (wasStarted) toast(`Hallo ${currentMember()?.name}!`);
}

// ---------- Initialen oben rechts ----------

const meBtn = document.getElementById('btn-me');

function renderMe() {
  meBtn.hidden = session.mode !== 'shared';
  if (meBtn.hidden) return;
  const me = currentMember();
  meBtn.textContent = me ? initials(me.name) : '?';
  meBtn.style.background = me?.color || '';
  meBtn.title = me ? `Angemeldet als ${me.name}${session.offline ? ' (offline)' : ''} – antippen zum Wechseln` : 'Wer bist du?';
  meBtn.setAttribute('aria-label', meBtn.title);
  meBtn.classList.toggle('is-offline', session.offline);
}

function addAndChoose(form) {
  const name = form.elements.name.value.trim();
  if (!name) return form.elements.name.focus();
  closeSheet();
  chooseMe(addMember(name).id);
}

meBtn.addEventListener('click', () => {
  const me = currentMember();
  openSheet({
    title: me ? `Angemeldet als ${me.name}` : 'Wer bist du?',
    body: `
      <p class="muted small" style="margin-top:0">Haushalt „${esc(session.name)}“${session.offline ? ' · offline, Änderungen werden nachgeholt' : ''}</p>
      <div class="who-list">${memberButtons(me?.id)}</div>
      <div class="add-row" style="margin-top:14px">
        <input class="input" name="name" placeholder="Neu dabei? Name" maxlength="30" autocomplete="off">
        <button type="button" class="btn btn-primary" data-sheet-action="add" aria-label="Person hinzufügen">${icon('plus')}</button>
      </div>`,
    footer: `<button type="button" class="btn btn-danger btn-block" data-sheet-action="logout">Auf diesem Gerät abmelden</button>`,
    // Enter im Namensfeld
    onSubmit(_, form) {
      addAndChoose(form);
      return false;
    },
    actions: {
      add(_, form) { addAndChoose(form); },
      logout() {
        if (!confirm('Auf diesem Gerät abmelden? Für die nächste Anmeldung braucht es wieder den Zugangscode.')) return;
        logout();
        location.reload();
      },
    },
  });
  // Person antippen = wechseln
  document.querySelector('#sheet .who-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-who]')?.dataset.who;
    if (!id) return;
    closeSheet();
    chooseMe(id);
  });
});
