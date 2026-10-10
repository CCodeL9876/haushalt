-- Haushalt – gemeinsame Daten
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (eigenes Supabase-Projekt, NICHT das von Mallorca).
-- Darf mehrfach ausgeführt werden.
--
-- Zugriffsprinzip (wie bei Mallorca): Jeder Haushalt hat einen geheimen, zufälligen Schlüssel (steht im Link)
-- und einen Zugangscode. Die App schickt beide bei jeder Anfrage als Header "x-hh-key" und "x-hh-code".
-- Die Row-Level-Security erlaubt Lesen und Schreiben nur für Zeilen genau dieses Haushalts und nur mit dem
-- richtigen Code. Gespeichert wird vom Code nur eine bcrypt-Prüfsumme. Neue Haushalte lassen sich über die
-- App nicht anlegen – das geht nur hier im SQL Editor (siehe ANLEITUNG.md).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.households (
  key         text primary key check (char_length(key) between 32 and 128),
  name        text not null default 'Haushalt' check (char_length(name) <= 80),
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.households enable row level security;
-- Keine Policies und keine Rechte: nur über die Funktionen unten erreichbar
revoke all on public.households from anon, authenticated;

-- Alle Einträge eines Haushalts: eine Zeile pro Eintrag, Inhalt als JSON (Aufbau siehe js/store.js)
create table if not exists public.items (
  household_key  text not null references public.households (key) on delete cascade,
  collection     text not null check (collection in ('members', 'shopping', 'terms', 'ideas', 'plan', 'expenses', 'settings')),
  id             text not null check (char_length(id) between 1 and 64),
  data           jsonb not null check (pg_column_size(data) <= 50000),
  updated_at     timestamptz not null default now(),
  primary key (household_key, collection, id)
);
alter table public.items enable row level security;
-- Für eine schon bestehende Tabelle: erlaubte Sammlungen auf den aktuellen Stand bringen (neu: terms)
alter table public.items drop constraint if exists items_collection_check;
alter table public.items add constraint items_collection_check
  check (collection in ('members', 'shopping', 'terms', 'ideas', 'plan', 'expenses', 'settings'));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- Header der Anfrage lesen (leer → null)
create or replace function public.request_header(name text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.headers', true)::json ->> name, '')
$$;

-- true nur, wenn der Haushalt existiert und der mitgeschickte Code stimmt.
-- Ein falscher Code verzögert die Antwort, damit sich Codes nicht schnell durchprobieren lassen.
create or replace function public.household_access_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored text;
begin
  select code_hash into stored from public.households where key = public.request_header('x-hh-key');
  if stored is null then
    return false;
  end if;
  if extensions.crypt(coalesce(public.request_header('x-hh-code'), ''), stored) = stored then
    return true;
  end if;
  perform pg_sleep(0.5);
  return false;
end
$$;

-- Für die Anmeldung: { status: 'unknown' | 'wrong' | 'ok', name }
create or replace function public.household_login()
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text := public.request_header('x-hh-key');
  hh_name text;
begin
  select name into hh_name from public.households where key = k;
  if k is null or hh_name is null then
    return json_build_object('status', 'unknown');
  end if;
  if not public.household_access_ok() then
    return json_build_object('status', 'wrong');
  end if;
  return json_build_object('status', 'ok', 'name', hh_name);
end
$$;

-- Zugangscode ändern (nur mit dem bisherigen, richtigen Code)
create or replace function public.set_household_code(new_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.household_access_ok() then
    raise exception 'der bisherige Zugangscode stimmt nicht';
  end if;
  if char_length(coalesce(new_code, '')) < 6 or char_length(new_code) > 64 then
    raise exception 'der Code muss 6 bis 64 Zeichen lang sein';
  end if;
  -- Nur einfache Zeichen: Der Code geht als HTTP-Header mit, und Browser senden z. B. Umlaute nicht als UTF-8
  if new_code !~ '^[ -~]+$' then
    raise exception 'bitte nur Buchstaben ohne Umlaute, Ziffern und einfache Satzzeichen';
  end if;
  update public.households
     set code_hash = extensions.crypt(new_code, extensions.gen_salt('bf', 8)), updated_at = now()
   where key = public.request_header('x-hh-key');
  return true;
end
$$;

revoke all on function public.household_access_ok() from public;
revoke all on function public.household_login() from public;
revoke all on function public.set_household_code(text) from public;
grant execute on function public.household_access_ok() to anon, authenticated;
grant execute on function public.household_login() to anon, authenticated;
grant execute on function public.set_household_code(text) to anon, authenticated;

-- Nur Zeilen des eigenen Haushalts, nur mit richtigem Code. „(select …)“ = einmal pro Anfrage geprüft, nicht pro Zeile.
drop policy if exists items_own_household on public.items;
create policy items_own_household on public.items
  for all
  to anon, authenticated
  using (household_key = (select public.request_header('x-hh-key')) and (select public.household_access_ok()))
  with check (household_key = (select public.request_header('x-hh-key')) and (select public.household_access_ok()));

grant select, insert, update, delete on public.items to anon, authenticated;
