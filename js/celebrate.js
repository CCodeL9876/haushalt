// Kleine Belohnung beim Abhaken eines ToDos (auch Gepacktes): Farbtupfer springen aus dem Kästchen, dazu ein
// kurzer Ton (zwei Töne, im Browser erzeugt – keine Datei) und am Android ein kurzes Vibrieren.
// Ist die ganze Liste erledigt, gibt es eine grössere Ladung und einen dritten Ton.
// Pro Gerät einstellbar (Haushalt → Farbdesign): 'all' Ton und Effekt, 'visual' nur Effekt, 'off' aus.
// Am iPhone bleibt der Ton stumm, wenn der Stummschalter an ist. „Bewegung reduzieren“ schaltet den Effekt ab.

const KEY = 'haushalt.celebrate';
export const CELEBRATE_CHOICES = [['all', 'Ton und Effekt'], ['visual', 'Nur Effekt'], ['off', 'Aus']];

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

function burst(r, big) {
  if (!r?.width) return;
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const css = getComputedStyle(document.documentElement);
  const colors = ['--accent', '--tile-1-bg', '--tile-2-bg', '--tile-3-bg', '--hero']
    .map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
  const layer = document.createElement('div');
  layer.className = 'celebrate';
  layer.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('i');
  ring.className = 'celebrate-ring';
  ring.style.cssText = `left:${x}px;top:${y}px`;
  layer.append(ring);
  const count = big ? 36 : 14;
  for (let n = 0; n < count; n += 1) {
    const dot = document.createElement('i');
    const angle = (n / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = (big ? 70 : 34) + Math.random() * (big ? 110 : 30);
    const size = 5 + Math.random() * (big ? 7 : 4);
    dot.className = 'celebrate-dot';
    dot.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${colors[n % colors.length]};`
      + `--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist + (big ? 40 : 10)}px;--rot:${Math.random() * 360}deg;`
      + `border-radius:${n % 3 ? '50%' : '2px'};animation-delay:${Math.random() * 40}ms`;
    layer.append(dot);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), big ? 1200 : 800);
}

// at: das angetippte Kästchen oder dessen Lage (getBoundingClientRect – vor dem Neuzeichnen gelesen),
// big: ganze Liste erledigt
export function celebrate(at, { big = false } = {}) {
  const mode = celebrateMode();
  if (mode === 'off' || !at) return;
  const rect = at instanceof Element ? at.getBoundingClientRect() : at;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) burst(rect, big);
  if (mode === 'all') chime(big);
  navigator.vibrate?.(big ? [15, 60, 25] : 15);
}
