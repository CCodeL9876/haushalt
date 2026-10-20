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
  collection     text not null check (collection in ('members', 'shopping', 'terms', 'ideas', 'plan', 'expenses', 'settings', 'todolists', 'todos', 'private', 'fridge')),
  id             text not null check (char_length(id) between 1 and 64),
  data           jsonb not null check (pg_column_size(data) <= 50000),
  updated_at     timestamptz not null default now(),
  primary key (household_key, collection, id)
);
alter table public.items enable row level security;
-- Für eine schon bestehende Tabelle: erlaubte Sammlungen auf den aktuellen Stand bringen (neu: todolists, todos, private, fridge)
alter table public.items drop constraint if exists items_collection_check;
alter table public.items add constraint items_collection_check
  check (collection in ('members', 'shopping', 'terms', 'ideas', 'plan', 'expenses', 'settings', 'todolists', 'todos', 'private', 'fridge'));

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

-- Zugangscode ändern: set_household_code weiter unten (nach den Push-Tabellen)

revoke all on function public.household_access_ok() from public;
revoke all on function public.household_login() from public;
grant execute on function public.household_access_ok() to anon, authenticated;
grant execute on function public.household_login() to anon, authenticated;

-- Nur Zeilen des eigenen Haushalts, nur mit richtigem Code. „(select …)“ = einmal pro Anfrage geprüft, nicht pro Zeile.
drop policy if exists items_own_household on public.items;
create policy items_own_household on public.items
  for all
  to anon, authenticated
  using (household_key = (select public.request_header('x-hh-key')) and (select public.household_access_ok()))
  with check (household_key = (select public.request_header('x-hh-key')) and (select public.household_access_ok()));

grant select, insert, update, delete on public.items to anon, authenticated;

-- ---------- Push-Mitteilungen (js/push.js, supabase/functions/push) ----------
-- Jedes Gerät, das Mitteilungen erlaubt hat, mit seinem „Push-Abo“ (Adresse beim Dienst von Apple/Google/Mozilla
-- und Schlüssel zum Verschlüsseln). Die App kommt nur über die zwei Funktionen unten heran, die Funktion „push“
-- liest mit dem Service-Schlüssel.
create table if not exists public.push_subscriptions (
  endpoint       text primary key check (char_length(endpoint) between 20 and 1000),
  household_key  text not null references public.households (key) on delete cascade,
  member_id      text check (char_length(member_id) <= 64),
  p256dh         text not null check (char_length(p256dh) between 40 and 200),
  auth           text not null check (char_length(auth) between 10 and 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Was schon verschickt wurde (z. B. „fridge:<id>:2026-10-20“), damit jede Erinnerung nur einmal kommt
create table if not exists public.push_sent (
  household_key  text not null references public.households (key) on delete cascade,
  ref            text not null check (char_length(ref) <= 200),
  sent_at        timestamptz not null default now(),
  primary key (household_key, ref)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- Gerät anmelden bzw. auf den neuesten Stand bringen (gleiche Adresse = gleiches Gerät)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_member text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text := public.request_header('x-hh-key');
begin
  if not public.household_access_ok() then
    raise exception 'Zugangscode stimmt nicht';
  end if;
  if p_endpoint !~ '^https://' then
    raise exception 'ungültige Push-Adresse';
  end if;
  -- Schutz vor Missbrauch: höchstens 30 Geräte pro Haushalt
  if (select count(*) from public.push_subscriptions where household_key = k and endpoint <> p_endpoint) >= 30 then
    raise exception 'zu viele Geräte für Mitteilungen';
  end if;
  insert into public.push_subscriptions (endpoint, household_key, member_id, p256dh, auth)
  values (p_endpoint, k, nullif(p_member, ''), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set household_key = excluded.household_key, member_id = excluded.member_id,
        p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
  return true;
end
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.household_access_ok() then
    raise exception 'Zugangscode stimmt nicht';
  end if;
  delete from public.push_subscriptions
   where endpoint = p_endpoint and household_key = public.request_header('x-hh-key');
  return true;
end
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public;
revoke all on function public.push_unsubscribe(text) from public;
grant execute on function public.push_subscribe(text, text, text, text) to anon, authenticated;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;

-- ---------- Morgen-Erinnerung an eine ToDo-Liste (js/push.js, Funktion „push“) ----------
-- Pro Gerät eine Liste, Uhrzeit (Schweizer Zeit) und Wochentage (1 = Montag … 7 = Sonntag). Bei einer geteilten
-- Liste liest die Funktion die ToDos selbst; eine persönliche Liste liegt nur auf dem Gerät (bzw. verschlüsselt),
-- darum hinterlegt die App deren offene ToDos hier in todo_items – nur für die gewählte Liste.
alter table public.push_subscriptions add column if not exists todo_scope text check (todo_scope in ('shared', 'personal'));
alter table public.push_subscriptions add column if not exists todo_list text check (char_length(todo_list) <= 64);
alter table public.push_subscriptions add column if not exists todo_name text check (char_length(todo_name) <= 80);
alter table public.push_subscriptions add column if not exists todo_time text check (todo_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.push_subscriptions add column if not exists todo_days text check (todo_days ~ '^[1-7](,[1-7]){0,6}$');
alter table public.push_subscriptions add column if not exists todo_items jsonb check (pg_column_size(todo_items) <= 20000);

-- Erinnerung für dieses Gerät setzen; p_list = '' schaltet sie aus
create or replace function public.push_todo_reminder(p_endpoint text, p_scope text, p_list text, p_name text, p_time text, p_days text, p_items jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text := public.request_header('x-hh-key');
  off boolean := coalesce(p_list, '') = '';
begin
  if not public.household_access_ok() then
    raise exception 'Zugangscode stimmt nicht';
  end if;
  update public.push_subscriptions
     set todo_scope = case when off then null else p_scope end,
         todo_list  = case when off then null else p_list end,
         todo_name  = case when off then null else left(p_name, 80) end,
         todo_time  = case when off then null else p_time end,
         todo_days  = case when off then null else p_days end,
         todo_items = case when off or p_scope <> 'personal' then null else p_items end,
         updated_at = now()
   where endpoint = p_endpoint and household_key = k;
  if not found then
    raise exception 'Dieses Gerät ist für Mitteilungen nicht angemeldet';
  end if;
  return true;
end
$$;

revoke all on function public.push_todo_reminder(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.push_todo_reminder(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------- Zugangscode ändern: alle anderen Geräte abmelden ----------
-- Nur mit dem bisherigen, richtigen Code. Zusätzlich werden alle Geräte des Haushalts von den
-- Mitteilungen abgemeldet – ausser keep_endpoint (das Gerät, das den Code ändert). Wer den alten Code hat,
-- bekommt so keine Mitteilungen mehr; die eigenen Geräte melden sich nach Eingabe des neuen Codes selbst wieder an.
drop function if exists public.set_household_code(text);
create or replace function public.set_household_code(new_code text, keep_endpoint text default '')
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text := public.request_header('x-hh-key');
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
   where key = k;
  delete from public.push_subscriptions
   where household_key = k and endpoint <> coalesce(keep_endpoint, '');
  return true;
end
$$;

revoke all on function public.set_household_code(text, text) from public;
grant execute on function public.set_household_code(text, text) to anon, authenticated;
