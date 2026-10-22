// Farbdesign dieses Geräts setzen, bevor die Seite gezeichnet wird (kein Aufflackern der Standardfarben).
// Gewählt wird unter Haushalt → Farbdesign (js/views/einstellungen.js); gilt nur für dieses Gerät.
try {
  var palette = localStorage.getItem('haushalt.palette');
  if (palette && palette !== 'creme') document.documentElement.setAttribute('data-palette', palette);
  // Hell/Dunkel: „light“ oder „dark“ erzwingt es unabhängig vom iPhone; ohne Eintrag folgt die App dem iPhone
  var theme = localStorage.getItem('haushalt.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) { /* privates Fenster: Standard-Design */ }

// Statusleiste (Uhr, Akku) der App vom Home-Bildschirm: Im dunklen Modus durchsichtig, damit der dunkle Hintergrund
// bis ganz oben reicht (Schrift dort weiss). Im hellen Modus wie gehabt – weisse Uhr auf hellem Grund wäre unlesbar.
// iOS liest das beim Start der App; nach einem Wechsel unter Haushalt → Hell/Dunkel gilt es ab dem nächsten Start.
// Auch von js/views/einstellungen.js aufgerufen.
function haushaltStatusBar() {
  var forced = document.documentElement.getAttribute('data-theme');
  var dark = forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  var meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (meta) meta.content = dark ? 'black-translucent' : 'default';
}
haushaltStatusBar();
