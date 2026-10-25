// Einkaufsbegriffe verwalten: die Wörter, die beim Einkauf vorgeschlagen werden (state.terms), nach Abteilung im
// Laden geordnet. Hier lassen sich Begriffe neu erfassen, umbenennen, einer anderen Abteilung zuordnen oder löschen.
// Die Abteilung gilt für den ganzen Haushalt und bestimmt die Sortierung „Nach Laden“ (js/aisles.js).
// Erreichbar im Einkauf („Begriffe“) und unter Haushalt.

import { state, termKey, update } from './store.js';
import { esc, icon, openSheet, toast } from './ui.js';
import { AISLES, aisleLabel, aisleOf, aisleOrder, guessAisle } from './aisles.js';

const aisleOptions = (selected, auto) => `
  <option value="" ${selected ? '' : 'selected'}>Automatisch${auto ? ` (${esc(aisleLabel(auto))})` : ''}</option>
  ${AISLES.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}`;

const used = (t) => (t.count ? `${t.count}× auf der Liste` : 'noch nie auf der Liste');

function listHtml(query = '') {
  const q = query.trim().toLowerCase();
  const groups = new Map(aisleOrder(state.settings).map((id) => [id, []]));
  for (const t of state.terms) {
    if (q && !t.name.toLowerCase().includes(q)) continue;
    groups.get(aisleOf(t.name, state.terms))?.push(t);
  }
  const html = [...groups].filter(([, list]) => list.length).map(([id, list]) => `
    <h3 class="aisle-title">${esc(aisleLabel(id))} <span class="muted">(${list.length})</span></h3>
    <ul class="list">${list.sort((a, b) => a.name.localeCompare(b.name, 'de')).map((t) => `
      <li><button type="button" class="list-main" data-sheet-action="edit" data-id="${esc(t.id)}">
        ${esc(t.name)}<small>${used(t)}${t.aisle ? '' : ' · Abteilung erkannt'}</small>
      </button>${icon('right', 'icon-sm muted')}</li>`).join('')}
    </ul>`).join('');
  return html || `<p class="muted small" style="text-align:center;padding:16px 0">${q ? 'Kein Begriff gefunden.' : 'Noch keine Begriffe – oben den ersten erfassen.'}</p>`;
}

export function openTerms() {
  const form = openSheet({
    title: `Einkaufsbegriffe (${state.terms.length})`,
    body: `
      <p class="muted small" style="margin:0 0 12px">Werden beim Tippen im Einkauf vorgeschlagen. Die Abteilung bestimmt die Sortierung „Nach Laden“ – für alle im Haushalt.</p>
      <div class="field"><span>Neuer Begriff</span>
        <input class="input" name="newTerm" placeholder="z. B. Hafermilch" autocomplete="off" maxlength="64">
        <div class="add-row" style="margin:8px 0 0">
          <select class="select" name="newAisle" aria-label="Abteilung">${aisleOptions('', '')}</select>
          <button type="button" class="btn btn-primary" data-sheet-action="add" aria-label="Begriff hinzufügen">${icon('plus')}</button>
        </div>
      </div>
      <div class="search" style="margin-top:4px">
        ${icon('search')}
        <input class="input" type="search" name="q" placeholder="Begriff suchen" autocomplete="off" aria-label="Begriffe durchsuchen">
      </div>
      <div class="terms-list">${listHtml()}</div>`,
    actions: {
      add(_, f) {
        const name = f.elements.newTerm.value.trim().replace(/\s+/g, ' ');
        if (!name) return f.elements.newTerm.focus();
        const id = termKey(name);
        const aisle = f.elements.newAisle.value;
        const existing = state.terms.find((t) => t.id === id);
        update((s) => {
          const t = s.terms.find((x) => x.id === id);
          if (t) { if (aisle) t.aisle = aisle; } else s.terms.push({ id, name: name.slice(0, 64), count: 0, lastUsed: 0, ...(aisle ? { aisle } : {}) });
        });
        toast(existing ? `„${existing.name}“ gab es schon${aisle ? ' – Abteilung angepasst' : ''}` : `„${name}“ erfasst: ${aisleLabel(aisleOf(name, state.terms))}`);
        f.elements.newTerm.value = '';
        f.elements.newAisle.innerHTML = aisleOptions('', '');
        f.querySelector('.terms-list').innerHTML = listHtml(f.elements.q.value);
        f.querySelector('.sheet-head h2').textContent = `Einkaufsbegriffe (${state.terms.length})`;
        f.elements.newTerm.focus();
      },
      edit(btn) { editTerm(btn.dataset.id); },
    },
  });
  // Beim Tippen: erkannte Abteilung anzeigen, Liste filtern
  form.elements.newTerm.addEventListener('input', () => {
    const name = form.elements.newTerm.value.trim();
    const chosen = form.elements.newAisle.value;
    form.elements.newAisle.innerHTML = aisleOptions(chosen, name ? aisleOf(name, state.terms) : '');
  });
  form.elements.q.addEventListener('input', () => {
    form.querySelector('.terms-list').innerHTML = listHtml(form.elements.q.value);
  });
  // Enter im Feld „Neuer Begriff“ fügt hinzu (statt das ganze Fenster abzuschicken)
  form.elements.newTerm.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    form.querySelector('[data-sheet-action="add"]').click();
  });
}

function editTerm(id) {
  const term = state.terms.find((t) => t.id === id);
  if (!term) return openTerms();
  const current = term.aisle || '';
  openSheet({
    title: term.name,
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" value="${esc(term.name)}" required maxlength="64" autocomplete="off">
      </label>
      <div class="field"><span>Abteilung im Laden</span>
        <div class="chips">
          <label class="chip chip-toggle"><input type="radio" name="aisle" value="" ${current ? '' : 'checked'}>Automatisch (${esc(aisleLabel(guessAisle(term.name)))})</label>
          ${AISLES.map((a) => `<label class="chip chip-toggle"><input type="radio" name="aisle" value="${esc(a.id)}" ${a.id === current ? 'checked' : ''}>${esc(a.label)}</label>`).join('')}
        </div>
      </div>
      <p class="muted small">${used(term)}</p>`,
    submitLabel: 'Speichern',
    footer: `
      <button type="button" class="btn btn-block" data-sheet-action="back">Zurück zur Liste</button>
      <button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Begriff löschen</button>`,
    onSubmit(data) {
      const name = String(data.get('name')).trim().replace(/\s+/g, ' ').slice(0, 64);
      const aisle = String(data.get('aisle') || '');
      if (!name) return false;
      const newId = termKey(name);
      update((s) => {
        const t = s.terms.find((x) => x.id === id);
        if (!t) return;
        const clash = newId !== id && s.terms.find((x) => x.id === newId);
        if (clash) {
          // Umbenannt in einen Begriff, den es schon gibt: zusammenlegen
          clash.count = (clash.count || 0) + (t.count || 0);
          clash.lastUsed = Math.max(clash.lastUsed || 0, t.lastUsed || 0);
          if (aisle) clash.aisle = aisle; else delete clash.aisle;
          s.terms = s.terms.filter((x) => x.id !== id);
        } else {
          Object.assign(t, { id: newId, name });
          if (aisle) t.aisle = aisle; else delete t.aisle;
        }
      });
      setTimeout(openTerms); // nach dem Schliessen zurück zur Liste
    },
    actions: {
      back() { openTerms(); },
      remove() {
        if (!confirm(`„${term.name}“ löschen? Er wird dann nicht mehr vorgeschlagen.`)) return;
        update((s) => { s.terms = s.terms.filter((t) => t.id !== id); });
        openTerms();
      },
    },
  });
}

