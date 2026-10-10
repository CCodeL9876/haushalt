# Haushalt

Web-App fürs iPhone für den gemeinsamen Haushalt. Reines HTML, CSS und JavaScript, ohne Build-Schritt.

| Bereich | Datei | Was |
|---|---|---|
| Einkauf | `js/views/einkauf.js` | Einkaufsliste; mehrere Artikel mit Komma auf einmal; gemerkte Begriffe als Vorschläge beim Tippen (häufige zuerst, auch Zutaten der Menüideen); „Nach Laden“ gruppiert nach Abteilungen (`js/aisles.js`, Reihenfolge unter Haushalt anpassbar) |
| Wochenplan | `js/views/wochenplan.js` | Mo–So, Mittag und Abend; Zutaten der Woche auf die Einkaufsliste |
| Menüideen | `js/views/ideen.js` | Gerichte mit Zutaten und Stichworten, Suche, „Planen“ und „Einkaufen“; Rezept per Link einlesen (`js/recipes.js`, Supabase-Funktion `recipe-import`); vor dem Einkaufen Zutaten auswählen, Mengen werden zur Notiz (`js/ingredients.js`) |
| Kosten | `js/views/kosten.js` | Ausgaben pro Monat, Summe nach Kategorie, wer bezahlt / auf wen aufgeteilt |
| Abrechnung | `js/views/abrechnung.js` | Saldo pro Person, Vorschlag mit möglichst wenigen Zahlungen (`js/settle.js`) |
| Haushalt (oben rechts) | `js/views/einstellungen.js` | Personen, Währung, Kategorien, Sicherung als JSON |

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
- `js/ui.js` – Symbole, Geldbeträge (intern in Rappen), Bottom-Sheet, Meldungen.
- Neuer Bereich: Datei in `js/views/` anlegen und in `VIEWS` in `js/app.js` eintragen.

Beim ersten Start sind Beispieldaten drin (Anna, Ben, drei Menüideen). „Haushalt → Alles zurücksetzen“ leert alles.
