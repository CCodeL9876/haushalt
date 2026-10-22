// Erinnerung vor einem ToDo: Hat ein ToDo Datum, Uhrzeit und „Erinnern“ (alarm = Minuten vorher), kommt zur Zeit
// eine Mitteilung (Funktion „push“, Tabelle push_alarms in schema.sql). Diese Datei hält push_alarms auf dem Stand
// der ToDos: Nach jeder Änderung wird verglichen, was zuletzt hinterlegt wurde, und nur der Unterschied geschickt.
//   geteilte ToDos: an die zugewiesene Person, sonst an alle im Haushalt (jedes Gerät gleicht gleich ab – doppelt
//                   schadet nicht, die id ist dieselbe)
//   persönliche ToDos: nur an mich; Titel und Zeit liegen dafür lesbar in Supabase, bis die Mitteilung kam
// Ohne Mitteilungen im Haushalt (pushConfigured) passiert nichts.

import { session, state, subscribe } from './store.js';
import { onPersonalChange, owner, personal } from './personal.js';
import { myMemberId } from './session.js';
import { clearAlarm, pushConfigured, setAlarm } from './push.js';
import { addDays, dateKey, fmtShort } from './dates.js';

export const ALARM_CHOICES = [[0, 'Nicht erinnern'], [5, '5 Minuten vorher'], [15, '15 Minuten vorher'], [30, '30 Minuten vorher'], [60, '1 Stunde vorher'], [1440, '1 Tag vorher']];
export const alarmLabel = (min) => (min >= 1440 ? '1 Tag vorher' : min >= 60 ? '1 Std. vorher' : `${min} Min. vorher`);

const SNAP = 'haushalt.alarms.';

// Zeitpunkt der Mitteilung: Datum und Uhrzeit in Ortszeit minus Vorlauf
export function alarmAt(t) {
  if (!t.alarm || !t.due || !t.time) return null;
  const at = new Date(`${t.due}T${t.time}:00`);
  return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() - t.alarm * 60000);
}

// Text der Mitteilung, gesehen vom Zeitpunkt der Mitteilung aus (nicht vom Abgleich): „Heute um 17:30 · in 15 Minuten“
function body(t, at) {
  const day = dateKey(at) === t.due ? 'Heute' : dateKey(addDays(at, 1)) === t.due ? 'Morgen' : fmtShort(t.due);
  return `${day} um ${t.time}${t.alarm < 1440 ? ` · in ${t.alarm >= 60 ? '1 Stunde' : `${t.alarm} Minuten`}` : ''}`;
}

// Was jetzt hinterlegt sein soll: id → Erinnerung
function wanted() {
  const out = new Map();
  const add = (t, scope, member) => {
    const at = alarmAt(t);
    // Vergangenes nicht mehr hinterlegen (eine Stunde Spielraum, falls ein Gerät spät abgleicht)
    if (t.done || !at || at.getTime() < Date.now() - 3600000) return;
    out.set(t.id, { id: t.id, member, at: at.toISOString(), title: String(t.title).slice(0, 160), body: body(t, at), url: `#todo/${scope}/${t.listId}` });
  };
  const lists = new Set(state.todolists.map((l) => l.id));
  for (const t of state.todos) if (lists.has(t.listId)) add(t, 'shared', t.assignee || '');
  const mine = personal();
  const myLists = new Set(mine.lists.map((l) => l.id));
  const me = myMemberId(session.key) || '';
  if (me) for (const t of mine.todos) if (myLists.has(t.listId)) add(t, 'personal', me);
  return out;
}

const readSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP + owner()) || '{}'); } catch { return {}; } };
const writeSnap = (s) => { try { localStorage.setItem(SNAP + owner(), JSON.stringify(s)); } catch { /* privates Fenster */ } };

let timer = null;
let running = false;
async function sync() {
  if (!pushConfigured() || session.offline || running) return;
  running = true;
  try {
    const snap = readSnap();
    const next = wanted();
    for (const [id, a] of next) {
      const sig = JSON.stringify(a);
      if (snap[id] === sig) continue;
      await setAlarm(a);
      snap[id] = sig;
    }
    for (const id of Object.keys(snap)) {
      if (next.has(id)) continue;
      await clearAlarm(id);
      delete snap[id];
    }
    writeSnap(snap);
  } catch {
    // Datenbank noch ohne push_alarms (schema.sql) oder offline: beim nächsten Mal
  } finally {
    running = false;
  }
}

// Kurz gesammelt nach jeder Änderung (auch von anderen Geräten) und beim Start
export function scheduleAlarmSync() {
  clearTimeout(timer);
  timer = setTimeout(sync, 1500);
}
subscribe(scheduleAlarmSync);
onPersonalChange(scheduleAlarmSync);
