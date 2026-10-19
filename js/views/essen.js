// Essen: Wochenplan, Kühlschrank, Menüideen und Statistik unter einem Tab, oben umschaltbar. Die Teile bleiben eigene
// Dateien (wochenplan.js, kuehlschrank.js, ideen.js, statistik.js); diese hier zeigt die gewählte und leitet Klicks und Eingaben an sie weiter.
// Jedes Gerät merkt sich, welche zuletzt offen war. Adressen wie #woche, #ideen, #kuehlschrank führen direkt dorthin.

import { refresh } from '../store.js';
import wochenplan from './wochenplan.js';
import kuehlschrank from './kuehlschrank.js';
import ideen from './ideen.js';
import statistik from './statistik.js';

const PARTS = [wochenplan, kuehlschrank, ideen, statistik];
const PART_KEY = 'haushalt.essen';

let partId = (() => { try { const v = localStorage.getItem(PART_KEY); return PARTS.some((p) => p.id === v) ? v : 'woche'; } catch { return 'woche'; } })();
const part = () => PARTS.find((p) => p.id === partId) || PARTS[0];

function choose(id) {
  if (!PARTS.some((p) => p.id === id)) return;
  partId = id;
  try { localStorage.setItem(PART_KEY, id); } catch { /* privates Fenster */ }
}

export default {
  id: 'essen',
  title: 'Essen',
  icon: 'utensils',
  aliases: PARTS.map((p) => p.id),

  // Aufruf über #woche oder #ideen: gleich diesen Teil zeigen
  enter(id) { choose(id); },

  render() {
    return `
      <div class="seg seg-wide seg-parts" role="group" aria-label="Essen">
        ${PARTS.map((p) => `<button type="button" class="seg-btn" data-action="essenPart" data-part="${p.id}" aria-pressed="${p.id === partId}">${p.short || p.title}</button>`).join('')}
      </div>
      ${part().render()}`;
  },

  get actions() {
    return {
      ...part().actions,
      essenPart(el) {
        choose(el.dataset.part);
        refresh();
        window.scrollTo(0, 0);
      },
    };
  },
  get submit() { return part().submit; },
  get input() { return part().input; },
};
