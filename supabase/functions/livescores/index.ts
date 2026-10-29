// Supabase Edge Function „livescores“: Live-Spielstände der EuroLeague für die Leiste „Sport diese Woche“ auf der
// Startseite (js/livescores.js). Der Browser darf fremde Seiten nicht selbst abrufen – darum diese Funktion.
//
//   POST {}  (mit Haushalt-Schlüssel und Zugangscode)
//   → { updated, games: [{ code, utc, status, home, away, hs, as, period, clock }] }
//     status: 'pre' (noch nicht begonnen), 'live' (läuft), 'final' (beendet)
//     home/away: { code, names: [voller Name, Kurzname, …] } – die App erkennt das Spiel daran im Kalendertitel
//     period: laufendes Viertel ('1'–'4', darüber Verlängerung), clock: Restzeit im Viertel ('04:12')
//
// Quelle sind die öffentlichen Schnittstellen der EuroLeague: der Spielplan der Saison (api-live.euroleague.net) und
// pro Spiel der aktuelle Stand (live.euroleague.net). Zurück kommen nur Spiele von 8 Stunden vor bis 30 Stunden nach
// jetzt. Speichert und protokolliert nichts; der Spielplan bleibt 10 Minuten, ein Spielstand 20 Sekunden im
// Arbeitsspeicher, damit mehrere Geräte die EuroLeague nicht mehrfach abfragen.
// Einrichtung: ANLEITUNG.md, „Live-Resultate“ (JWT-Prüfung aus). Nur für angemeldete Haushalte.
//
// Bewusst eine einzige Datei in reinem JavaScript (gültiges TypeScript) zum Einfügen im Dashboard; buildGames() hat
// keine Abhängigkeiten und lässt sich im Browser testen.

const TIMEOUT_MS = 10000;
const SCHEDULE_MS = 10 * 60 * 1000;
const LIVE_MS = 20 * 1000;
const BEFORE_MS = 8 * 3600 * 1000;
const AFTER_MS = 30 * 3600 * 1000;
// Spielstand schon kurz vor dem angesetzten Beginn abfragen (die Uhr der EuroLeague kann vorgehen)
const EARLY_MS = 5 * 60 * 1000;

// Saison „E2026“ läuft von Herbst 2026 bis Frühling 2027
export function seasonCode(now) {
  const y = now.getUTCFullYear();
  return `E${now.getUTCMonth() + 1 >= 7 ? y : y - 1}`;
}

const team = (side) => {
  const club = side?.club || {};
  return { code: String(club.code || ''), names: [club.name, club.abbreviatedName, club.editorialName].filter(Boolean).map(String) };
};

// Spielplan der EuroLeague (v2, „data“) → Spiele im Zeitfenster um now, mit Stand aus liveOf(code) für begonnene Spiele.
// liveOf liefert { live, hs, as, period, clock } oder null (nicht erreichbar).
export async function buildGames(schedule, now, liveOf) {
  const t = now.getTime();
  const list = (schedule?.data || [])
    .map((g) => ({ code: Number(g.gameCode), utc: String(g.utcDate || ''), played: Boolean(g.played), home: team(g.local), away: team(g.road),
      hs: Number(g.local?.score) || 0, as: Number(g.road?.score) || 0 }))
    .filter((g) => g.code > 0 && /^\d{4}-\d\d-\d\dT/.test(g.utc))
    .map((g) => ({ ...g, at: Date.parse(g.utc.endsWith('Z') ? g.utc : `${g.utc}Z`) }))
    .filter((g) => Number.isFinite(g.at) && g.at >= t - BEFORE_MS && g.at <= t + AFTER_MS)
    .sort((a, b) => a.at - b.at || a.code - b.code);
  return Promise.all(list.map(async (g) => {
    const out = { code: g.code, utc: new Date(g.at).toISOString(), status: 'pre', home: g.home, away: g.away, hs: 0, as: 0, period: '', clock: '' };
    if (g.played) return { ...out, status: 'final', hs: g.hs, as: g.as };
    if (g.at > t + EARLY_MS) return out;
    const s = await liveOf(g.code);
    if (!s) return out;
    if (s.live) return { ...out, status: 'live', hs: s.hs, as: s.as, period: s.period, clock: s.clock };
    // Nicht mehr live, aber Punkte und Beginn vorbei: beendet (der Spielplan trägt „played“ erst später nach)
    if (s.hs + s.as > 0 && g.at < t) return { ...out, status: 'final', hs: s.hs, as: s.as };
    return out;
  }));
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let schedule = { at: 0, season: '', data: null };
const lives = new Map();

async function loadSchedule(season) {
  if (schedule.season === season && schedule.data && Date.now() - schedule.at < SCHEDULE_MS) return schedule.data;
  const data = await getJson(`https://api-live.euroleague.net/v2/competitions/E/seasons/${season}/games`);
  schedule = { at: Date.now(), season, data };
  return data;
}

// Stand eines Spiels; TeamA ist die Heimmannschaft
async function liveOf(season, code) {
  const hit = lives.get(code);
  if (hit && Date.now() - hit.at < LIVE_MS) return hit.data;
  try {
    const h = await getJson(`https://live.euroleague.net/api/Header?gamecode=${code}&seasoncode=${season}`);
    const data = { live: h?.Live === true, hs: Number(h?.ScoreA) || 0, as: Number(h?.ScoreB) || 0,
      period: String(h?.Quarter ?? '').trim(), clock: String(h?.RemainingPartialTime ?? '').trim() };
    lives.set(code, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hh-key, x-hh-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function householdOk(req) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  const hhKey = req.headers.get('x-hh-key') || '';
  const hhCode = req.headers.get('x-hh-code') || '';
  if (!url || !key || !/^[a-f0-9]{32,128}$/i.test(hhKey) || !hhCode) return false;
  const headers = { apikey: key, 'Content-Type': 'application/json', 'x-hh-key': hhKey, 'x-hh-code': hhCode };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/household_login`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(10000) });
    return res.ok && (await res.json())?.status === 'ok';
  } catch {
    return false;
  }
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);
  if (!(await householdOk(req))) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);
  const now = new Date();
  const season = seasonCode(now);
  let data;
  try {
    data = await loadSchedule(season);
  } catch {
    return json({ error: 'Die EuroLeague antwortet nicht.' }, 502);
  }
  const games = await buildGames(data, now, (code) => liveOf(season, code));
  return json({ updated: now.toISOString(), games });
}

// Nur auf dem Server starten – im Browser (Test) wird nur buildGames gebraucht
if (typeof Deno !== 'undefined') Deno.serve(handle);
