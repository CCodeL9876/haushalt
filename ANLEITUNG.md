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

## 6. ToDo-Listen freischalten (einmalig, für bestehende Datenbanken)

Geteilte ToDo-Listen (und der Abgleich persönlicher Listen) brauchen neue Sammlungen in der Datenbank. Wer die Datenbank schon vorher eingerichtet hat:
**SQL Editor** → **New query** → den ganzen Inhalt von [supabase/schema.sql](supabase/schema.sql) nochmals einfügen →
**Run**. Das ist gefahrlos: Bestehende Daten bleiben, nur die erlaubten Sammlungen werden ergänzt.
Bis dahin meldet die App beim Speichern einer geteilten Liste „Nicht gespeichert“.

Persönliche Listen liegen zunächst nur auf dem jeweiligen Gerät, getrennt pro Person („Wer bist du?“), und nie
in der Sicherung. Wer sie auf mehreren eigenen Geräten haben will (z. B. iPhone und iPad), tippt unter ToDo auf
**„Auf meinen Geräten abgleichen“** und wählt ein eigenes Passwort; auf dem zweiten Gerät dasselbe Passwort
eingeben. Die Listen gehen dann **verschlüsselt** in die Datenbank (AES-256, Schlüssel aus dem Passwort, direkt
im Browser) – die anderen im Haushalt und Supabase sehen nur unlesbaren Text. Das Passwort wird nirgends
gespeichert; vergessen heisst: auf einem Gerät „neu beginnen“ und auf den anderen das neue Passwort eingeben.

## 7. Claude fragen (Rezeptideen zu vorhandenen Zutaten)

Unter **Essen → Menüideen → Claude fragen** gibt man an, was zu Hause ist (und optional Wünsche wie
„vegetarisch, schnell“), und bekommt vier Rezeptvorschläge mit Zutaten, Zubereitung und dem, was noch fehlt.
Ein Vorschlag lässt sich als Menüidee speichern, das Fehlende direkt auf die Einkaufsliste setzen.

Dafür braucht es einen eigenen Schlüssel bei Anthropic (dem Anbieter von Claude) und eine zweite kleine Funktion
in Supabase. Der Schlüssel liegt nur in Supabase, nie in der App.

1. Auf [platform.claude.com](https://platform.claude.com) ein Konto anlegen, unter **Billing** etwas Guthaben
   laden (z. B. 5 Dollar) und unter **API Keys** einen Schlüssel erstellen. Optional unter **Limits** ein
   Monatslimit setzen, damit nie mehr ausgegeben wird als gewollt.
2. Im Supabase-Dashboard das Haushalt-Projekt öffnen → **Edge Functions** → **Secrets** → neues Secret
   `ANTHROPIC_API_KEY` mit dem Schlüssel aus Schritt 1.
3. **Edge Functions** → **Deploy a new function** → **Via Editor**, Name genau `recipe-ideas`, den Inhalt von
   [supabase/functions/recipe-ideas/index.ts](supabase/functions/recipe-ideas/index.ts) hineinkopieren →
   **Deploy function**.
4. Wie bei `recipe-import` die JWT-Prüfung der Funktion ausschalten. Geschützt ist sie trotzdem: Sie antwortet
   nur mit dem Haushalt-Schlüssel und dem richtigen Zugangscode, also nur euch.

**Kosten:** Eine Anfrage kostet bei Anthropic etwa 5–10 Rappen (Schätzung; abgerechnet wird nach Textlänge).
**Datenschutz:** An Anthropic gehen nur die eingegebenen Zutaten und Wünsche sowie die Namen eurer Menüideen
(damit keine doppelt vorgeschlagen werden) – keine Namen von Personen, keine Einkaufs- oder Kostendaten.
Funktioniert nur im gemeinsamen Haushalt, nicht in der lokalen Version ohne Supabase.

## 8. Apple-Kalender (einmalig einrichten)

Unter ToDo lässt sich ein Eintrag mit Datum über **„In Apple-Kalender eintragen“** in den Kalender übernehmen.
Das iPhone bietet „Hinzufügen“ aber nur für Kalenderdateien an, die von einem Server kommen – dafür gibt es eine
kleine Funktion in Supabase:

1. Im Supabase-Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Als Namen genau `calendar` eintragen, den Inhalt von
   [supabase/functions/calendar/index.ts](supabase/functions/calendar/index.ts) hineinkopieren → **Deploy function**.
3. Wie bei `recipe-import` die **JWT-Prüfung ausschalten** – Safari öffnet die Kalender-Adresse ohne Anmeldung.
   Geschützt ist sie trotzdem: Nur wer Haushalt-Link und Zugangscode hat, kann solche Adressen erzeugen, und sie
   gelten nur 10 Minuten.

**Datenschutz:** Titel, Datum und Notiz gehen nur an euer eigenes Supabase-Projekt, verschlüsselt in der Adresse;
die Funktion speichert nichts. Ein Secret muss nicht eingerichtet werden – die Funktion nutzt das, das Supabase
jeder Funktion mitgibt.

Ohne diese Funktion (oder ohne Supabase) lädt die App die Kalenderdatei nur herunter – das klappt am Computer,
am iPhone landet sie höchstens in „Dateien“.

## 9. Kühlschrank freischalten (einmalig, für bestehende Datenbanken)

Unter **Essen → Kühlschrank** werden Reste mit „aufbrauchen bis“ erfasst. Dafür braucht die Datenbank eine neue
Sammlung: **SQL Editor** → **New query** → den ganzen Inhalt von [supabase/schema.sql](supabase/schema.sql) nochmals
einfügen → **Run**. Das ist gefahrlos: Bestehende Daten bleiben. Bis dahin meldet die App beim Erfassen eines Rests
„Nicht gespeichert“.

## 10. Push-Mitteilungen (einmalig einrichten)

Die App verschickt fünf Arten von Mitteilungen – von einer Funktion in Supabase, die ein Zeitplan alle 5 Minuten
aufruft:

- **Morgen-Erinnerung (ToDo):** pro Gerät einstellbar unter **ToDo → Morgen-Erinnerung** – eine Liste, Uhrzeit
  (Standard 7:45) und Wochentage. Die Mitteilung nennt die ToDos, die heute dran sind (fällig bis heute oder ohne
  Datum, Überfälliges zuerst). Ist nichts offen, kommt keine. Antippen öffnet direkt die Liste.
- **Kühlschrank:** Reste **am Vortag** („bis morgen aufbrauchen“) und **am letzten Tag** („heute aufbrauchen“),
  jeweils ab 17 Uhr, an alle Geräte im Haushalt, die Mitteilungen eingeschaltet haben.
- **Vortag (ToDo):** ab 18 Uhr für ToDos in geteilten Listen mit „Am Vortag erinnern“, die morgen fällig sind –
  z. B. Altpapier oder Grüngut aus dem Abfuhrplan. An alle Geräte im Haushalt mit Mitteilungen.
- **Erinnerung vor einem ToDo:** bei ToDos mit Datum, Uhrzeit und „Erinnern“ (5 Min. bis 1 Tag vorher) – an die
  zugewiesene Person, sonst an alle; bei persönlichen Listen nur an dich (Titel und Zeit liegen dafür bis zur
  Mitteilung in der Tabelle push_alarms). Kommt höchstens ein paar Minuten früher, weil der Zeitplan alle 5 Minuten läuft.
- **Abfuhrkalender:** ab 18 Uhr am Vortag einer Abfuhr (Kehricht, Papier, Grüngut …), für jede Art mit Glocke
  unter **App-Einstellungen → Abfuhrkalender**. An alle Geräte im Haushalt mit Mitteilungen.
- **ToDo zugewiesen:** Weist jemand in einer geteilten Liste eine Aufgabe einer anderen Person zu, bekommt diese
  Person eine Mitteilung – auf den Geräten, auf denen sie unter „Wer bist du?“ gewählt ist.

1. **Datenbank:** SQL Editor → New query → den ganzen Inhalt von [supabase/schema.sql](supabase/schema.sql)
   nochmals einfügen → **Run** (neu: Tabellen für die Geräte und für schon Verschicktes).
2. **Geheimer Schlüssel:** Edge Functions → **Secrets** → neues Secret `VAPID_PRIVATE_KEY` mit dem geheimen
   Schlüssel. Er gehört zum öffentlichen Schlüssel `PUSH_PUBLIC_KEY` in [js/config.js](js/config.js) und steht
   bewusst nirgends im Code. Ist er verloren, ein neues Schlüsselpaar erzeugen (P-256, z. B. mit
   `npx web-push generate-vapid-keys`), den öffentlichen Teil in `js/config.js` **und** in
   `supabase/functions/push/index.ts` ersetzen und auf jedem Gerät Mitteilungen aus- und wieder einschalten.
3. **Funktion:** Edge Functions → **Deploy a new function** → **Via Editor**, Name genau `push`, den Inhalt von
   [supabase/functions/push/index.ts](supabase/functions/push/index.ts) hineinkopieren → **Deploy function**.
   Danach wie bei `recipe-import` die **JWT-Prüfung ausschalten**. (Ist die Funktion schon eingerichtet: nach
   jeder Änderung an der Datei den Inhalt dort ersetzen und nochmals **Deploy**.)
4. **Zeitplan:** SQL Editor → New query → den Inhalt von [supabase/push-cron.sql](supabase/push-cron.sql)
   einfügen → **Run**. (Für die Morgen-Erinnerung läuft er neu alle 5 statt alle 60 Minuten – wer ihn schon
   eingerichtet hat, führt die Datei einfach nochmals aus; der alte Zeitplan wird ersetzt.) (Falls eine Meldung zu `pg_cron` oder `pg_net` kommt: unter **Integrations** „Cron“ und
   „pg_net“ aktivieren und nochmals ausführen.)
5. **Auf jedem iPhone:** die App **vom Home-Bildschirm** öffnen (in Safari: Teilen → „Zum Home-Bildschirm“; ab
   iOS 16.4) → oben rechts **Haushalt** → **Mitteilungen einschalten** → erlauben → **Probe senden**.

**Datenschutz:** In Supabase liegt pro Gerät die Adresse beim Push-Dienst (Apple, Google oder Mozilla) mit
Schlüssel, dazu die Einstellung der Morgen-Erinnerung (Liste, Uhrzeit, Tage). Der Inhalt jeder Mitteilung wird für
das Gerät verschlüsselt; der Push-Dienst kann ihn nicht lesen. **Ausnahme persönliche Listen:** Wählt man für die
Morgen-Erinnerung eine persönliche Liste, hinterlegt die App deren offene ToDos (Titel, Datum, Zeit) lesbar in
Supabase – sonst könnte die Funktion sie nicht nennen. Das gilt nur für diese eine Liste und endet mit
„Ausschalten“ oder der Wahl einer anderen Liste. Auf dem Sperrbildschirm erscheinen die Titel; wer das nicht
möchte, stellt am iPhone unter Einstellungen → Mitteilungen → Haushalt die Vorschau auf „Wenn entsperrt“.

## 11. Kalender auf der Startseite (einmalig einrichten)

Unter **App-Einstellungen → Kalender auf der Startseite** lassen sich Kalender aus der Apple-Kalender-App eintragen; ihre
Termine von heute stehen dann auf der Startseite unter **„Dein Tag“** – zusammen mit den ToDos mit Uhrzeit.
Eine Web-App darf nicht direkt in den Kalender des iPhones schauen, darum liest sie den Link
„Öffentlicher Kalender“ – über eine kleine Funktion in Supabase:

1. Im Supabase-Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Als Namen genau `calendar-feed` eintragen, den Inhalt von
   [supabase/functions/calendar-feed/index.ts](supabase/functions/calendar-feed/index.ts) hineinkopieren → **Deploy function**.
3. Wie bei `recipe-import` die **JWT-Prüfung ausschalten**. Geschützt ist sie trotzdem: Sie antwortet nur mit dem
   Haushalt-Schlüssel und dem richtigen Zugangscode.

Danach in der App: **App-Einstellungen → Kalender auf der Startseite → Kalender hinzufügen**. Den Link gibt es am iPhone in
der Kalender-App unter **Kalender → ⓘ beim Kalender → Öffentlicher Kalender → Link teilen … → Kopieren** (nur bei
iCloud-Kalendern; bei Google die „geheime Adresse im iCal-Format“). **Für alle im Haushalt** speichert den Kalender
für alle, **Nur dieses Gerät** nur auf dem eigenen iPhone (z. B. „Arbeit“).

**Abonnierte Kalender, z. B. Sport:** den Link nehmen, mit dem der Kalender abonniert wurde (beginnt meist mit
`webcal://`), und als Darstellung **Klein (Sport)** mit einem Symbol wählen. Solche Termine stehen nicht in
„Dein Tag“, sondern als schmale Leiste **„Sport diese Woche“** (die nächsten 7 Tage, heute hervorgehoben;
antippen zeigt den ganzen Titel). Schon eingetragene Kalender lassen sich unter App-Einstellungen → Kalender antippen und
umstellen.

**Datenschutz:** Wer den Link kennt, kann den Kalender lesen – nicht weitergeben. Die Funktion holt die Termine der
nächsten 7 Tage und speichert nichts; die Termine liegen nur zwischengespeichert auf dem Gerät und werden alle
15 Minuten erneuert. Neue Termine erscheinen darum mit etwas Verzögerung (auch iCloud aktualisiert den öffentlichen
Kalender nicht sofort).

## Gut zu wissen

- **Code ändern:** In der App unter App-Einstellungen → Zugang → *Code ändern*. Alle anderen Geräte werden beim nächsten
  Abgleich nach dem neuen Code gefragt. Zugleich werden in Supabase alle anderen Geräte von den Mitteilungen
  abgemeldet; eure eigenen melden sich nach Eingabe des neuen Codes von selbst wieder an (dafür einmal
  schema.sql nochmals ausführen).
- **Sicherung:** App-Einstellungen → Daten → *Sicherung*: eine Datei mit allen Daten, verschlüsselt mit einem Passwort
  (auf Wunsch mit den eigenen persönlichen Listen). Ohne Passwort lässt sie sich nicht öffnen.
- **Aufräumen:** Erledigte ToDos und Einkäufe werden 30 Tage nach dem Abhaken gelöscht, Einträge der Abrechnung
  nach 12 Monaten – aber nur bis zum letzten Zeitpunkt, an dem ihr quitt wart. Der Stand bleibt so gleich.
- **Wiederkehrende ToDos:** ToDo antippen → *Wiederholen* (jede Woche, alle 2 Wochen … oder „Nach Plan“ mit festen
  Daten). Den Abfuhrkalender der Gemeinde als Kalender-Datei (.ics) einlesen: Liste öffnen → Zahnrad →
  *Kalender-Datei wählen*.
- **Abmelden:** Initialen antippen → *Auf diesem Gerät abmelden*. Danach fragt die App wieder nach dem Code.
- **Abgleich:** Änderungen gehen sofort hoch. Was andere geändert haben, erscheint innerhalb von etwa 15 Sekunden
  und sofort, wenn man die App wieder öffnet.
- **Offline:** Ohne Netz zeigt die App den letzten Stand. Änderungen werden nachgeholt, sobald wieder Netz da ist.
  Gestrichelter Rand um die Initialen = offline.
- **Zweiter Haushalt:** Schritt 2 nochmals ausführen. Es entsteht ein eigener Link mit eigenem Code und eigenen Daten.
