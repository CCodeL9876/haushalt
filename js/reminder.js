// Morgen-Erinnerung (ToDo): jeden Morgen zur gewählten Zeit eine Mitteilung mit den offenen ToDos einer Liste –
// fällig bis heute oder ohne Datum. Ist nichts offen, kommt keine. Pro Gerät eine Liste, Uhrzeit und Wochentage.
// Verschickt die Supabase-Funktion „push“; hier wird eingestellt (js/push.js speichert es in Supabase).
// Bei einer persönlichen Liste hinterlegt die App deren offene ToDos lesbar in Supabase – sonst wüsste der Server
// nicht, was drinsteht. Das wird beim Einrichten gesagt und hier bei jeder Änderung nachgeführt.

import { state } from './store.js';
import { onPersonalChange, personal } from './personal.js';
import { currentSubscription, enablePush, isIos, isStandalone, permission, pushConfigured, pushSupported, reminderItems, saveTodoReminder, testTodoReminder, todoReminder } from './push.js';
import { currentMember } from './login.js';
import { closeSheet, esc, icon, openSheet, toast } from './ui.js';

const DAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [7, 'So']];
const DEFAULT = { time: '07:45', days: [1, 2, 3, 4, 5] };

const listsOf = (scope) => (scope === 'personal' ? personal().lists : state.todolists);
const listName = (r) => listsOf(r.scope).find((l) => l.id === r.listId)?.name || '';

// Kurzbeschreibung für die Übersicht, z. B. „Haushalt · 7:45 · Mo–Fr“
export function reminderSummary() {
  const r = todoReminder();
  if (!r) return '';
  const name = listName(r) || 'Liste gelöscht';
  const days = r.days.join(',') === '1,2,3,4,5' ? 'Mo–Fr' : r.days.length === 7 ? 'täglich' : r.days.map((d) => DAYS[d - 1][1]).join(' ');
  return `${name} · ${r.time.replace(/^0/, '')} · ${days}`;
}

// Persönliche Liste: offene ToDos bei jeder Änderung in Supabase nachführen (kurz gesammelt)
let timer = null;
function uploadPersonal() {
  const r = todoReminder();
  if (r?.scope !== 'personal' || !pushConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    saveTodoReminder(r, { name: listName(r), items: reminderItems(personal().todos, r.listId) }).catch(() => { /* beim nächsten Mal */ });
  }, 1500);
}
onPersonalChange(uploadPersonal);

// Beim Start (js/app.js): die Erinnerung dieses Geräts erneut in Supabase hinterlegen. Nach einem neuen
// Zugangscode sind dort alle Geräte abgemeldet – so kommen nur die eigenen Geräte wieder dazu.
export function refreshReminder() {
  const r = todoReminder();
  if (!r || !pushConfigured()) return;
  saveTodoReminder(r, r.scope === 'personal' ? { name: listName(r), items: reminderItems(personal().todos, r.listId) } : {})
    .catch(() => { /* beim nächsten Start */ });
}

function form(r, enabled) {
  const option = (scope, l) => `<option value="${scope}:${esc(l.id)}" ${r?.scope === scope && r?.listId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`;
  const shared = state.todolists;
  const mine = personal().lists;
  const days = r?.days || DEFAULT.days;
  return `
    <p class="small" style="margin-top:0">Jeden Morgen eine Mitteilung mit den ToDos, die heute dran sind (fällig bis heute oder ohne Datum).
      Ist nichts offen, kommt keine. Antippen öffnet die Liste.</p>
    <label class="field"><span>Liste</span>
      <select class="select" name="list" required>
        <option value="">– Liste wählen –</option>
        ${shared.length ? `<optgroup label="Geteilt">${shared.map((l) => option('shared', l)).join('')}</optgroup>` : ''}
        ${mine.length ? `<optgroup label="Nur für mich">${mine.map((l) => option('personal', l)).join('')}</optgroup>` : ''}
      </select>
    </label>
    <p class="muted small personal-note" ${r?.scope === 'personal' ? '' : 'hidden'} style="margin:-6px 0 12px">
      ${icon('lock', 'icon-xs')} Bei einer persönlichen Liste werden deren offene ToDos (Titel, Datum, Zeit) lesbar in Supabase hinterlegt, damit die Mitteilung sie zeigen kann. Die anderen Listen bleiben privat.</p>
    <label class="field"><span>Uhrzeit</span>
      <input class="input" type="time" name="time" value="${esc(r?.time || DEFAULT.time)}" required>
    </label>
    <div class="field"><span>Tage</span>
      <div class="chips">${DAYS.map(([n, label]) => `
        <label class="chip chip-toggle"><input type="checkbox" name="day" value="${n}" ${days.includes(n) ? 'checked' : ''}>${label}</label>`).join('')}
      </div>
    </div>
    ${enabled ? '' : `<p class="small amount-minus">Mitteilungen sind auf diesem Gerät noch aus – „Speichern“ fragt nach der Erlaubnis.</p>`}`;
}

export async function openReminder() {
  if (!pushConfigured()) {
    return openSheet({ title: 'Morgen-Erinnerung', body: '<p class="small">Mitteilungen gehen nur im gemeinsamen Haushalt mit Supabase (ANLEITUNG.md, „Push-Mitteilungen“).</p>' });
  }
  if (!pushSupported()) {
    return openSheet({
      title: 'Morgen-Erinnerung',
      body: `<p class="small">${isIos() && !isStandalone()
        ? 'Am iPhone gehen Mitteilungen nur in der App vom Home-Bildschirm: in Safari unten auf Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen (ab iOS 16.4).'
        : 'Dieser Browser kann keine Mitteilungen empfangen.'}</p>`,
    });
  }
  const r = todoReminder();
  const enabled = Boolean(await currentSubscription()) && permission() === 'granted';
  const sheet = openSheet({
    title: 'Morgen-Erinnerung',
    body: form(r, enabled),
    submitLabel: 'Speichern',
    footer: r ? `
      <div class="row">
        <button type="button" class="btn" data-sheet-action="test">${icon('bell', 'icon-sm')} Probe</button>
        <button type="button" class="btn" data-sheet-action="off">Ausschalten</button>
      </div>` : '',
    onSubmit(data, f) {
      const [scope, listId] = String(data.get('list') || '').split(':');
      const days = data.getAll('day').map(Number).sort();
      if (!listId) { toast('Bitte eine Liste wählen'); return false; }
      if (!days.length) { toast('Mindestens einen Tag wählen'); return false; }
      const reminder = { scope, listId, time: String(data.get('time')), days };
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      // Erlaubnis zuerst und ohne Umweg – das iPhone fragt nur direkt nach einem Antippen
      const ready = enabled ? Promise.resolve() : enablePush(currentMember()?.id);
      ready
        .then(() => saveTodoReminder(reminder, scope === 'personal' ? { name: listName(reminder), items: reminderItems(personal().todos, listId) } : {}))
        .then(() => {
          closeSheet();
          toast(`Morgen-Erinnerung: ${reminderSummary()}`);
          document.dispatchEvent(new Event('reminderchange'));
        })
        .catch((err) => toast(err.message))
        .finally(() => { btn.disabled = false; });
      return false;
    },
    actions: {
      async test(btn) {
        btn.disabled = true;
        try {
          const res = await testTodoReminder();
          toast(res.empty ? 'Heute ist in dieser Liste nichts fällig – es käme keine Mitteilung.' : 'Probe verschickt');
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
      },
      async off() {
        try {
          await saveTodoReminder(null);
          closeSheet();
          toast('Morgen-Erinnerung ausgeschaltet');
          document.dispatchEvent(new Event('reminderchange'));
        } catch (err) {
          toast(err.message);
        }
      },
      change(el, f) {
        if (el.name === 'list') f.querySelector('.personal-note').hidden = !el.value.startsWith('personal:');
      },
    },
  });
  return sheet;
}
