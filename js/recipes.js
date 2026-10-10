// Rezept von einer Webseite einlesen – über die Supabase-Funktion „recipe-import“ (supabase/functions/), weil der
// Browser fremde Seiten nicht selbst abrufen darf. Ergebnis: { title, ingredients, servings, minutes, tags, url }.

import { SUPABASE_URL, SUPABASE_ANON_KEY, RECIPE_IMPORT_URL } from './config.js';

export const recipeImportAvailable = () => Boolean(RECIPE_IMPORT_URL || (SUPABASE_URL && SUPABASE_ANON_KEY));

// „bettybossi.ch/…“ → „https://bettybossi.ch/…“; alles ausser http(s) → ''
export function normalizeUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export async function importRecipe(url) {
  if (!recipeImportAvailable()) throw new Error('Einlesen braucht das Supabase-Projekt des Haushalts (siehe ANLEITUNG.md).');
  const endpoint = RECIPE_IMPORT_URL || `${SUPABASE_URL}/functions/v1/recipe-import`;
  const headers = { 'Content-Type': 'application/json' };
  if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url }), signal: AbortSignal.timeout(25000) });
  } catch {
    throw new Error('Keine Verbindung – später nochmals versuchen.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (res.status === 404 && !data?.error) throw new Error('Die Funktion „recipe-import“ ist in Supabase noch nicht eingerichtet (siehe ANLEITUNG.md).');
  if (res.status === 401) throw new Error('Supabase lehnt ab – bei der Funktion „recipe-import“ die JWT-Prüfung ausschalten (ANLEITUNG.md).');
  if (!res.ok || !data) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}
