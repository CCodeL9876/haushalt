// Tagesübersicht am Morgen: jeden Morgen zur gewählten Zeit eine Mitteilung mit dem, was heute wichtig ist –
// Menü, fällige geteilte ToDos (für alle oder mir zugewiesen), Abfuhr heute/morgen, was im Kühlschrank weg muss.
// Pro Gerät Uhrzeit und Wochentage. Den Inhalt stellt die Supabase-Funktion „push“ aus den Haushaltsdaten zusammen;
// persönliche ToDos, private Kalender und die Planung bleiben auf dem Gerät und kommen darum nicht vor.
// Antippen öffnet die Startseite mit allem.

import { briefSetting, currentSubscription, enablePush, isIos, isStandalone, permission, pushConfigured, pushSupported, saveBrief, testBrief } from './push.js';
import { currentMember } from './login.js';
import { closeSheet, esc, icon, openSheet, toast } from './ui.js';

const DAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [7, 'So']];
const DEFAULT = { time: '07:00', days: [1, 2, 3, 4, 5, 6, 7] };

// Kurzbeschreibung, z. B. „7:00 · täglich“
export function briefSummary() {
  const b = briefSetting();
  if (!b) return '';
  const days = b.days.length === 7 ? 'täglich' : b.days.join(',') === '1,2,3,4,5' ? 'Mo–Fr' : b.days.map((d) => DAYS[d - 1][1]).join(' ');
  return `${b.time.replace(/^0/, '')} · ${days}`;
}

// Beim Start (js/app.js): erneut in Supabase hinterlegen – nach einem neuen Zugangscode sind dort alle Geräte abgemeldet
export function refreshBrief() {
  const b = briefSetting();
  if (b && pushConfigured()) saveBrief(b).catch(() => { /* beim nächsten Start */ });
}

export async function openBrief() {
  const title = 'Tagesübersicht am Morgen';
  if (!pushConfigured()) {
    return openSheet({ title, body: '<p class="small">Mitteilungen gehen nur im gemeinsamen Haushalt mit Supabase (ANLEITUNG.md, „Push-Mitteilungen“).</p>' });
  }
  if (!pushSupported()) {
    return openSheet({
      title,
      body: `<p class="small">${isIos() && !isStandalone()
        ? 'Am iPhone gehen Mitteilungen nur in der App vom Home-Bildschirm: in Safari unten auf Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen (ab iOS 16.4).'
        : 'Dieser Browser kann keine Mitteilungen empfangen.'}</p>`,
    });
  }
  const b = briefSetting();
  const enabled = Boolean(await currentSubscription()) && permission() === 'granted';
  const days = b?.days || DEFAULT.days;
  return openSheet({
    title,
    body: `
      <p class="small" style="margin-top:0">Jeden Morgen eine Mitteilung mit dem, was heute wichtig ist:</p>
      <ul class="small brief-list">
        <li>🍽️ Menü von heute</li>
        <li>✅ ToDos, die heute dran sind (geteilte – für alle oder dir zugewiesen)</li>
        <li>🗑️ Abfuhr heute oder morgen</li>
        <li>🧊 Was im Kühlschrank heute weg muss</li>
      </ul>
      <p class="muted small" style="margin:0 0 12px">${icon('lock', 'icon-xs')} Persönliche ToDos, private Kalender und die Planung bleiben auf diesem Gerät und kommen darum nicht vor – die siehst du nach dem Antippen auf der Startseite.</p>
      <label class="field"><span>Uhrzeit</span>
        <input class="input" type="time" name="time" value="${esc(b?.time || DEFAULT.time)}" required>
      </label>
      <div class="field"><span>Tage</span>
        <div class="chips">${DAYS.map(([n, label]) => `
          <label class="chip chip-toggle"><input type="checkbox" name="day" value="${n}" ${days.includes(n) ? 'checked' : ''}>${label}</label>`).join('')}
        </div>
      </div>
      ${enabled ? '' : '<p class="small amount-minus">Mitteilungen sind auf diesem Gerät noch aus – „Speichern“ fragt nach der Erlaubnis.</p>'}`,
    submitLabel: 'Speichern',
    footer: b ? `
      <div class="row">
        <button type="button" class="btn" data-sheet-action="test">${icon('bell', 'icon-sm')} Probe</button>
        <button type="button" class="btn" data-sheet-action="off">Ausschalten</button>
      </div>` : '',
    onSubmit(data, f) {
      const picked = data.getAll('day').map(Number).sort();
      if (!picked.length) { toast('Mindestens einen Tag wählen'); return false; }
      const brief = { time: String(data.get('time')), days: picked };
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      // Erlaubnis zuerst und ohne Umweg – das iPhone fragt nur direkt nach einem Antippen
      (enabled ? Promise.resolve() : enablePush(currentMember()?.id))
        .then(() => saveBrief(brief))
        .then(() => {
          closeSheet();
          toast(`Tagesübersicht: ${briefSummary()}`);
        })
        .catch((err) => toast(err.message))
        .finally(() => { btn.disabled = false; });
      return false;
    },
    actions: {
      async test(btn) {
        btn.disabled = true;
        try {
          await testBrief();
          toast('Probe verschickt – kommt in ein paar Sekunden');
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
      },
      async off() {
        try {
          await saveBrief(null);
          closeSheet();
          toast('Tagesübersicht ausgeschaltet');
        } catch (err) {
          toast(err.message);
        }
      },
    },
  });
}
