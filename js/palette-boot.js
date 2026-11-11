// Farbdesign dieses Geräts setzen, bevor die Seite gezeichnet wird (kein Aufflackern der Standardfarben).
// Gewählt wird unter App-Einstellungen → Farbdesign (js/views/einstellungen.js); gilt nur für dieses Gerät.
try {
  var palette = localStorage.getItem('haushalt.palette');
  if (palette && palette !== 'creme') document.documentElement.setAttribute('data-palette', palette);
  // Hell/Dunkel: „light“ oder „dark“ erzwingt es unabhängig vom iPhone; ohne Eintrag folgt die App dem iPhone
  var theme = localStorage.getItem('haushalt.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  // App-Symbol (App-Einstellungen → App-Symbol): iOS übernimmt es beim Hinzufügen zum Home-Bildschirm
  var appIcon = localStorage.getItem('haushalt.icon') || 'schluessel';
  if (appIcon !== 'schluessel') haushaltAppIcon(appIcon);
} catch (e) { /* privates Fenster: Standard-Design */ }

// Symbol für Home-Bildschirm und Browser-Tab setzen ('haus' = früheres Symbol)
function haushaltAppIcon(id) {
  var touch = document.querySelector('link[rel="apple-touch-icon"]');
  var fav = document.querySelector('link[rel="icon"]');
  if (touch) touch.href = id === 'haus' ? 'assets/icon-180.png' : 'assets/icon-' + id + '-180.png';
  if (fav) fav.href = id === 'haus' ? 'assets/favicon.svg' : 'assets/favicon-' + id + '.svg';
}

// Statusleiste (Uhr, Akku) der App vom Home-Bildschirm: Im dunklen Modus durchsichtig, damit der dunkle Hintergrund
// bis ganz oben reicht (Schrift dort weiss). Im hellen Modus wie gehabt – weisse Uhr auf hellem Grund wäre unlesbar.
// iOS liest das beim Start der App; nach einem Wechsel unter App-Einstellungen → Hell/Dunkel gilt es ab dem nächsten Start.
// Auch von js/views/einstellungen.js aufgerufen.
function haushaltStatusBar() {
  var forced = document.documentElement.getAttribute('data-theme');
  // Design „Glas“ ist immer dunkel (css/glas.css)
  var dark = document.documentElement.getAttribute('data-palette') === 'glas'
    || (forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  var meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (meta) meta.content = dark ? 'black-translucent' : 'default';
}
haushaltStatusBar();
