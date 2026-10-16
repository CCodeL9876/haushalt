# Haushalt

Web-App fürs iPhone für den gemeinsamen Haushalt. Reines HTML, CSS und JavaScript, ohne Build-Schritt.

| Bereich | Datei | Was |
|---|---|---|
| Einkauf | `js/views/einkauf.js` | Einkaufsliste; mehrere Artikel mit Komma auf einmal; gemerkte Begriffe als Vorschläge beim Tippen (häufige zuerst, auch Zutaten der Menüideen); „Nach Laden“ gruppiert nach Abteilungen (`js/aisles.js`, Reihenfolge unter Haushalt anpassbar) |
| ToDo | `js/views/todo.js` | Geteilte Listen (für alle im Haushalt) und persönliche (auf dem Gerät, auf Wunsch mit eigenem Passwort verschlüsselt über mehrere eigene Geräte abgeglichen, `js/personal.js`); ToDo mit Datum und Uhrzeit per .ics in den Apple-Kalender (`js/calendar.js`, ohne Server) |
| Essen → Wochenplan | `js/views/wochenplan.js` | Mo–So, Mittag und Abend; Zutaten der Woche auf die Einkaufsliste |
| Essen → Menüideen | `js/views/ideen.js` | Gerichte mit Zutaten, Zubereitung und Stichworten, Suche; „Claude fragen“: Rezeptideen zu vorhandenen Zutaten (`js/ai.js`, Supabase-Funktion `recipe-ideas`); „Planen“ und „Einkaufen“; Rezept per Link einlesen (`js/recipes.js`, Supabase-Funktion `recipe-import`); vor dem Einkaufen Zutaten auswählen, Mengen werden zur Notiz (`js/ingredients.js`) |
| Abrechnung | `js/views/abrechnung.js` | Wer schuldet wem wie viel; fortlaufende Liste aller Rechnungen (ganz oder geteilt) und Zahlungen mit Notiz, Datum, Zahlungsart (Twint, Neon …) und laufendem Stand (`js/settle.js`); `#kosten` führt hierher |
| Haushalt (oben rechts) | `js/views/einstellungen.js` | Personen, Währung, Zahlungsarten, Sicherung als JSON |

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
- `js/refresh.js` – Aktualisieren bei offener App: oben nach unten ziehen oder Haushalt → „App aktualisieren“ (lädt neueste Version und Daten).
- `js/ui.js` – Symbole, Geldbeträge (intern in Rappen), Bottom-Sheet, Meldungen.
- Neuer Bereich: Datei in `js/views/` anlegen und in `VIEWS` in `js/app.js` eintragen.
- Essen (`js/views/essen.js`) fasst Wochenplan und Menüideen unter einem Tab zusammen (Umschalter oben); `#woche` und `#ideen` führen direkt zum jeweiligen Teil.

Beim ersten Start sind Beispieldaten drin (Anna, Ben, drei Menüideen). „Haushalt → Alles zurücksetzen“ leert alles.
