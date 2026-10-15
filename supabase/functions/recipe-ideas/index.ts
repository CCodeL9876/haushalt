// Supabase Edge Function „recipe-ideas“: Zutaten (und Wünsche) rein, 4 Rezeptideen von Claude raus.
//
// Kosten und Schutz: Jede Anfrage kostet ein paar Rappen bei Anthropic. Darum antwortet die Funktion nur, wenn
// Haushalt-Schlüssel und Zugangscode stimmen (dieselbe Prüfung wie für die Daten, household_login in schema.sql),
// und begrenzt die Länge der Eingaben. Der API-Schlüssel liegt nur hier als Supabase-Secret ANTHROPIC_API_KEY,
// nie im Browser. Gespeichert und protokolliert wird nichts; an Anthropic gehen nur Zutaten, Wünsche und die
// Namen der vorhandenen Menüideen (damit keine doppelt vorgeschlagen werden).
//
// Wie recipe-import eine einzige Datei, damit sie sich im Supabase-Dashboard per Kopieren einrichten lässt
// (ANLEITUNG.md, Abschnitt „Claude fragen“).

import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hh-key, x-hh-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Antwortformat – Claude hält sich dank structured outputs genau daran
const SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Name des Gerichts' },
          description: { type: 'string', description: 'Ein kurzer Satz, was es ist' },
          minutes: { type: 'integer', description: 'Zeit in Minuten, alles inklusive' },
          servings: { type: 'integer', description: 'Für wie viele Personen' },
          ingredients: { type: 'array', items: { type: 'string' }, description: 'Alle Zutaten mit Menge, eine pro Eintrag, z. B. „400 g Kartoffeln“' },
          missing: { type: 'array', items: { type: 'string' }, description: 'Zutaten aus ingredients, die nicht genannt wurden und keine Grundzutaten sind – nur der Name, ohne Menge' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Zubereitung in kurzen Schritten' },
          tags: { type: 'array', items: { type: 'string' }, description: '1–3 Stichworte wie Vegi, Schnell, Ofen' },
        },
        required: ['title', 'description', 'minutes', 'servings', 'ingredients', 'missing', 'steps', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

const SYSTEM = `Du hilfst einem Haushalt in der Schweiz beim Kochen. Aus den Zutaten, die jemand zu Hause hat, schlägst du 4 alltagstaugliche Gerichte vor.

- Verwende möglichst viele der genannten Zutaten; die Gerichte sollen sich deutlich voneinander unterscheiden.
- Grundzutaten (Salz, Pfeffer, Öl, Butter, Mehl, Zucker, Gewürze, Bouillon) darfst du als vorhanden annehmen.
- Füge nur wenige zusätzliche Zutaten hinzu und führe sie unter „missing“ auf, damit sie auf die Einkaufsliste können.
- Halte dich an die Wünsche (z. B. vegetarisch, schnell, für Kinder), falls welche genannt sind.
- Schlage keine Gerichte vor, die schon in der Liste der vorhandenen Menüideen stehen.
- Schreibe auf Deutsch in Schweizer Schreibweise: immer „ss“, nie „ß“; Schweizer Begriffe wie Rahm, Peperoni, Zucchetti, Poulet.
- Mengen in g, dl, EL, TL oder Stück. Schritte kurz und klar, höchstens 8 pro Gericht.`;

// Stimmen Schlüssel und Code? Fragt dieselbe Datenbankfunktion wie die App bei der Anmeldung.
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

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max, len) => (Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean).slice(0, max);

// Antwort von Claude prüfen und zurechtstutzen, bevor sie an den Browser geht
function cleanIdeas(raw) {
  return (Array.isArray(raw?.ideas) ? raw.ideas : []).slice(0, 6).map((i) => ({
    title: text(i.title, 80),
    description: text(i.description, 200),
    minutes: Number.isInteger(i.minutes) && i.minutes > 0 ? Math.min(i.minutes, 600) : null,
    servings: Number.isInteger(i.servings) && i.servings > 0 ? Math.min(i.servings, 20) : null,
    ingredients: list(i.ingredients, 30, 80),
    missing: list(i.missing, 20, 60),
    steps: list(i.steps, 12, 300),
    tags: list(i.tags, 3, 24),
  })).filter((i) => i.title && i.ingredients.length);
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'In Supabase fehlt das Secret ANTHROPIC_API_KEY (ANLEITUNG.md).' }, 500);
  if (!(await householdOk(req))) return json({ error: 'Nur für angemeldete Haushalte.' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'ungültige Anfrage' }, 400);
  }
  const ingredients = text(body?.ingredients, 600);
  const wishes = text(body?.wishes, 200);
  const existing = list(body?.existing, 60, 80);
  if (!ingredients) return json({ error: 'Bitte ein paar Zutaten angeben.' }, 400);

  const prompt = [
    `Zutaten zu Hause: ${ingredients}`,
    wishes ? `Wünsche: ${wishes}` : '',
    existing.length ? `Vorhandene Menüideen (nicht nochmals vorschlagen): ${existing.join('; ')}` : '',
  ].filter(Boolean).join('\n');

  const client = new Anthropic(); // liest ANTHROPIC_API_KEY
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Wenn die Sicherheitsprüfung des Modells ablehnt, übernimmt automatisch ein passendes anderes Modell
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Rezeptideen sind keine schwere Denkaufgabe – „low“ hält die Wartezeit am Handy kurz
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'Gerade zu viele Anfragen – in einer Minute nochmals versuchen.' }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'Der Anthropic-Schlüssel in Supabase stimmt nicht.' }, 500);
    if (err instanceof Anthropic.APIConnectionError) return json({ error: 'Claude ist gerade nicht erreichbar.' }, 502);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude meldet Fehler ${err.status ?? ''}`.trim() }, 502);
    throw err;
  }

  if (response.stop_reason === 'refusal') return json({ error: 'Dazu gibt es leider keine Vorschläge.' }, 422);
  if (response.stop_reason === 'max_tokens') return json({ error: 'Die Antwort wurde zu lang – bitte weniger Zutaten oder Wünsche angeben.' }, 502);
  const out = response.content.find((b) => b.type === 'text')?.text || '';
  let ideas;
  try {
    ideas = cleanIdeas(JSON.parse(out));
  } catch {
    return json({ error: 'Die Antwort war nicht lesbar – bitte nochmals versuchen.' }, 502);
  }
  if (!ideas.length) return json({ error: 'Keine Vorschläge erhalten – bitte nochmals versuchen.' }, 502);
  return json({ ideas });
}

if (typeof Deno !== 'undefined') Deno.serve(handle);
