// Kleine Belohnung beim Abhaken eines ToDos (auch Gepacktes): ein Bildeffekt, dazu ein kurzer Ton (im Browser
// erzeugt – keine Datei; Glocke, Plopp, Münze, Marimba oder Klick, pro Gerät wählbar) und am Android ein kurzes
// Vibrieren.
// Bildeffekte (STYLES): Farbtupfer aus dem Kästchen, grosses Häkchen, Schriftzug „Good job!“ oder jedes Mal ein anderer.
// Ist die ganze Liste erledigt, gibt es mehr davon („Alles erledigt!“, viele Tupfer) und einen dritten Ton.
// Pro Gerät einstellbar (App-Einstellungen → Beim Abhaken): 'all' Ton und Effekt, 'visual' nur Effekt, 'off' aus; dazu der
// Bildeffekt. Am iPhone bleibt der Ton stumm, wenn der Stummschalter an ist. „Bewegung reduzieren“ schaltet den
// Bildeffekt ab.

const KEY = 'haushalt.celebrate';
const STYLE_KEY = 'haushalt.celebrate.style';
const SOUND_KEY = 'haushalt.celebrate.sound';
export const CELEBRATE_CHOICES = [['all', 'Ton + Effekt'], ['visual', 'Nur Effekt'], ['off', 'Aus']];
export const STYLES = [['dots', 'Tupfer'], ['check', 'Häkchen'], ['text', 'Good job!'], ['mix', 'Zufall']];
export const SOUNDS = [['chime', '🔔 Glocke'], ['pop', '🫧 Plopp'], ['coin', '🪙 Münze'], ['marimba', '🎵 Marimba'], ['click', '✔️ Klick']];

export function celebrateSound() {
  try { return SOUNDS.some(([id]) => id === localStorage.getItem(SOUND_KEY)) ? localStorage.getItem(SOUND_KEY) : 'chime'; } catch { return 'chime'; }
}
export function setCelebrateSound(sound) {
  try {
    if (sound === 'chime') localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, sound);
  } catch { /* privates Fenster: gilt bis zum Neuladen */ }
}

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
// Ein Ton: Frequenz (optional gleitend bis `to`), Wellenform, Lautstärke, Länge in Sekunden ab `at`
function tone(at, freq, { type = 'sine', vol = 0.18, len = 0.35, to } = {}) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + len * 0.8);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + len + 0.05);
}

// Klick: ein ganz kurzes Rauschen, hell gefiltert
function noise(at, len = 0.03, vol = 0.25) {
  const buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * len), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  src.buffer = buf;
  filter.type = 'highpass';
  filter.frequency.value = 2200;
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(at);
}

// Die Töne – `big` (ganze Liste erledigt): je eine Stufe mehr. Leise genug fürs Wohnzimmer.
const PLAY = {
  // Dur-Dreiklang aufwärts: kurz und hell
  chime: (t, big) => (big ? [784, 988, 1319] : [880, 1319]).forEach((f, n) => tone(t + n * 0.08, f)),
  // Plopp wie eine Blase: kurzer Ton, der nach oben springt
  pop: (t, big) => (big ? [0, 0.1, 0.2] : [0]).forEach((d, n) => tone(t + d, 380 + n * 120, { to: 900 + n * 200, len: 0.12, vol: 0.22 })),
  // Münze aus dem Videospiel: zwei schnelle Rechteck-Töne
  coin: (t, big) => {
    tone(t, 988, { type: 'square', vol: 0.06, len: 0.08 });
    tone(t + 0.07, 1319, { type: 'square', vol: 0.06, len: big ? 0.25 : 0.35 });
    if (big) [1568, 2093].forEach((f, n) => tone(t + 0.2 + n * 0.08, f, { type: 'square', vol: 0.05, len: 0.3 }));
  },
  // Marimba: warm und hölzern, kurz ausklingend, mit leisem Oberton
  marimba: (t, big) => (big ? [523, 659, 784, 1047] : [523, 784]).forEach((f, n) => {
    tone(t + n * 0.09, f, { type: 'triangle', vol: 0.22, len: 0.28 });
    tone(t + n * 0.09, f * 4, { vol: 0.03, len: 0.06 });
  }),
  // Klick wie ein Schalter – bei der ganzen Liste ein Doppelklick mit kleinem Ton
  click: (t, big) => {
    noise(t);
    if (big) {
      noise(t + 0.09);
      tone(t + 0.16, 1047, { vol: 0.1, len: 0.25 });
    }
  },
};

export function playSound(sound = celebrateSound(), big = false) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    (PLAY[sound] || PLAY.chime)(audio.currentTime + 0.01, big);
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
  if (mode === 'all') playSound(celebrateSound(), big);
  navigator.vibrate?.(big ? [15, 60, 25] : 15);
}
