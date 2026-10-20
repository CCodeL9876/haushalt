// Farbdesign dieses Geräts setzen, bevor die Seite gezeichnet wird (kein Aufflackern der Standardfarben).
// Gewählt wird unter Haushalt → Farbdesign (js/views/einstellungen.js); gilt nur für dieses Gerät.
try {
  var palette = localStorage.getItem('haushalt.palette');
  if (palette && palette !== 'creme') document.documentElement.setAttribute('data-palette', palette);
  // Hell/Dunkel: „light“ oder „dark“ erzwingt es unabhängig vom iPhone; ohne Eintrag folgt die App dem iPhone
  var theme = localStorage.getItem('haushalt.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) { /* privates Fenster: Standard-Design */ }
