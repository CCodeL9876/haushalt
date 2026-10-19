// Zugangsdaten für den gemeinsamen Haushalt (Supabase) – eigenes Supabase-Projekt, nicht das von Mallorca.
// Beide Werte stehen in Supabase unter „Project Settings → API Keys“ bzw. „Connect“.
// Der „publishable“/„anon“ Key ist für den Browser gedacht und darf öffentlich sein – geschützt werden die
// Daten durch den geheimen Haushalt-Link und den Zugangscode (siehe supabase/schema.sql).
//
// Solange die Felder leer sind, läuft die App ohne Anmeldung und speichert nur lokal in diesem Browser.

export const SUPABASE_URL = 'https://vbipkljatgandplwould.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_dg4tPjjsYOGRHxuf0Is43Q_LZRRzfs4';

// Rezepte per Link einlesen (Menüideen): Adresse der Supabase-Funktion „recipe-import“ (ANLEITUNG.md).
// Leer = automatisch <SUPABASE_URL>/functions/v1/recipe-import. Nur ändern, wenn die Funktion woanders läuft.
export const RECIPE_IMPORT_URL = '';

// Push-Mitteilungen: öffentlicher Schlüssel (VAPID) – darf öffentlich sein. Der geheime Teil liegt nur in Supabase
// (Secret VAPID_PRIVATE_KEY). Muss zu VAPID_PUBLIC_KEY in supabase/functions/push/index.ts passen.
export const PUSH_PUBLIC_KEY = 'BJvU0TeuBTa-QQLamVufZ_ck7Skh8gAA1SCzb5vcN-u6MgRoN2nGa5hgsEfs1FinZn9Hd8v77yjfBArWCi_u_Ig';
