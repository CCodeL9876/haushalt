// ToDo-Listen: geteilte (für den ganzen Haushalt, in state.todolists/todos) und persönliche (nur auf diesem
// Gerät, js/personal.js). Übersicht aller Listen → Antippen öffnet eine Liste. Ein ToDo mit Datum lässt sich
// in den Apple-Kalender eintragen (js/calendar.js). ToDos in geteilten Listen lassen sich einer Person zuweisen.

import { memberById, refresh, state, update, uid } from '../store.js';
import { disableSync, enableSync, personal, remoteCopyExists, syncAvailable, syncEnabled, syncWasLost, updatePersonal } from '../personal.js';
import { addToCalendar, isInCalendar } from '../calendar.js';
import { openReminder, reminderSummary } from '../reminder.js';
import { notifyAssigned, pushConfigured } from '../push.js';
import { ALARM_CHOICES, alarmLabel } from '../alarms.js';
import { celebrate } from '../celebrate.js';
import { ADDONS, combinedItems, fromTemplate, newPackItem, packActions, packInfo, packPicker, packPickerActions, packSource, packView, saveTemplate, templates } from '../packliste.js';
import { avatar, closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { currentMember } from '../login.js';
import { addDays, dateKey, fmtShort, todayKey } from '../dates.js';
import { REPEAT_CHOICES, formatDates, nextDue, parseDates, parseIcs, repeatChoice, repeatFromChoice, repeatLabel } from '../repeat.js';

// Beide Arten gleich behandeln: d = { lists, todos }; Zuweisungen an d.lists/d.todos werden übernommen
const SCOPES = {
  shared: {
    data: () => ({ lists: state.todolists, todos: state.todos }),
    change: (fn) => update((s) => {
      const d = { lists: s.todolists, todos: s.todos };
      fn(d);
      s.todolists = d.lists;
      s.todos = d.todos;
    }),
  },
  personal: { data: personal, change: updatePersonal },
};

// { scope, id } der geöffneten Liste, sonst Übersicht. Bleibt beim Aktualisieren der App erhalten (sessionStorage:
// gilt nur für dieses Fenster und verschwindet, wenn die App ganz geschlossen wird).
const OPEN_KEY = 'haushalt.todoOpen';
let open = (() => {
  try {
    const o = JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null');
    return o && (o.scope === 'shared' || o.scope === 'personal') && typeof o.id === 'string' ? o : null;
  } catch {
    return null;
  }
})();
function setOpen(value) {
  open = value;
  try {
    if (value) sessionStorage.setItem(OPEN_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(OPEN_KEY);
  } catch { /* privates Fenster */ }
}

// Offene zuerst nach Datum (ohne Datum zuletzt), dann die neuesten
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || (b.addedAt || 0) - (a.addedAt || 0);
// In der Liste: selbst angeordnete zuerst in ihrer Reihenfolge (order), die übrigen nach Datum
const orderOf = (t) => (Number.isFinite(t.order) ? t.order : Infinity);
const byOrder = (a, b) => (orderOf(a) === orderOf(b) ? byDue(a, b) : orderOf(a) < orderOf(b) ? -1 : 1);
let arrangingTodos = false; // ToDos der geöffneten Liste werden gerade angeordnet

// ToDo um eine Stelle verschieben und die Reihenfolge aller offenen ToDos der Liste festhalten
function moveTodo(cur, id, dir) {
  cur.change((d) => {
    const items = d.todos.filter((t) => t.listId === cur.list.id && !t.done).sort(byOrder);
    const i = items.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    items.forEach((t, n) => { t.order = n; });
  });
}

function dueLabel(t) {
  if (!t.due) return '';
  const today = todayKey();
  const day = t.due === today ? 'Heute' : t.due === dateKey(addDays(new Date(), 1)) ? 'Morgen' : fmtShort(t.due);
  return `${day}${t.time ? ` · ${t.time}` : ''}`;
}

const overdue = (t) => !t.done && t.due && t.due < todayKey();

// Abhaken bzw. wieder öffnen – auch von der Startseite „Heute“ (js/views/heute.js).
// Wiederkehrend: statt erledigt mit dem nächsten Datum wieder offen.
// el: das angetippte Kästchen – beim Abhaken gibt es dort einen kleinen Effekt mit Ton (js/celebrate.js),
// einen grösseren, wenn damit die ganze Liste erledigt ist
export function toggleTodo(scope, id, el) {
  const at = el?.getBoundingClientRect(); // vor dem Neuzeichnen der Liste
  let cheer = null;
  SCOPES[scope]?.change((d) => {
    const t = d.todos.find((x) => x.id === id);
    if (!t) return;
    const next = !t.done && nextDue(t, todayKey());
    if (next) {
      t.due = next;
      if (t.repeat.dates) t.repeat.dates = t.repeat.dates.filter((x) => x >= next);
      toast(`${t.title}: nächstes Mal ${fmtShort(next)}`);
      cheer = { big: false };
      return;
    }
    t.done = !t.done;
    if (t.done) {
      t.doneAt = Date.now();
      cheer = { big: !d.todos.some((x) => x.listId === t.listId && !x.done) };
    } else delete t.doneAt;
  });
  if (cheer) celebrate(at, cheer);
}

// ---------- Übersicht ----------

// Reihenfolge der Listen: selbst gewählt (order), sonst in der Reihenfolge des Anlegens
const listOrder = (l) => (Number.isFinite(l.order) ? l.order : 1e6 + (l.createdAt || 0) / 1e9);
const sortedLists = (lists) => [...lists].sort((a, b) => listOrder(a) - listOrder(b));
let arranging = null; // 'shared' | 'personal' – Abschnitt, dessen Listen gerade angeordnet werden

// Liste um eine Stelle verschieben und die Reihenfolge aller Listen dieses Abschnitts festhalten
function moveList(scope, id, dir) {
  SCOPES[scope].change((d) => {
    const lists = sortedLists(d.lists);
    const i = lists.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lists.length) return;
    [lists[i], lists[j]] = [lists[j], lists[i]];
    lists.forEach((l, n) => { l.order = n; });
  });
}

function listRow(scope, list, todos, pos = {}) {
  const pack = list.kind === 'pack' ? packInfo(list, todos) : null;
  const items = pack ? todos.filter((t) => t.listId === list.id && !t.done) : todos.filter((t) => t.listId === list.id && !t.done).sort(byDue);
  const next = !pack && items.find((t) => t.due);
  const info = pack ? `🧳 ${pack.text}` : [
    items.length ? `${items.length} offen` : 'Alles erledigt',
    next ? `nächstes: ${dueLabel(next)}` : '',
  ].filter(Boolean).join(' · ');
  // Beim Anordnen: Pfeile statt Öffnen
  if (arranging === scope) {
    return `
    <li class="list-tile is-arranging">
      <div class="tile-row">
        <span class="tile-main"><strong>${esc(list.name)}</strong><small>${esc(info)}</small></span>
        <button type="button" class="icon-btn" data-action="moveList" data-scope="${scope}" data-id="${list.id}" data-dir="-1" aria-label="${esc(list.name)} nach oben"${pos.first ? ' disabled' : ''}>${icon('up', 'icon-sm')}</button>
        <button type="button" class="icon-btn" data-action="moveList" data-scope="${scope}" data-id="${list.id}" data-dir="1" aria-label="${esc(list.name)} nach unten"${pos.last ? ' disabled' : ''}>${icon('down', 'icon-sm')}</button>
      </div>
    </li>`;
  }
  // Farbige Kachel (Farbe reihum, css: .list-tile) – hebt sich von den hellen ToDo-Punkten ab
  return `
    <li class="list-tile">
      <button type="button" data-action="openList" data-scope="${scope}" data-id="${list.id}">
        <span class="tile-count" aria-label="${items.length} offen">${items.length || icon('check', 'icon-sm')}</span>
        <span class="tile-main"><strong>${esc(list.name)}</strong><small class="${items.some(overdue) ? 'tile-overdue' : ''}">${esc(info)}</small></span>
        ${icon('right', 'icon-sm')}
      </button>
    </li>`;
}

function overview() {
  const shared = SCOPES.shared.data();
  const mine = SCOPES.personal.data();
  const section = (scope, d, title, hint) => {
    const lists = sortedLists(d.lists);
    const tools = arranging === scope
      ? `<button type="button" class="btn btn-primary btn-sm" data-action="arrange" data-scope="">Fertig</button>`
      : `${lists.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-action="arrange" data-scope="${scope}" aria-label="Listen anordnen">${icon('sort', 'icon-sm')}<span class="btn-label"> Anordnen</span></button>` : ''}
         <button type="button" class="btn btn-ghost btn-sm" data-action="newList" data-scope="${scope}">${icon('plus', 'icon-sm')} Neue Liste</button>`;
    return `
    <h2 class="section-title">${title}<span class="title-tools">${tools}</span></h2>
    <p class="muted small todo-hint">${icon(scope === 'personal' ? 'lock' : 'users', 'icon-sm')}${arranging === scope ? 'Mit den Pfeilen verschieben, dann „Fertig“' : hint}</p>
    ${lists.length
      ? `<ul class="list-tiles list-tiles-${scope}">${lists.map((l, n) => listRow(scope, l, d.todos, { first: n === 0, last: n === lists.length - 1 })).join('')}</ul>`
      : `<button type="button" class="todo-empty" data-action="newList" data-scope="${scope}">Noch keine Liste – hier eine anlegen</button>`}`;
  };
  return `
    ${section('shared', shared, 'Geteilt', 'Für alle im Haushalt')}
    ${section('personal', mine, 'Nur für mich', syncEnabled() ? 'Nur für dich – verschlüsselt auf deinen Geräten' : 'Nur für dich – auf diesem Gerät')}
    ${syncWasLost() ? '<p class="small amount-minus todo-hint">Auf einem anderen Gerät wurde ein neues Passwort gesetzt. Abgleich hier neu einrichten.</p>' : ''}
    ${syncAvailable() ? `<button type="button" class="btn btn-ghost btn-sm todo-sync" data-action="sync">${icon('refresh', 'icon-sm')} ${syncEnabled() ? 'Abgleich verwalten' : 'Auf meinen Geräten abgleichen'}</button>` : ''}
    ${pushConfigured() ? `
      <button type="button" class="reminder-row" data-action="reminder">
        ${icon('bell')}
        <span><strong>Morgen-Erinnerung</strong><small>${esc(reminderSummary() || 'Jeden Morgen die ToDos einer Liste als Mitteilung')}</small></span>
        ${icon('right', 'icon-sm')}
      </button>` : ''}`;
}

// Neue Liste: Name abfragen, dann gleich öffnen
function newList(scope) {
  const form = openSheet({
    title: scope === 'personal' ? 'Neue persönliche Liste' : 'Neue geteilte Liste',
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" required maxlength="60" autocomplete="off" placeholder="${scope === 'personal' ? 'z. B. Geschenke, Arbeit' : 'z. B. Putzplan, Ferien'}">
      </label>
      <p class="muted small" style="margin:0 0 12px">${scope === 'personal' ? 'Nur du siehst diese Liste.' : 'Alle im Haushalt sehen und bearbeiten diese Liste.'}</p>
      <div class="seg seg-wide" role="radiogroup" aria-label="Listenart">
        <label class="seg-btn"><input type="radio" name="kind" value="todo" checked>${icon('check', 'icon-sm')} ToDo</label>
        <label class="seg-btn"><input type="radio" name="kind" value="pack">🧳 Packliste</label>
      </div>
      <div class="pack-new" hidden>
        <p class="muted small" style="margin:-4px 0 12px">Gepacktes bleibt sichtbar, nach Kategorien, mit „Neu packen“ für die nächste Reise.</p>
        ${packPicker()}
      </div>`,
    submitLabel: 'Anlegen',
    actions: {
      change(el, f) {
        if (el.name === 'kind') f.querySelector('.pack-new').hidden = el.value !== 'pack';
        packPickerActions.change(el, f);
      },
      days: packPickerActions.days,
    },
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) return false;
      const id = uid();
      const pack = data.get('kind') === 'pack';
      const items = pack ? combinedItems(data.get('template'), data.getAll('addon')) : [];
      const days = Math.min(90, Math.max(0, Math.round(Number(data.get('days')) || 0)));
      setOpen({ scope, id }); // gleich die neue Liste zeigen
      SCOPES[scope].change((d) => {
        // ans Ende der selbst gewählten Reihenfolge
        const max = Math.max(-1, ...d.lists.map((l) => (Number.isFinite(l.order) ? l.order : -1)));
        d.lists.push({ id, name: name.slice(0, 60), createdAt: Date.now(), ...(max >= 0 ? { order: max + 1 } : {}), ...(pack ? { kind: 'pack', days } : {}) });
        if (items.length) d.todos.push(...fromTemplate({ items }, id));
      });
      window.scrollTo(0, 0);
      setTimeout(() => document.getElementById('todo-input')?.focus());
    },
  });
  packPickerActions.init(form);
  form.elements.name.focus();
}

// ---------- Persönliche Listen auf mehreren Geräten (verschlüsselt, js/personal.js) ----------

function syncSheet() {
  if (syncEnabled()) {
    openSheet({
      title: 'Abgleich',
      body: `
        <p class="small">Deine persönlichen Listen werden auf deinen Geräten abgeglichen. In der Datenbank liegen sie nur
        verschlüsselt mit deinem Passwort – die anderen im Haushalt können sie nicht lesen.</p>
        <p class="muted small">Auf einem weiteren Gerät: dort unter ToDo „Auf meinen Geräten abgleichen“ wählen und dasselbe Passwort eingeben.</p>`,
      footer: `
        <button type="button" class="btn btn-block" data-sheet-action="off">Abgleich auf diesem Gerät beenden</button>
        <button type="button" class="btn btn-danger btn-block" data-sheet-action="wipe">Beenden und Kopie in der Datenbank löschen</button>`,
      actions: {
        async off() {
          await disableSync();
          closeSheet();
          toast('Abgleich beendet – die Listen bleiben auf diesem Gerät');
        },
        async wipe() {
          if (!confirm('Die verschlüsselte Kopie in der Datenbank löschen? Deine anderen Geräte gleichen dann nicht mehr ab; ihre Listen bleiben dort.')) return;
          try {
            await disableSync({ removeRemote: true });
            closeSheet();
            toast('Abgleich beendet, Kopie gelöscht');
          } catch {
            toast('Gerade keine Verbindung – später nochmals versuchen');
          }
        },
      },
    });
    return;
  }
  const existing = remoteCopyExists();
  const form = openSheet({
    title: 'Auf meinen Geräten abgleichen',
    body: `
      <p class="small" style="margin-top:0">Deine persönlichen Listen werden mit einem <strong>eigenen Passwort</strong> verschlüsselt und so
      über die Datenbank auf deine anderen Geräte gebracht. Die anderen im Haushalt sehen nur unlesbaren Text.</p>
      <label class="field"><span>${existing ? 'Passwort von deinem anderen Gerät' : 'Neues Passwort (mindestens 8 Zeichen)'}</span>
        <input class="input" type="password" name="password" required minlength="8" autocomplete="${existing ? 'current-password' : 'new-password'}">
      </label>
      ${existing ? '' : `<label class="field"><span>Passwort wiederholen</span>
        <input class="input" type="password" name="repeat" required minlength="8" autocomplete="new-password">
      </label>`}
      <p class="muted small">Gut merken: Ohne das Passwort lässt sich die Kopie in der Datenbank nicht mehr öffnen. Die Listen auf diesem Gerät bleiben in jedem Fall.</p>
      <p class="small amount-minus sync-error" aria-live="polite"></p>`,
    submitLabel: 'Abgleich einschalten',
    footer: existing ? '<button type="button" class="btn btn-block" data-sheet-action="fresh" hidden>Passwort vergessen: neu beginnen</button>' : '',
    onSubmit(data, f) {
      const password = String(data.get('password'));
      if (!existing && password !== String(data.get('repeat'))) {
        f.querySelector('.sync-error').textContent = 'Die beiden Passwörter sind nicht gleich.';
        return false;
      }
      run(f, () => enableSync(password));
      return false;
    },
    actions: {
      fresh(_, f) {
        if (!confirm('Die alte Kopie in der Datenbank wird durch die Listen dieses Geräts ersetzt (mit dem eingegebenen Passwort). Deine anderen Geräte müssen danach dieses Passwort eingeben. Weiter?')) return;
        if (!f.reportValidity()) return;
        run(f, () => enableSync(String(f.elements.password.value), { replace: true }));
      },
    },
  });
  form.elements.password.focus();
}

async function run(form, task) {
  const btn = form.querySelector('button[type="submit"]');
  const error = form.querySelector('.sync-error');
  btn.disabled = true;
  btn.textContent = 'Wird verschlüsselt …';
  error.textContent = '';
  try {
    await task();
    closeSheet();
    toast('Abgleich eingeschaltet');
  } catch (err) {
    error.textContent = err.message;
    if (err.wrongPassword) form.querySelector('[data-sheet-action="fresh"]')?.removeAttribute('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Abgleich einschalten';
  }
}

// ---------- Eine Liste ----------

// Zugewiesene Person (nur geteilte Listen); gibt es sie nicht mehr, ist das ToDo für niemanden
const assignee = (t) => (t.assignee ? memberById(t.assignee) : null);

// Erinnerung am Vortag gibt es nur in geteilten Listen (die persönlichen kennt der Server nicht)
const remindShown = () => open?.scope === 'shared';

function todoItem(t) {
  const who = assignee(t);
  return `
  <li class="${t.done ? 'is-done' : ''}">
    <button type="button" class="check" data-action="toggle" data-id="${t.id}" aria-label="${t.done ? 'Wieder offen' : 'Erledigt'}: ${esc(t.title)}">${icon('check', 'icon-sm')}</button>
    <button type="button" class="list-main" data-action="edit" data-id="${t.id}" aria-label="${esc(t.title)}${who ? ` (für ${esc(who.name)})` : ''} bearbeiten">
      ${esc(t.title)}${t.note ? ` <span class="todo-note-mark" title="Mit Notiz" aria-label="mit Notiz">${icon('note', 'icon-xs')}</span>` : ''}
      ${t.due || t.repeat ? `<small>${[
        t.due ? `<span class="${overdue(t) ? 'amount-minus' : ''}">${esc(dueLabel(t))}</span>` : '',
        t.repeat && !t.done ? `<span class="todo-repeat">${icon('refresh', 'icon-xs')} ${esc(repeatLabel(t))}</span>` : '',
        t.remind && t.due && !t.done && remindShown() ? `<span class="todo-repeat" title="Erinnerung am Vortag">${icon('bell', 'icon-xs')} Vortag</span>` : '',
        t.alarm && t.time && !t.done ? `<span class="todo-repeat" title="Erinnerung vor dem ToDo">${icon('bell', 'icon-xs')} ${esc(alarmLabel(t.alarm))}</span>` : '',
      ].filter(Boolean).join(' · ')}</small>` : ''}
    </button>
    ${who ? `<span class="todo-who" title="Für ${esc(who.name)}">${avatar(who)}</span>` : ''}
    ${isInCalendar(t.id) ? `<span class="todo-cal" title="Im Kalender eingetragen">${icon('calendar', 'icon-sm')}</span>` : ''}
    <button type="button" class="icon-btn" data-action="remove" data-id="${t.id}" aria-label="${esc(t.title)} löschen">${icon('x', 'icon-sm')}</button>
  </li>`;
}

// Erledigte bleiben 2 Tage sichtbar, dann nur noch auf Wunsch („ältere anzeigen“); gelöscht werden sie nach 30 Tagen
// (js/cleanup.js). Ohne doneAt (vor dieser Regel abgehakt) gelten sie als frisch erledigt.
const HIDE_DONE_AFTER = 2 * 86400000;
const recentDone = (t) => !t.doneAt || Date.now() - t.doneAt < HIDE_DONE_AFTER;
let showOldDone = false;

// Zeile beim Anordnen: nur Titel und Pfeile
const arrangeItem = (t, n, count) => `
  <li class="todo-arrange">
    <span class="list-main">${esc(t.title)}${t.due ? `<small>${esc(dueLabel(t))}</small>` : ''}</span>
    <button type="button" class="icon-btn" data-action="moveTodo" data-id="${t.id}" data-dir="-1" aria-label="${esc(t.title)} nach oben"${n === 0 ? ' disabled' : ''}>${icon('up', 'icon-sm')}</button>
    <button type="button" class="icon-btn" data-action="moveTodo" data-id="${t.id}" data-dir="1" aria-label="${esc(t.title)} nach unten"${n === count - 1 ? ' disabled' : ''}>${icon('down', 'icon-sm')}</button>
  </li>`;

function listView(scope, list, d) {
  const items = d.todos.filter((t) => t.listId === list.id);
  const openItems = items.filter((t) => !t.done).sort(byOrder);
  const sorted = openItems.some((t) => Number.isFinite(t.order));
  const allDone = items.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const done = showOldDone ? allDone : allDone.filter(recentDone);
  const hidden = allDone.length - done.length;
  const head = `
    <div class="todo-head">
      <button type="button" class="icon-btn" data-action="back" aria-label="Zurück zu allen Listen">${icon('left')}</button>
      <div class="todo-head-title">
        <strong>${esc(list.name)}</strong>
        <small class="muted">${scope === 'personal' ? `${icon('lock', 'icon-xs')} Nur für mich` : `${icon('users', 'icon-xs')} Geteilt`}${list.kind === 'pack' ? ' · 🧳 Packliste' : ''}</small>
      </div>
      <button type="button" class="icon-btn" data-action="editList" aria-label="Liste umbenennen oder löschen">${icon('settings')}</button>
    </div>
  `;
  if (list.kind === 'pack') return packView(scope, list, d, head);
  return `
    ${head}    <form class="add-row" data-form="addTodo">
      <input class="input" id="todo-input" name="title" placeholder="Was ist zu tun?" autocomplete="off" enterkeyhint="done" required maxlength="120">
      <button type="submit" class="btn btn-primary" aria-label="Hinzufügen">${icon('plus')}</button>
    </form>
    ${openItems.length > 1 ? `<div class="todo-tools">
      ${arrangingTodos
        ? `${sorted ? `<button type="button" class="btn btn-ghost btn-sm" data-action="sortByDate">Nach Datum</button>` : ''}
           <button type="button" class="btn btn-primary btn-sm" data-action="arrangeTodos">Fertig</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-action="arrangeTodos">${icon('sort', 'icon-sm')} Anordnen</button>`}
    </div>` : ''}
    ${openItems.length
      ? `<ul class="list">${openItems.map((t, n) => (arrangingTodos ? arrangeItem(t, n, openItems.length) : todoItem(t))).join('')}</ul>`
      : `<div class="empty"><strong>Nichts zu tun</strong>Neue ToDos oben eintragen. Antippen für Datum, Notiz und Kalender.</div>`}
    ${allDone.length ? `
      <h2 class="section-title">Erledigt (${allDone.length})
        <button type="button" class="btn btn-ghost btn-sm" data-action="clearDone">Aufräumen</button>
      </h2>
      ${done.length ? `<ul class="list">${done.map(todoItem).join('')}</ul>` : ''}
      ${hidden ? `<button type="button" class="btn btn-ghost btn-sm old-done" data-action="showOldDone">${hidden} ${hidden === 1 ? 'älteres' : 'ältere'} anzeigen</button>`
        : showOldDone && allDone.some((t) => !recentDone(t)) ? `<button type="button" class="btn btn-ghost btn-sm old-done" data-action="showOldDone">Ältere ausblenden</button>` : ''}` : ''}`;
}

// Geöffnete Liste – gibt es sie nicht mehr (auf einem anderen Gerät gelöscht), zurück zur Übersicht
function current() {
  if (!open) return null;
  const d = SCOPES[open.scope].data();
  const list = d.lists.find((l) => l.id === open.id);
  if (!list) setOpen(null);
  return list ? { scope: open.scope, list, d, change: SCOPES[open.scope].change } : null;
}

function editTodo(cur, id, { isNew = false } = {}) {
  const t = cur.d.todos.find((x) => x.id === id);
  if (!t) return;
  const who = assignee(t)?.id || '';
  // Werte aus dem Formular übernehmen (auch für „In Kalender“, ohne vorher speichern zu müssen)
  const save = (form) => {
    const title = form.elements.title.value.trim();
    if (!title) return false;
    // Wiederholen: regelmässig braucht ein erstes Datum; nach Plan nimmt das nächste Datum aus der Liste
    const choice = form.elements.repeat.value;
    let repeat = null;
    if (choice === 'plan') {
      const { dates, bad } = parseDates(form.elements.dates.value, todayKey());
      if (bad.length) { toast(`Unklares Datum: ${bad.slice(0, 3).join(', ')}`); return false; }
      const future = dates.filter((x) => x >= todayKey());
      if (!future.length) { toast('Bitte die Daten aus dem Plan eintragen (ab heute)'); return false; }
      repeat = { dates: future };
      if (!form.elements.due.value || form.elements.due.value < todayKey()) form.elements.due.value = future[0];
    } else if (choice) {
      if (!form.elements.due.value) { toast('Bitte ein Datum fürs nächste Mal wählen'); return false; }
      repeat = repeatFromChoice(choice);
    }
    let before = '';
    cur.change((d) => {
      const item = d.todos.find((x) => x.id === id);
      if (!item) return;
      before = item.assignee || '';
      Object.assign(item, {
        title: title.slice(0, 120),
        due: form.elements.due.value,
        time: form.elements.due.value ? form.elements.time.value : '',
        note: form.elements.note.value.trim().slice(0, 500),
        ...(form.elements.assignee ? { assignee: form.elements.assignee.value } : {}),
      });
      if (repeat) item.repeat = repeat;
      else delete item.repeat;
      if (form.elements.remind?.checked && item.due) item.remind = true;
      else delete item.remind;
      // Erinnerung vor dem ToDo: nur mit Datum und Uhrzeit (js/alarms.js)
      const alarm = Number(form.elements.alarm?.value) || 0;
      if (alarm && item.due && item.time) item.alarm = alarm;
      else delete item.alarm;
    });
    // Neu einer anderen Person zugewiesen → Mitteilung an sie (js/push.js)
    const to = form.elements.assignee?.value || '';
    const me = currentMember()?.id;
    if (to && to !== before && to !== me) notifyAssigned(id, me);
    return true;
  };
  // Datumsliste nur bei „Nach Plan“, Erinnerung nur mit Datum
  const showRepeat = (form) => {
    form.querySelector('.repeat-dates').hidden = form.elements.repeat.value !== 'plan';
    const remind = form.querySelector('.remind-field');
    if (remind) remind.hidden = !form.elements.due.value && form.elements.repeat.value !== 'plan';
  };
  // Uhrzeit nur mit Datum (ohne Datum wird sie nicht gespeichert); „Erinnern“ nur mit Datum und Uhrzeit
  const timeNeedsDate = (form) => {
    form.elements.time.disabled = !form.elements.due.value;
    const alarm = form.querySelector('.alarm-field');
    if (alarm) alarm.hidden = !form.elements.due.value || !form.elements.time.value;
  };
  const form = openSheet({
    title: isNew ? 'Neues ToDo' : 'ToDo',
    body: `
      <label class="field"><span>Was</span>
        <input class="input" name="title" value="${esc(t.title)}" required maxlength="120" autocomplete="off">
      </label>
      ${cur.scope === 'shared' && state.members.length ? `
      <fieldset class="field todo-assign"><legend>Für wen?</legend>
        <div class="chips">
          <label class="chip chip-toggle"><input type="radio" name="assignee" value="" ${who ? '' : 'checked'}>Alle</label>
          ${state.members.map((m) => `<label class="chip chip-toggle">${avatar(m)}<input type="radio" name="assignee" value="${m.id}" ${m.id === who ? 'checked' : ''}>${esc(m.name)}</label>`).join('')}
        </div>
      </fieldset>` : ''}
      <div class="row">
        <label class="field"><span>Datum</span><input class="input" type="date" name="due" value="${esc(t.due)}"></label>
        <label class="field"><span>Uhrzeit</span><input class="input" type="time" name="time" value="${esc(t.time)}"></label>
      </div>
      <p class="muted small todo-time-hint">Uhrzeit freiwillig, geht nur mit Datum.</p>
      ${pushConfigured() ? `<label class="field alarm-field" hidden><span>${icon('bell', 'icon-xs')} Erinnern</span>
        <select class="select" name="alarm">${ALARM_CHOICES.map(([v, label]) => `<option value="${v}" ${v === (t.alarm || 0) ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <small class="muted">${cur.scope === 'personal'
          ? 'Mitteilung nur an dich. Titel und Zeit liegen dafür bis zur Mitteilung lesbar in Supabase.'
          : 'Mitteilung an die Person unter „Für wen?“, sonst an alle im Haushalt mit Mitteilungen.'}</small>
      </label>` : ''}
      <label class="field"><span>Wiederholen</span>
        <select class="select" name="repeat">${REPEAT_CHOICES.map(([v, label]) => `<option value="${v}" ${v === repeatChoice(t.repeat) ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </label>
      <label class="field repeat-dates" hidden><span>Daten laut Plan</span>
        <textarea class="textarea" name="dates" placeholder="4.11.2026, 18.11.2026, 2.12.2026 …">${esc(formatDates(t.repeat?.dates || []))}</textarea>
        <small class="muted">Mit Komma oder je Zeile. Nach dem Abhaken kommt das nächste Datum. Oder bei der Liste (${icon('settings', 'icon-xs')}) eine Kalender-Datei (.ics) der Gemeinde einlesen.</small>
      </label>
      ${cur.scope === 'shared'
        ? `<label class="check-field remind-field"><input type="checkbox" name="remind" ${t.remind ? 'checked' : ''}> ${icon('bell', 'icon-xs')} Am Vortag um 18 Uhr erinnern (alle mit Mitteilungen)</label>`
        : ''}
      <label class="field"><span>Notiz</span>
        <textarea class="textarea" name="note" maxlength="500">${esc(t.note)}</textarea>
      </label>`,
    submitLabel: 'Speichern',
    footer: `<button type="button" class="btn btn-danger btn-block" data-sheet-action="delete">Löschen</button>`,
    // Kalender oben neben dem Kreuz: klein, nur ein Symbol (Haken = schon einmal eingetragen)
    headerActions: `<button type="button" class="icon-btn todo-cal-btn" data-sheet-action="calendar"
      aria-label="${isInCalendar(t.id) ? 'Nochmals in Apple-Kalender eintragen (schon eingetragen)' : 'In Apple-Kalender eintragen'}"
      title="${isInCalendar(t.id) ? 'Schon eingetragen – Änderungen bei Bedarf neu eintragen' : 'In Apple-Kalender eintragen'}">${icon(isInCalendar(t.id) ? 'calendarCheck' : 'calendarPlus')}</button>`,
    onSubmit: (_, f) => save(f),
    actions: {
      change(el, f) {
        if (el.name === 'due' || el.name === 'time') timeNeedsDate(f);
        if (el.name === 'due' || el.name === 'repeat') showRepeat(f);
      },
      async calendar(btn, form) {
        if (!form.reportValidity()) return;
        if (!form.elements.due.value) {
          toast('Zuerst ein Datum wählen');
          form.elements.due.focus();
          return;
        }
        save(form);
        const item = SCOPES[cur.scope].data().todos.find((x) => x.id === id);
        if (!item) return closeSheet();
        btn.disabled = true;
        btn.classList.add('is-busy');
        const problem = await addToCalendar(item);
        btn.disabled = false;
        btn.classList.remove('is-busy');
        if (problem) return toast(problem);
        closeSheet();
        refresh(); // Kalender-Zeichen in der Liste
      },
      delete() {
        cur.change((d) => { d.todos = d.todos.filter((x) => x.id !== id); });
        closeSheet();
      },
    },
  });
  timeNeedsDate(form);
  showRepeat(form);
}

function editList(cur) {
  const { list } = cur;
  const count = cur.d.todos.filter((t) => t.listId === list.id).length;
  openSheet({
    title: 'Liste',
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" value="${esc(list.name)}" required maxlength="60" autocomplete="off">
      </label>
      ${cur.scope === 'shared' ? '<p class="muted small">Umbenennen und Löschen gilt für alle im Haushalt.</p>' : ''}
      ${list.kind === 'pack' ? `
      <label class="field"><span>Reisedauer (Tage) – für Mengen „pro Tag“</span>
        <input class="input" type="number" name="days" min="0" max="90" inputmode="numeric" value="${list.days || ''}">
      </label>
      <div class="field"><span>Vorlage</span>
        <div class="row">
          <select class="select" name="addTemplate"><option value="">Vorlage dazunehmen …</option>
            <optgroup label="Vorlagen">${templates().map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${t.items.length})</option>`).join('')}</optgroup>
            <optgroup label="Zusatz-Pakete">${ADDONS.map((a) => `<option value="${a.id}">${a.emoji} ${esc(a.name)} (${a.items.length})</option>`).join('')}</optgroup>
          </select>
          <button type="button" class="btn" data-sheet-action="saveTemplate" style="flex:0 0 auto">Als Vorlage speichern</button>
        </div>
        <p class="muted small" style="margin:6px 0 0">Dazunehmen ergänzt nur, was noch fehlt. Eigene Vorlagen gelten für den ganzen Haushalt.</p>
      </div>` : `
      <div class="field"><span>Abfuhrplan</span>
        <p class="muted small" style="margin:0 0 8px">Kalender-Datei (.ics) der Gemeinde einlesen: Altpapier, Grüngut, Karton … werden zu wiederkehrenden ToDos mit den Daten aus dem Plan.</p>
        <label class="btn btn-block">${icon('calendar', 'icon-sm')} Kalender-Datei wählen<input type="file" name="ics" accept=".ics,text/calendar" hidden></label>
      </div>`}`,
    submitLabel: 'Speichern',
    footer: `<button type="button" class="btn btn-danger btn-block" data-sheet-action="delete">Liste löschen</button>`,
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) return false;
      cur.change((d) => {
        const l = d.lists.find((x) => x.id === list.id);
        if (!l) return;
        l.name = name.slice(0, 60);
        if (l.kind === 'pack') l.days = Math.min(90, Math.max(0, Math.round(Number(data.get('days')) || 0)));
      });
    },
    actions: {
      saveTemplate() { saveTemplate(update, list, cur.d.todos); },
      async change(el) {
        // Vorlage dazunehmen: nur Einträge, die es (gleicher Name) noch nicht gibt
        if (el.name === 'addTemplate' && el.value) {
          const tpl = packSource(el.value);
          const have = new Set(cur.d.todos.filter((t) => t.listId === list.id).map((t) => t.title.toLowerCase()));
          const add = fromTemplate(tpl, list.id).filter((t) => !have.has(t.title.toLowerCase()));
          cur.change((d) => { d.todos.push(...add); });
          el.value = '';
          return toast(`${add.length} ${add.length === 1 ? 'Eintrag' : 'Einträge'} aus „${tpl.name}“ dazugenommen`);
        }
        if (el.name !== 'ics' || !el.files[0]) return;
        const groups = parseIcs(await el.files[0].text(), todayKey());
        if (!groups.length) return toast('Keine kommenden Termine in der Datei gefunden');
        importPlan(cur, groups);
      },
      delete() {
        const what = list.kind === 'pack' ? (count === 1 ? 'Eintrag' : 'Einträgen') : (count === 1 ? 'ToDo' : 'ToDos');
        if (!confirm(`„${list.name}“${count ? ` mit ${count} ${what}` : ''} löschen?`)) return;
        cur.change((d) => {
          d.lists = d.lists.filter((x) => x.id !== list.id);
          d.todos = d.todos.filter((x) => x.listId !== list.id);
        });
        setOpen(null);
        closeSheet();
      },
    },
  });
}

// Termine aus der Kalender-Datei auswählen → je Bezeichnung ein wiederkehrendes ToDo (gibt es schon ein offenes
// mit diesem Namen in der Liste, bekommt es die neuen Daten)
function importPlan(cur, groups) {
  const today = todayKey();
  openSheet({
    title: 'Abfuhrplan übernehmen',
    body: `
      <p class="muted small" style="margin:0 0 10px">Welche Termine sollen in „${esc(cur.list.name)}“? Nach dem Abhaken erscheint jeweils das nächste Datum.</p>
      <div class="pick-list">${groups.map((g, n) => `
        <label class="pick-row">
          <input type="checkbox" name="g${n}" checked>
          <span class="list-main">${esc(g.title)}<small>${g.dates.length} ${g.dates.length === 1 ? 'Termin' : 'Termine'} · nächster ${esc(fmtShort(g.dates[0]))}</small></span>
        </label>`).join('')}
      </div>
      ${cur.scope === 'shared' ? `<label class="check-field" style="margin-top:12px"><input type="checkbox" name="remind" checked> ${icon('bell', 'icon-xs')} Am Vortag um 18 Uhr erinnern</label>` : ''}`,
    submitLabel: 'Übernehmen',
    onSubmit(data) {
      const chosen = groups.filter((_, n) => data.get(`g${n}`));
      if (!chosen.length) return false;
      const remind = Boolean(data.get('remind'));
      cur.change((d) => {
        for (const g of chosen) {
          const dates = g.dates.filter((x) => x >= today);
          const existing = d.todos.find((t) => t.listId === cur.list.id && !t.done && t.title.toLowerCase() === g.title.toLowerCase());
          const fields = { due: dates[0], time: '', repeat: { dates }, ...(remind ? { remind: true } : {}) };
          if (existing) Object.assign(existing, fields);
          else d.todos.push({ id: uid(), listId: cur.list.id, title: g.title.slice(0, 120), note: '', done: false, addedAt: Date.now(), ...fields });
        }
      });
      toast(`${chosen.length} ${chosen.length === 1 ? 'Termin' : 'Termine'} übernommen`);
    },
  });
}

// Nach dem Speichern der Morgen-Erinnerung die Übersicht auffrischen
document.addEventListener('reminderchange', () => refresh());

export default {
  id: 'todo',
  title: 'ToDo',
  icon: 'listCheck',

  // Direkt in eine Liste, z. B. aus der Morgen-Erinnerung: #todo/shared/<id> oder #todo/personal/<id>
  enter(_, [scope, id] = []) {
    if ((scope === 'shared' || scope === 'personal') && id) setOpen({ scope, id });
  },

  render() {
    const cur = current();
    return cur ? listView(cur.scope, cur.list, cur.d) : overview();
  },

  actions: {
    ...packActions(current),
    sync() { syncSheet(); },
    newList(el) { newList(el.dataset.scope); },
    reminder() { openReminder(); },
    arrange(el) {
      arranging = el.dataset.scope || null;
      refresh();
    },
    moveList(el) { moveList(el.dataset.scope, el.dataset.id, Number(el.dataset.dir)); },
    openList(el) {
      arrangingTodos = false;
      setOpen({ scope: el.dataset.scope, id: el.dataset.id });
      refresh();
      window.scrollTo(0, 0);
    },
    arrangeTodos() {
      arrangingTodos = !arrangingTodos;
      refresh();
    },
    moveTodo(el) {
      const cur = current();
      if (cur) moveTodo(cur, el.dataset.id, Number(el.dataset.dir));
      // Fokus beim verschobenen ToDo lassen, damit man mehrmals tippen kann
      document.querySelector(`[data-action="moveTodo"][data-id="${el.dataset.id}"][data-dir="${el.dataset.dir}"]:not([disabled])`)?.focus();
    },
    // Eigene Reihenfolge aufheben: wieder nach Datum
    sortByDate() {
      const cur = current();
      cur?.change((d) => { for (const t of d.todos) if (t.listId === cur.list.id) delete t.order; });
    },
    showOldDone() {
      showOldDone = !showOldDone;
      refresh();
    },
    back() {
      showOldDone = false;
      arrangingTodos = false;
      setOpen(null);
      refresh();
      window.scrollTo(0, 0);
    },
    toggle(el) {
      if (open) toggleTodo(open.scope, el.dataset.id, el);
    },
    edit(el) {
      const cur = current();
      if (cur) editTodo(cur, el.dataset.id);
    },
    remove(el) {
      current()?.change((d) => { d.todos = d.todos.filter((x) => x.id !== el.dataset.id); });
    },
    clearDone() {
      const cur = current();
      cur?.change((d) => { d.todos = d.todos.filter((x) => !(x.listId === cur.list.id && x.done)); });
    },
    editList() {
      const cur = current();
      if (cur) editList(cur);
    },
  },

  submit: {
    addTodo(form) {
      const cur = current();
      const title = form.elements.title.value.trim();
      if (!cur || !title) return;
      // Packliste: nur eintragen (Kategorie am Namen erkannt), ohne Fenster – es kommen meist viele
      if (cur.list.kind === 'pack') {
        cur.change((d) => { d.todos.push(newPackItem(cur.list.id, title)); });
        document.getElementById('todo-input')?.focus();
        return;
      }
      const id = uid();
      cur.change((d) => {
        // Hat die Liste eine eigene Reihenfolge, kommt das neue ToDo zuoberst
        const orders = d.todos.filter((t) => t.listId === cur.list.id && !t.done && Number.isFinite(t.order)).map((t) => t.order);
        d.todos.push({ id, listId: cur.list.id, title: title.slice(0, 120), note: '', done: false, due: '', time: '', addedAt: Date.now(), ...(orders.length ? { order: Math.min(...orders) - 1 } : {}) });
      });
      // Gleich die weiteren Angaben (Datum, Uhrzeit, für wen, Erinnern …) – „Speichern“ oder Schliessen genügt,
      // wenn keine nötig sind; das ToDo steht schon in der Liste
      document.getElementById('todo-input')?.blur();
      const now = current();
      if (now) editTodo(now, id, { isNew: true });
    },
  },
};
