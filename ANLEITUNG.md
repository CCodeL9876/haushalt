# Haushalt einrichten: Anmeldung mit Link und Code

Ohne diese Schritte läuft die App ohne Anmeldung und speichert nur im jeweiligen Browser.
Mit ihnen gilt dasselbe Prinzip wie bei Aperol Sprintz:

1. **Link öffnen.** Der Link enthält einen geheimen Schlüssel, zum Beispiel `…/#haushalt=3f9a…`.
2. **Zugangscode eingeben.** Einmal pro Gerät, danach merkt sich das Gerät den Code.
3. **„Wer bist du?“** Sich aus der Liste wählen oder neu eintragen, ebenfalls einmal pro Gerät.
4. **Initialen oben rechts** zeigen, wer am Gerät angemeldet ist. Antippen, um die Person zu wechseln oder sich abzumelden.

## 1. Eigenes Supabase-Projekt anlegen

Nimm **nicht** das Projekt von Mallorca. So beeinflussen Änderungen an der Datenbank die Reise-App nicht.

1. Auf [supabase.com](https://supabase.com) → **New project**, Name z. B. `haushalt`, Region Zürich oder Frankfurt.
2. **SQL Editor** → **New query** → den ganzen Inhalt von [supabase/schema.sql](supabase/schema.sql) einfügen → **Run**.

## 2. Haushalt mit Zugangscode anlegen

Im SQL Editor ausführen. Ersetze dabei `DEIN-CODE` (mindestens 6 Zeichen, ohne Umlaute) und den Namen:

```sql
insert into public.households (key, name, code_hash)
values (
  encode(extensions.gen_random_bytes(20), 'hex'),
  'Unser Haushalt',
  extensions.crypt('DEIN-CODE', extensions.gen_salt('bf', 8))
)
returning key;
```

Das Ergebnis `key` ist der geheime Schlüssel (40 Zeichen). Gut aufbewahren.

## 3. App verbinden

In Supabase unter **Project Settings → API Keys** die *Project URL* und den *publishable key* kopieren
und in [js/config.js](js/config.js) eintragen:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_…';
```

Beide Werte dürfen öffentlich sein. Geschützt wird über den Schlüssel im Link und den Zugangscode.

## 4. Link verteilen

```
https://<eure-adresse>/#haushalt=<key aus Schritt 2>
```

Lokal zum Testen: `http://localhost:5180/#haushalt=<key>`. In der App gibt es den Link später auch unter
**Haushalt (Knopf oben rechts) → Link teilen**. Den Zugangscode immer **separat** weitergeben, nicht in derselben Nachricht wie den Link.

## 5. Rezepte per Link einlesen (einmalig einrichten)

In den Menüideen kann man den Link einer Rezeptseite einfügen und auf **Einlesen** tippen – Name, Zutaten mit Mengen,
Stichworte und Portionen werden übernommen. Getestet mit Betty Bossi, Swissmilk, Fooby, Migusto und Chefkoch; die
meisten Rezeptseiten funktionieren, weil sie ihre Rezepte in einem einheitlichen Format beschreiben.

Der Browser darf fremde Seiten nicht selbst abrufen, darum übernimmt das eine kleine Funktion im Supabase-Projekt.
Sie gibt nur die Rezeptangaben zurück und speichert nichts.

1. Im Supabase-Dashboard das Haushalt-Projekt öffnen → links **Edge Functions**.
2. **Deploy a new function** → **Via Editor**.
3. Als Namen genau `recipe-import` eintragen.
4. Den Beispielcode komplett löschen, den Inhalt der Datei
   [supabase/functions/recipe-import/index.ts](supabase/functions/recipe-import/index.ts) hineinkopieren → **Deploy function**.
5. In der Funktion die Einstellungen öffnen und die JWT-Prüfung ausschalten (Schalter „Verify JWT“ bzw.
   „Enforce JWT verification“) → speichern. Grund: Die App meldet sich nicht mit einem Benutzerkonto an.

Ohne diese Funktion lässt sich der Link trotzdem bei der Menüidee speichern („Rezept öffnen“), und die Zutaten
kann man von Hand einfügen (eine pro Zeile, gern mit Menge: „400 g Kartoffeln“).

## Gut zu wissen

- **Code ändern:** In der App unter Haushalt → Zugang. Alle anderen Geräte werden beim nächsten Abgleich
  nach dem neuen Code gefragt.
- **Abmelden:** Initialen antippen → *Auf diesem Gerät abmelden*. Danach fragt die App wieder nach dem Code.
- **Abgleich:** Änderungen gehen sofort hoch. Was andere geändert haben, erscheint innerhalb von etwa 15 Sekunden
  und sofort, wenn man die App wieder öffnet.
- **Offline:** Ohne Netz zeigt die App den letzten Stand. Änderungen werden nachgeholt, sobald wieder Netz da ist.
  Gestrichelter Rand um die Initialen = offline.
- **Zweiter Haushalt:** Schritt 2 nochmals ausführen. Es entsteht ein eigener Link mit eigenem Code und eigenen Daten.
