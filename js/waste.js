// Abfuhrkalender: Termine der Gemeinde (Kehricht, Papier, Grüngut …) aus einer Kalender-Datei (.ics), für den ganzen
// Haushalt. Die Startseite zeigt pro Art den nächsten Termin (js/views/heute.js); auf Wunsch kommt am Vortag um
// 18 Uhr eine Mitteilung (Funktion „push“, supabase/functions/push).
// Gespeichert in state.settings.waste = { kinds: [{ id, name, short, dates: ['JJJJ-MM-TT', …], remind }], file, importedAt }
// – nur Termine ab dem Tag des Einlesens; vergangene werden beim Anzeigen übergangen.

import { state, update } from './store.js';
import { pushConfigured } from './push.js';
import { parseIcs } from './repeat.js';
import { addDays, dateKey, fmtShort, todayKey } from './dates.js';
import { closeSheet, esc, icon, openSheet, toast } from './ui.js';

// „Kehrichtabfuhr“ → „Kehricht“, „Grünabfuhr“ → „Grüngut“, „Papiersammlung“ → „Papier“
export function shortName(name) {
  const s = String(name || '').replace(/\s*(abfuhr|sammlung|entsorgung|abholung)\b.*$/i, '').trim() || String(name || '').trim();
  return /^grün$/i.test(s) ? 'Grüngut' : s;
}

export const wasteKinds = () => state.settings.waste?.kinds || [];

// Nächster Termin pro Art (heute oder später), früheste zuerst
export function nextPickups(today = todayKey()) {
  return wasteKinds()
    .map((k) => ({ ...k, next: k.dates.find((d) => d >= today) || '' }))
    .filter((k) => k.next)
    .sort((a, b) => a.next.localeCompare(b.next) || a.short.localeCompare(b.short, 'de'));
}

// Letzter Termin im Kalender – danach (bzw. kurz davor) braucht es die Datei fürs nächste Jahr
export const lastPickup = () => wasteKinds().flatMap((k) => k.dates).sort().at(-1) || '';

export function dayLabel(day, today = todayKey()) {
  if (day === today) return 'heute';
  if (day === dateKey(addDays(new Date(`${today}T12:00:00`), 1))) return 'morgen';
  return fmtShort(day);
}

// App-Einstellungen → Abfuhrkalender: Übersicht, Erinnerung pro Art, neue Datei, entfernen
export function openWaste() {
  const kinds = wasteKinds();
  const today = todayKey();
  const canPush = pushConfigured();
  openSheet({
    title: 'Abfuhrkalender',
    body: kinds.length ? `
      <p class="muted small" style="margin-top:0">Gilt für alle im Haushalt. Die Startseite zeigt pro Art den nächsten Termin.</p>
      <ul class="list" style="margin-bottom:12px">${kinds.map((k) => {
        const left = k.dates.filter((d) => d >= today);
        return `<li><span class="list-main">${esc(k.short)}<small>${left.length ? `nächster ${esc(dayLabel(left[0], today))} · noch ${left.length} ${left.length === 1 ? 'Termin' : 'Termine'}` : 'keine Termine mehr'}</small></span>
          ${canPush ? `<label class="waste-remind" title="Mitteilung am Vortag um 18 Uhr"><input type="checkbox" name="remind" value="${esc(k.id)}" ${k.remind ? 'checked' : ''}>${icon('bell', 'icon-sm')}</label>` : ''}
        </li>`;
      }).join('')}</ul>
      ${canPush ? '<p class="muted small" style="margin:-4px 0 12px">Glocke = Mitteilung am Vortag um 18 Uhr an alle im Haushalt, die Mitteilungen eingeschaltet haben.</p>' : ''}
      <p class="muted small" style="margin:0 0 8px">Termine bis ${esc(fmtShort(lastPickup()))}${state.settings.waste?.file ? ` · aus „${esc(state.settings.waste.file)}“` : ''}</p>
      <label class="btn btn-block">${icon('calendar', 'icon-sm')} Neue Datei einlesen<input type="file" name="ics" accept=".ics,text/calendar" hidden></label>`
      : `
      <p class="small" style="margin-top:0">Die Kalender-Datei (.ics) der Gemeinde einlesen – meist auf der Webseite der Gemeinde oder in deren Abfall-App unter „Kalender exportieren“.</p>
      <p class="muted small">Eingelesen werden nur Termine ab heute. Danach zeigt die Startseite pro Art (Kehricht, Papier, Grüngut …) den nächsten Termin.</p>
      <label class="btn btn-primary btn-block">${icon('calendar', 'icon-sm')} Kalender-Datei wählen<input type="file" name="ics" accept=".ics,text/calendar" hidden></label>`,
    footer: kinds.length ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Abfuhrkalender entfernen</button>' : '',
    actions: {
      async change(el) {
        if (el.name === 'remind') {
          update((s) => {
            const k = s.settings.waste?.kinds.find((x) => x.id === el.value);
            if (k) k.remind = el.checked;
          });
          return;
        }
        if (el.name !== 'ics' || !el.files[0]) return;
        const file = el.files[0];
        const groups = parseIcs(await file.text(), todayKey());
        if (!groups.length) return toast('Keine kommenden Termine in der Datei gefunden');
        preview(groups, file.name);
      },
      remove() {
        if (!confirm('Abfuhrkalender für alle im Haushalt entfernen?')) return;
        update((s) => { delete s.settings.waste; });
        closeSheet();
      },
    },
  });
}

// Vorschau nach dem Einlesen: welche Arten übernehmen, welche mit Erinnerung am Vortag
function preview(groups, fileName) {
  const canPush = pushConfigured();
  const old = new Map(wasteKinds().map((k) => [k.name, k]));
  openSheet({
    title: 'Abfuhrkalender übernehmen',
    body: `
      <p class="muted small" style="margin:0 0 10px">${groups.reduce((n, g) => n + g.dates.length, 0)} Termine ab heute gefunden.</p>
      <div class="pick-list">${groups.map((g, n) => `
        <div class="pick-row waste-row">
          <label class="waste-pick"><input type="checkbox" name="g${n}" checked>
            <span class="list-main">${esc(shortName(g.title))}<small>${g.dates.length} ${g.dates.length === 1 ? 'Termin' : 'Termine'} · nächster ${esc(dayLabel(g.dates[0]))}${g.title !== shortName(g.title) ? ` · „${esc(g.title)}“` : ''}</small></span>
          </label>
          ${canPush ? `<label class="waste-remind" title="Mitteilung am Vortag um 18 Uhr"><input type="checkbox" name="r${n}" ${(old.get(g.title)?.remind ?? true) ? 'checked' : ''}>${icon('bell', 'icon-sm')}</label>` : ''}
        </div>`).join('')}
      </div>
      ${canPush ? '<p class="muted small" style="margin:10px 0 0">Glocke = Mitteilung am Vortag um 18 Uhr an alle im Haushalt mit Mitteilungen.</p>' : ''}
      ${wasteKinds().length ? '<p class="muted small" style="margin:8px 0 0">Ersetzt den bisherigen Abfuhrkalender.</p>' : ''}`,
    submitLabel: 'Übernehmen',
    onSubmit(data) {
      const kinds = groups
        .map((g, n) => ({ g, n }))
        .filter(({ n }) => data.get(`g${n}`))
        .map(({ g, n }) => ({
          id: g.title.toLowerCase().replace(/[^a-z0-9äöü]+/g, '-').slice(0, 40),
          name: g.title,
          short: shortName(g.title),
          dates: g.dates,
          remind: canPush ? Boolean(data.get(`r${n}`)) : false,
        }));
      if (!kinds.length) return false;
      update((s) => { s.settings.waste = { kinds, file: String(fileName || '').slice(0, 80), importedAt: Date.now() }; });
      toast(`Abfuhrkalender: ${kinds.map((k) => k.short).join(', ')}`);
    },
  });
}
