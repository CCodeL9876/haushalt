-- Zeitplan für die Push-Erinnerungen (Kühlschrank): ruft jede Stunde die Funktion „push“ auf.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen, NACHDEM die Funktion „push“ eingerichtet ist
-- (ANLEITUNG.md, Abschnitt „Push-Mitteilungen“). Darf mehrfach ausgeführt werden – der Zeitplan wird ersetzt.
--
-- Die Funktion entscheidet selbst, ob etwas fällig ist (ab 17 Uhr Schweizer Zeit) und schickt jede Erinnerung
-- nur einmal. Ein Aufruf ohne Fälliges tut nichts – darum braucht der Aufruf keinen geheimen Schlüssel.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Adresse = SUPABASE_URL aus js/config.js + /functions/v1/push
select cron.schedule(
  'haushalt-push',
  '5 * * * *', -- jede Stunde um :05
  $$
  select net.http_post(
    url := 'https://vbipkljatgandplwould.supabase.co/functions/v1/push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"run": "reminders"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
