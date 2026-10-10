// Was dieses Gerät sich merkt: welcher Haushalt (Schlüssel + Zugangscode) und wer das Gerät benutzt.
// Liegt im localStorage, bis man sich unter „Haushalt → Abmelden“ abmeldet.

const SESSION_KEY = 'haushalt.session';
const ME_PREFIX = 'haushalt.me.';
const LINK_HASH = /(?:^#|&)haushalt=([a-f0-9]{32,128})/i;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // privates Fenster o. Ä.: dann eben ohne Merken
  }
}

export function loadSession() {
  const s = read(SESSION_KEY);
  return { key: s?.key || null, code: s?.code || '' };
}
export const saveSession = (key, code) => write(SESSION_KEY, { key, code });

// Abmelden: Code und Personenwahl vergessen; der Schlüssel bleibt, damit man ohne Link wieder hineinkommt
export function logout() {
  const { key } = loadSession();
  if (key) {
    write(SESSION_KEY, { key, code: '' });
    write(ME_PREFIX + key, null);
  }
}

// Haushalt-Schlüssel aus dem Link (…/#haushalt=abc…) lesen und gleich aus der Adresse entfernen,
// damit er nicht in Screenshots oder beim Weiterleiten der Adresse einer Ansicht landet.
export function takeKeyFromUrl() {
  const m = location.hash.match(LINK_HASH);
  if (!m) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#einkauf`);
  return m[1].toLowerCase();
}

// Eingefügter Link oder nackter Schlüssel → Schlüssel
export function keyFromText(text) {
  const t = String(text || '').trim();
  return t.match(LINK_HASH)?.[1]?.toLowerCase() || (/^[a-f0-9]{32,128}$/i.test(t) ? t.toLowerCase() : null);
}

export const shareLink = (key) => `${location.origin}${location.pathname}#haushalt=${key}`;

export const myMemberId = (key) => read(ME_PREFIX + key);
export const setMyMemberId = (key, id) => write(ME_PREFIX + key, id);
