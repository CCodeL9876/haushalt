// Persönliche ToDo-Listen: liegen nur auf diesem Gerät (localStorage) und gehen nie in die Datenbank –
// auch nicht in die Sicherung. Getrennt pro Haushalt und pro Person („Wer bist du?“), damit jemand anderes,
// der sich am selben Gerät anmeldet, sie nicht sieht. Aufbau wie die geteilten Listen in js/store.js:
//   lists [{ id, name, createdAt }]
//   todos [{ id, listId, title, note, done, due?, time?, addedAt }]

import { refresh, session } from './store.js';
import { myMemberId } from './session.js';

const PREFIX = 'haushalt.personal.';

const storageKey = () => PREFIX + (session.mode === 'shared' ? `${session.key}.${myMemberId(session.key) || 'ohne-person'}` : 'local');

let loadedKey = null;
let data = { lists: [], todos: [] };

function load() {
  const key = storageKey();
  if (key === loadedKey) return;
  loadedKey = key;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    data = {
      lists: Array.isArray(saved?.lists) ? saved.lists : [],
      todos: Array.isArray(saved?.todos) ? saved.todos : [],
    };
  } catch {
    data = { lists: [], todos: [] };
  }
}

// Immer über diese Funktion lesen: nach einem Personenwechsel gehört der Speicher jemand anderem
export function personal() {
  load();
  return data;
}

export function updatePersonal(fn) {
  load();
  fn(data);
  try {
    localStorage.setItem(loadedKey, JSON.stringify(data));
  } catch {
    console.warn('Haushalt: persönliche Liste konnte nicht gespeichert werden');
  }
  refresh('local');
}
