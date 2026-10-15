// Claude fragen: Rezeptideen zu vorhandenen Zutaten – über die Supabase-Funktion „recipe-ideas“
// (supabase/functions/). Der Anthropic-Schlüssel liegt nur dort; die App schickt Haushalt-Schlüssel und
// Zugangscode mit, damit nur der eigene Haushalt die (kostenpflichtige) Funktion benutzen kann.
// Ergebnis: [{ title, description, minutes, servings, ingredients, missing, steps, tags }]

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { session } from './store.js';
import { loadSession } from './session.js';

// Nur im gemeinsamen Haushalt (lokal fehlen Supabase und der Zugangscode)
export const ideasAvailable = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && session.mode === 'shared');

export async function askRecipeIdeas({ ingredients, wishes, existing }) {
  if (!ideasAvailable()) throw new Error('Claude fragen geht nur im gemeinsamen Haushalt mit Supabase (ANLEITUNG.md).');
  const { key, code } = loadSession();
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-hh-key': key || '', 'x-hh-code': code || '' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/recipe-ideas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ingredients, wishes, existing }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'Claude braucht zu lange – bitte nochmals versuchen.' : 'Keine Verbindung – später nochmals versuchen.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (res.status === 404 && !data?.error) throw new Error('Die Funktion „recipe-ideas“ ist in Supabase noch nicht eingerichtet (ANLEITUNG.md).');
  if (res.status === 401) throw new Error('Supabase lehnt ab – bei „recipe-ideas“ die JWT-Prüfung ausschalten (ANLEITUNG.md).');
  if (!res.ok || !Array.isArray(data?.ideas)) throw new Error(data?.error || `Fehler ${res.status}`);
  return data.ideas;
}
