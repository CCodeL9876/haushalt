// Aktualisieren bei geöffneter App: ganz oben nach unten ziehen (wie in iPhone-Apps) oder unter Haushalt
// „App aktualisieren“. Lädt die App neu – damit kommen die neueste Version (der Service Worker holt Dateien
// zuerst aus dem Netz, sw.js) und die neuesten Daten. Eigene, noch nicht hochgeladene Änderungen gehen vorher hoch.
// Gebraucht vor allem in der App vom Home-Bildschirm: Dort gibt es keinen Neu-laden-Knopf.

import { pull } from './store.js';
import { icon } from './ui.js';

const THRESHOLD = 70; // so weit ziehen (px), dann wird beim Loslassen aktualisiert
const MAX = 110;

export async function reloadApp() {
  try {
    await Promise.race([pull(), new Promise((r) => setTimeout(r, 4000))]); // offline nicht ewig warten
  } finally {
    location.reload();
  }
}

export function setupPullToRefresh() {
  const el = document.createElement('div');
  el.className = 'ptr';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = icon('refresh');
  document.body.append(el);

  let startY = null;
  let startX = 0;
  let dy = 0;
  let busy = false;

  // Nur wenn ganz oben, kein Fenster offen und nicht in der Anmeldung
  const allowed = () => window.scrollY <= 0 && !document.getElementById('sheet').open && document.getElementById('gate').hidden;

  const show = (d) => {
    const pos = Math.min(d, MAX);
    el.style.transform = `translate(-50%, ${pos - 50}px) rotate(${pos * 3}deg)`;
    el.style.opacity = String(Math.min(pos / THRESHOLD, 1));
    el.classList.toggle('is-ready', d >= THRESHOLD);
  };
  const reset = () => {
    el.style.transform = '';
    el.style.opacity = '';
    el.classList.remove('is-ready');
  };

  window.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || !allowed()) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dy = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const y = e.touches[0].clientY - startY;
    const x = e.touches[0].clientX - startX;
    // Seitwärts wischen (z. B. Vorschläge beim Einkauf) oder nach oben scrollen: kein Aktualisieren
    if (y <= 0 || Math.abs(x) > y || window.scrollY > 0) {
      startY = null;
      reset();
      return;
    }
    dy = y * 0.6; // etwas Widerstand, wie bei iOS
    show(dy);
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (startY == null) return;
    startY = null;
    if (dy < THRESHOLD) return reset();
    busy = true;
    el.classList.add('is-loading');
    el.style.transform = 'translate(-50%, 20px)';
    el.style.opacity = '1';
    reloadApp();
  });
  window.addEventListener('touchcancel', () => { startY = null; reset(); });
}
