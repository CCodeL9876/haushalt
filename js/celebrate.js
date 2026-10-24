// Kleine Belohnung beim Abhaken eines ToDos (auch Gepacktes): ein Bildeffekt, dazu ein kurzer Ton (zwei Töne, im
// Browser erzeugt – keine Datei) und am Android ein kurzes Vibrieren.
// Bildeffekte (STYLES): Farbtupfer aus dem Kästchen, grosses Häkchen, Schriftzug „Good job!“ oder jedes Mal ein anderer.
// Ist die ganze Liste erledigt, gibt es mehr davon („Alles erledigt!“, viele Tupfer) und einen dritten Ton.
// Pro Gerät einstellbar (Haushalt → Beim Abhaken): 'all' Ton und Effekt, 'visual' nur Effekt, 'off' aus; dazu der
// Bildeffekt. Am iPhone bleibt der Ton stumm, wenn der Stummschalter an ist. „Bewegung reduzieren“ schaltet den
// Bildeffekt ab.

const KEY = 'haushalt.celebrate';
const STYLE_KEY = 'haushalt.celebrate.style';
export const CELEBRATE_CHOICES = [['all', 'Ton und Effekt'], ['visual', 'Nur Effekt'], ['off', 'Aus']];
export const STYLES = [['dots', 'Tupfer'], ['check', 'Häkchen'], ['text', 'Good job!'], ['mix', 'Zufall']];

export function celebrateStyle() {
  try { return localStorage.getItem(STYLE_KEY) || 'dots'; } catch { return 'dots'; }
}
export function setCelebrateStyle(style) {
  try {
    if (style === 'dots') localStorage.removeItem(STYLE_KEY);
    else localStorage.setItem(STYLE_KEY, style);
  } catch { /* privates Fenster: gilt bis zum Neuladen */ }
}

export function celebrateMode() {
  try { return localStorage.getItem(KEY) || 'all'; } catch { return 'all'; }
}
export function setCelebrateMode(mode) {
  try {
    if (mode === 'all') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch { /* privates Fenster: gilt bis zum Neuladen */ }
}

let audio = null;
function chime(big) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.01;
    // Dur-Dreiklang aufwärts: kurz und hell, leise genug fürs Wohnzimmer
    (big ? [784, 988, 1319] : [880, 1319]).forEach((freq, n) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const start = t0 + n * 0.08;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch { /* ohne Ton */ }
}

// Ebene über allem; ist ein Fenster offen (Dialog, oberste Ebene), dort hinein, sonst läge der Effekt dahinter
function layer(ms) {
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('aria-hidden', 'true');
  (document.querySelector('dialog[open]') || document.body).append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

const colors = () => {
  const css = getComputedStyle(document.documentElement);
  return ['--accent', '--tile-1-bg', '--tile-2-bg', '--tile-3-bg', '--hero'].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
};

// Farbtupfer aus dem Kästchen (bzw. bei „Alles erledigt“ eine grosse Ladung)
function dots(r, big) {
  if (!r?.width) return;
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const palette = colors();
  const box = layer(big ? 1200 : 800);
  const ring = document.createElement('i');
  ring.className = 'celebrate-ring';
  ring.style.cssText = `left:${x}px;top:${y}px`;
  box.append(ring);
  const count = big ? 36 : 14;
  for (let n = 0; n < count; n += 1) {
    const dot = document.createElement('i');
    const angle = (n / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = (big ? 70 : 34) + Math.random() * (big ? 110 : 30);
    const size = 5 + Math.random() * (big ? 7 : 4);
    dot.className = 'celebrate-dot';
    dot.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${palette[n % palette.length]};`
      + `--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist + (big ? 40 : 10)}px;--rot:${Math.random() * 360}deg;`
      + `border-radius:${n % 3 ? '50%' : '2px'};animation-delay:${Math.random() * 40}ms`;
    box.append(dot);
  }
}

// Grosses Häkchen in der Mitte: wird gezeichnet, wächst und verblasst
function check(big) {
  const box = layer(1100);
  box.innerHTML = `<div class="celebrate-check${big ? ' is-big' : ''}">
    <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L38 19"/></svg>
  </div>`;
}

// Schriftzug in der Mitte: wächst und verblasst
function text(big) {
  const box = layer(1300);
  const word = document.createElement('div');
  word.className = `celebrate-text${big ? ' is-big' : ''}`;
  word.textContent = big ? 'Alles erledigt! 🎉' : 'Good job!';
  box.append(word);
}

let lastMix = '';
function pickStyle() {
  const style = celebrateStyle();
  if (style !== 'mix') return style;
  const options = ['dots', 'check', 'text'].filter((x) => x !== lastMix); // nie zweimal dasselbe hintereinander
  lastMix = options[Math.floor(Math.random() * options.length)];
  return lastMix;
}

function show(rect, big, style = pickStyle()) {
  if (style === 'check') check(big);
  else if (style === 'text') text(big);
  else return dots(rect, big);
  if (big) dots(rect, true); // ganze Liste erledigt: zum Häkchen bzw. Schriftzug auch die grosse Ladung Tupfer
}

// at: das angetippte Kästchen oder dessen Lage (getBoundingClientRect – vor dem Neuzeichnen gelesen),
// big: ganze Liste erledigt
// style: bestimmten Bildeffekt zeigen (Vorführen in den Einstellungen), sonst der eingestellte
export function celebrate(at, { big = false, style } = {}) {
  const mode = celebrateMode();
  if (mode === 'off' || !at) return;
  const rect = at instanceof Element ? at.getBoundingClientRect() : at;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) show(rect, big, style);
  if (mode === 'all') chime(big);
  navigator.vibrate?.(big ? [15, 60, 25] : 15);
}
