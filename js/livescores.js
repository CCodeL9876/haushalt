// Live-Spielstände der EuroLeague für „Sport diese Woche“ (js/views/heute.js). Holt sie über die Supabase-Funktion
// „livescores“ (supabase/functions/), weil der Browser die EuroLeague nicht selbst abfragen darf.
//
// Gefragt wird nur, solange ein Spiel aus einem „Klein“-Kalender gerade laufen könnte (kurz vor Beginn bis
// 3½ Stunden danach), höchstens einmal pro Minute und nur bei offener App (js/app.js ruft refreshLive regelmässig auf).
// Ein Kalendertermin gehört zu einem Spiel, wenn die Anfangszeit passt (± 90 Minuten) und eine der beiden Mannschaften
// im Titel steht – andere Sportarten bleiben einfach ohne Spielstand.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { loadSession } from './session.js';
import { refresh } from './store.js';
import { calendarsAvailable, upcomingSmall } from './calendars.js';

const POLL_MS = 60 * 1000;
const BEFORE_MS = 20 * 60 * 1000;
const AFTER_MS = 3.5 * 3600 * 1000;
const MATCH_MS = 90 * 60 * 1000;
// Wörter, die mehrere Klubs teilen oder nichts aussagen – zählen nicht als Erkennungsmerkmal
const STOP = new Set(['basketball', 'basket', 'club', 'the', 'istanbul', 'tel', 'aviv', 'belgrade', 'belgrad', 'real', 'bc', 'fc', 'kk', 'sad']);

let games = [];
let fetchedAt = 0;
let running = null;
let off = false; // Funktion nicht eingerichtet: bis zum Neuladen nicht mehr fragen

const norm = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i');

// Erkennungswörter einer Mannschaft aus ihren Namen („Panathinaikos AKTOR Athens“ → panathinaikos, aktor, athens …)
function words(team) {
  const out = new Set();
  for (const name of team?.names || []) {
    for (const w of norm(name).split(/[^a-z0-9]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

// Stelle im Titel, an der die Mannschaft genannt wird (-1: gar nicht)
function position(title, team) {
  let best = -1;
  for (const w of words(team)) {
    const m = new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).exec(title);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}

// Spielstand zu einem Kalendertermin aus „Sport diese Woche“, in der Reihenfolge des Titels:
// { status: 'pre'|'live'|'final', a, b, period, clock } oder null
export function liveFor(event) {
  if (!games.length || !event || event.allDay) return null;
  const title = norm(event.title);
  let hit = null;
  for (const g of games) {
    if (Math.abs(new Date(g.utc) - event.start) > MATCH_MS) continue;
    const h = position(title, g.home);
    const a = position(title, g.away);
    if (h < 0 && a < 0) continue;
    const score = (h >= 0) + (a >= 0);
    if (!hit || score > hit.score) hit = { g, h, a, score };
  }
  if (!hit) return null;
  const { g, h, a } = hit;
  // Steht die Gastmannschaft im Titel zuerst, die Punkte entsprechend tauschen
  const swap = a >= 0 && (h < 0 || a < h);
  return { status: g.status, a: swap ? g.as : g.hs, b: swap ? g.hs : g.as, period: g.period || '', clock: g.clock || '' };
}

// „3. Viertel · 4:12“, „Verlängerung“, „Pause“
export function liveLabel(s) {
  const n = Number((/\d+/.exec(s.period) || [])[0]);
  const part = n >= 1 && n <= 4 ? `${n}. Viertel` : n > 4 ? 'Verlängerung' : '';
  const clock = /^\d{1,2}:\d\d$/.test(s.clock) && s.clock !== '00:00' ? s.clock.replace(/^0(?=\d:)/, '') : '';
  if (part && !clock && s.clock === '00:00') return n === 2 ? 'Halbzeit' : `Ende ${n}. Viertel`;
  return [part, clock].filter(Boolean).join(' · ');
}

const mightBeLive = (now) => upcomingSmall().some((e) => !e.allDay && e.start - now <= BEFORE_MS && now - e.start <= AFTER_MS);

async function fetchLive() {
  const { key, code } = loadSession();
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-hh-key': key || '', 'x-hh-code': code || '' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/livescores`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => null);
  // 404: noch nicht eingerichtet, 401: JWT-Prüfung noch an (ANLEITUNG.md) – dann still bleiben
  if (res.status === 404 || res.status === 401) off = true;
  if (!res.ok || !Array.isArray(data?.games)) throw new Error(data?.error || `Fehler ${res.status}`);
  return data.games;
}

// Regelmässig aufrufen; fragt nur nach, wenn ein Spiel laufen könnte und die letzte Antwort älter als eine Minute ist
export function refreshLive() {
  if (off || running || !calendarsAvailable()) return;
  const now = Date.now();
  if (!mightBeLive(now)) {
    if (games.length) { games = []; refresh('remote'); }
    return;
  }
  if (now - fetchedAt < POLL_MS - 2000) return;
  fetchedAt = now;
  running = fetchLive()
    .then((list) => {
      const changed = JSON.stringify(list) !== JSON.stringify(games);
      games = list;
      if (changed) refresh('remote');
    })
    .catch(() => { /* ohne Verbindung: beim nächsten Mal wieder versuchen, die Leiste zeigt dann einfach keine Stände */ })
    .finally(() => { running = null; });
}
