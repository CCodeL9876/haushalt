// Farbdesign dieses Geräts setzen, bevor die Seite gezeichnet wird (kein Aufflackern der Standardfarben).
// Gewählt wird unter Haushalt → Farbdesign (js/views/einstellungen.js); gilt nur für dieses Gerät.
try {
  var palette = localStorage.getItem('haushalt.palette');
  if (palette && palette !== 'creme') document.documentElement.setAttribute('data-palette', palette);
} catch (e) { /* privates Fenster: Standard-Design */ }
