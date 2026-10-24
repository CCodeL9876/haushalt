# Haushalt

Web-App fürs iPhone für den gemeinsamen Haushalt. Reines HTML, CSS und JavaScript, ohne Build-Schritt.

| Bereich | Datei | Was |
|---|---|---|
| Heute (Start) | `js/views/heute.js` | Startseite als Kacheln: Menü von heute (fehlende Zutaten mit einem Tipp auf die Liste), fällige ToDos zum Abhaken, Abfuhrkalender, Kühlschrank |
| Abfuhrkalender | `js/waste.js` | Kalender-Datei (.ics) der Gemeinde unter Haushalt einlesen (nur Termine ab heute); Kachel „Entsorgung“ auf Heute mit dem nächsten Termin pro Art; Mitteilung am Vortag pro Art |
| Plus (Mitte der Tab-Leiste) | `js/quickadd.js` | Einfach eintippen – erkennt im Gerät Einkauf, ToDo (mit Tag/Uhrzeit), Menü oder Rechnung (mit Betrag); Art änderbar |
| ToDo → Packliste | `js/packliste.js` | Listenart „Packliste“ (Umschalter ToDo/Packliste beim Anlegen, Vorlagen als Kacheln mit Vorschau, Zusatz-Pakete Baby/Hund/Velo/Wintersport/Arbeit, Tage mit −/+), geteilt oder nur für mich: nach Kategorien, Gepacktes bleibt sichtbar, Fortschritt, „Neu packen“; Vorlagen (Strandferien, Städtetrip, Ab in die Berge, eigene) und Zusatz-Pakete verwaltbar unter Haushalt → Packlisten-Vorlagen: Inhalte entfernen/ergänzen, Name/Symbol/Tage, ausblenden, auf Original zurücksetzen; Mengen pro Tag nach Reisedauer; wer packt was („Nur meine“); „Fehlt noch → Einkaufsliste“ |
| Abhaken | `js/celebrate.js` | Bildeffekt (Tupfer, grosses Häkchen, „Good job!“ oder Zufall) und Ton beim Erledigen eines ToDos, grössere Ladung wenn die Liste erledigt ist; pro Gerät: Ton und Effekt / nur Effekt / aus (Haushalt → „Beim Abhaken“) |
| Geld → Planung | `js/planung.js`, `js/views/planung.js`, `js/views/geld.js` | Persönliche Finanzplanung **nur auf diesem Gerät** (nie in Supabase, nie im Abgleich, nie in der Haushalts-Sicherung): Kosten fix/wiederkehrend (nicht monatliche pro Monat aktivieren), Rechnungen mit Teilzahlungen, Ratenplan und Stand an einem Datum, Abos monatlich/jährlich, Einnahmen monatlich/einmalig; Monatsrechnung ohne Multiplizieren, „Bis Ende Jahr“ auf Wunsch; doppelt abgelegt (localStorage + IndexedDB), verschlüsselte Sicherungsdatei mit Erinnerung nach 14 Tagen; Beträge verdeckt |
| Einkauf | `js/views/einkauf.js` | Einkaufsliste; mehrere Artikel mit Komma auf einmal; gemerkte Begriffe als Vorschläge beim Tippen (häufige zuerst, auch Zutaten der Menüideen); „Nach Laden“ gruppiert nach Abteilungen (`js/aisles.js`, Reihenfolge unter Haushalt anpassbar); „Begriffe“: Vorschläge erfassen, umbenennen, Abteilung ändern, löschen (`js/terms.js`); Stern markiert Wichtiges, steht zuoberst; Einkaufsmodus für den Laden (Vollbild, grosse Schrift, Bildschirm bleibt an); Kundenkarten (Cumulus, Supercard …) als Strichcode, nur auf dem Gerät (`js/cards.js`, `js/barcode.js`) |
| ToDo | `js/views/todo.js` | Geteilte Listen (für alle im Haushalt) und persönliche (auf dem Gerät, auf Wunsch mit eigenem Passwort verschlüsselt über mehrere eigene Geräte abgeglichen, `js/personal.js`); ToDos in geteilten Listen einer Person zuweisen („Für wen?“, Initialen in der Liste); ToDo mit Datum und Uhrzeit in den Apple-Kalender (`js/calendar.js`, am iPhone über die Supabase-Funktion `calendar`) ; Morgen-Erinnerung als Push-Mitteilung (`js/reminder.js`, Supabase-Funktion `push`); Erinnerung vor einem ToDo per Mitteilung (`js/alarms.js`) |
| Essen → Wochenplan | `js/views/wochenplan.js` | Mo–So, Mittag und Abend; Zutaten der Woche auf die Einkaufsliste; oben Hinweis auf Reste im Kühlschrank; beim Gericht „Reste in den Kühlschrank“ |
| Essen → Kühlschrank | `js/views/kuehlschrank.js` | Reste und Angebrochenes mit „aufbrauchen bis“, Dringendes zuoberst; Haltbarkeit vorgeschlagen (Richtwerte bzw. zuletzt gewählt, `js/fridge.js`); Schnellwahl für früher Erfasstes; Reste gehen bei „Claude fragen“ als vorhandene Zutaten mit |
| Essen → Menüideen | `js/views/ideen.js` | Gerichte mit Zutaten, Zubereitung und Stichworten, Suche; „Claude fragen“: Rezeptideen zu vorhandenen Zutaten (`js/ai.js`, Supabase-Funktion `recipe-ideas`); „Planen“ und „Einkaufen“; Rezept per Link einlesen (`js/recipes.js`, Supabase-Funktion `recipe-import`); vor dem Einkaufen Zutaten auswählen, Mengen werden zur Notiz (`js/ingredients.js`) |
| Abrechnung | `js/views/abrechnung.js` | Wer schuldet wem wie viel; fortlaufende Liste aller Rechnungen (ganz oder geteilt) und Zahlungen mit Notiz, Datum, Zahlungsart (Twint, Neon …) und laufendem Stand (`js/settle.js`); `#kosten` führt hierher |
| Haushalt (oben rechts) | `js/views/einstellungen.js` | Personen, Hell/Dunkel (Automatisch, Hell, Dunkel – pro Gerät), Farbdesign (pro Gerät), Währung, Zahlungsarten, Sicherung als JSON |

## Starten

```sh
python3 serve.py          # → http://localhost:5180 (eigener Port: 5173 gehört der Mallorca-App)
```

Am iPhone im gleichen WLAN: `http://<IP-des-Macs>:5180` öffnen. Der Offline-Modus und „Zum Home-Bildschirm“
mit eigenem Symbol funktionieren erst über https (z. B. GitHub Pages).

## Anmeldung (wie bei Aperol Sprintz)

Link mit geheimem Schlüssel → Zugangscode → „Wer bist du?“ → Initialen oben rechts. Dafür braucht es ein eigenes
Supabase-Projekt. Einrichten: siehe [ANLEITUNG.md](ANLEITUNG.md). Solange `js/config.js` leer ist, läuft die App
ohne Anmeldung und nur lokal (mit Beispieldaten).

## Aufbau

- `js/store.js` – alle Daten; Aufbau dort beschrieben. Lokal im localStorage oder gemeinsam in Supabase
  (nur geänderte Einträge werden hochgeladen, Änderungen der anderen alle 15 s abgeholt).
- `js/login.js` – Anmeldung (Link, Code, „Wer bist du?“) und Initialen-Knopf; `js/session.js` – was das Gerät sich merkt.
- `js/remote.js` – Zugriff auf Supabase (REST, ohne Zusatzbibliothek); `supabase/schema.sql` – Tabellen und Zugriffsschutz.
- `js/app.js` – Tab-Leiste, Wechsel der Ansichten, Weiterleitung der Klicks (`data-action`, `data-form`, `data-input`).
- `js/push.js` – Push-Mitteilungen ein-/ausschalten (Haushalt-Fenster); `sw.js` zeigt sie an; verschickt von `supabase/functions/push` (Kühlschrank-Erinnerungen ab 17 Uhr, Zeitplan `supabase/push-cron.sql`; „ToDo zugewiesen“ an die Geräte der Person).
- `js/refresh.js` – Aktualisieren bei offener App: oben nach unten ziehen oder Haushalt → „App aktualisieren“ (lädt neueste Version und Daten).
- `js/ui.js` – Symbole, Geldbeträge (intern in Rappen), Bottom-Sheet, Meldungen.
- Neuer Bereich: Datei in `js/views/` anlegen und in `VIEWS` in `js/app.js` eintragen.
- Essen (`js/views/essen.js`) fasst Wochenplan, Kühlschrank, Menüideen und Statistik (`js/views/statistik.js`: wie oft welches Gericht im Plan stand, 3 Monate / 12 Monate / alle) unter einem Tab zusammen (Umschalter oben); `#woche`, `#kuehlschrank` und `#ideen` führen direkt zum jeweiligen Teil.

Beim ersten Start sind Beispieldaten drin (Anna, Ben, drei Menüideen). „Haushalt → Alles zurücksetzen“ leert alles.

## Farbdesigns

Standard ist „Creme“ (Farben in `css/styles.css`, `:root`). Weitere Designs wählt jedes Gerät selbst unter
**Haushalt → Farbdesign**; `js/palette-boot.js` setzt die Wahl beim Start, bevor die Seite gezeichnet wird.
Die Farbwerte der weiteren Designs erzeugt `tools/make-palettes.py` aus je vier Grundfarben (hell und dunkel,
mit Kontrastprüfung) nach `css/palettes.css` und `js/palettes.js`. Neues Design: dort in `PALETTES` eintragen
und `python3 tools/make-palettes.py` ausführen.
