// Geld: gemeinsame Abrechnung und persönliche Planung unter einem Tab, oben umschaltbar (wie Essen, js/views/essen.js).
// Die Planung liegt nur auf diesem Gerät (js/planung.js). Jedes Gerät merkt sich, welcher Teil zuletzt offen war.
// #abrechnung zeigt den zuletzt offenen Teil, #kosten die Abrechnung, #planung die Planung.

import { refresh } from '../store.js';
import abrechnung from './abrechnung.js';
import planung from './planung.js';

const PARTS = [abrechnung, planung];
const PART_KEY = 'haushalt.geld';

let partId = (() => { try { const v = localStorage.getItem(PART_KEY); return PARTS.some((p) => p.id === v) ? v : 'abrechnung'; } catch { return 'abrechnung'; } })();
const part = () => PARTS.find((p) => p.id === partId) || PARTS[0];

function choose(id) {
  const target = id === 'kosten' ? 'abrechnung' : id;
  if (!PARTS.some((p) => p.id === target)) return;
  partId = target;
  try { localStorage.setItem(PART_KEY, target); } catch { /* privates Fenster */ }
}

export default {
  id: 'abrechnung',
  tab: 'Geld',
  icon: 'wallet',
  aliases: ['kosten', 'planung'],
  get title() { return part().title; },

  // Aufruf über #abrechnung (ohne Zusatz) zeigt den zuletzt offenen Teil; #planung bzw. #kosten gezielt
  enter(id) { choose(id); },

  render() {
    return `
      <div class="seg seg-wide" role="group" aria-label="Geld">
        ${PARTS.map((p) => `<button type="button" class="seg-btn" data-action="geldPart" data-part="${p.id}" aria-pressed="${p.id === partId}">${p.short || p.title}</button>`).join('')}
      </div>
      ${part().render()}`;
  },

  get actions() {
    return {
      ...part().actions,
      geldPart(el) {
        choose(el.dataset.part);
        document.getElementById('view-title').textContent = part().title;
        document.title = `${part().title} · Haushalt`;
        refresh();
        window.scrollTo(0, 0);
      },
    };
  },
  get submit() { return part().submit; },
  get input() { return part().input; },
  get change() { return part().change; },
};
