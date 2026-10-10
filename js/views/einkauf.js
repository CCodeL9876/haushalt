// Einkaufsliste: offene Artikel oben, erledigte darunter (zum Wiederverwenden oder Aufräumen).
// Jeder Artikel, der auf die Liste kommt, wird als Begriff gemerkt (state.terms, für den ganzen Haushalt) –
// beim Tippen erscheinen passende Begriffe als Vorschläge, bei leerem Feld die häufigsten.

import { refresh, state, update, uid, termKey } from '../store.js';
import { closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { AISLES, aisleLabel, aisleOf, aisleOrder } from '../aisles.js';
import { isStaple, splitIngredient } from '../ingredients.js';

// Sortierung der offenen Artikel – jedes Gerät merkt sich seine: 'laden' (nach Abteilungen) oder 'neu'
const SORT_KEY = 'haushalt.shopSort';
const sortMode = () => { try { return localStorage.getItem(SORT_KEY) === 'neu' ? 'neu' : 'laden'; } catch { return 'laden'; } };

const MAX_SUGGESTIONS = 8;

// Begriff merken bzw. als erneut gebraucht zählen. Die Schreibweise vom ersten Mal bleibt.
function rememberTerm(s, name) {
  const id = termKey(name);
  if (!id) return;
  const term = s.terms.find((t) => t.id === id);
  if (term) {
    term.count = (term.count || 0) + 1;
    term.lastUsed = Date.now();
  } else {
    s.terms.push({ id, name: name.slice(0, 64), count: 1, lastUsed: Date.now() });
  }
}

// Auch von Wochenplan und Menüideen genutzt. Gibt zurück, wie viele Artikel neu dazukamen.
// entries: Texte oder { name, note } (note z. B. die Menge aus dem Rezept; wird vor `note` gestellt).
// Doppelte (gleicher Name, egal ob gross/klein) werden nicht nochmals angelegt; erledigte wieder geöffnet.
export function addToShopping(entries, note = '') {
  let added = 0;
  update((s) => {
    for (const entry of entries) {
      const name = String(typeof entry === 'string' ? entry : entry?.name || '').trim();
      if (!name) continue;
      const itemNote = [typeof entry === 'string' ? '' : entry.note, note].filter(Boolean).join(' · ');
      rememberTerm(s, name);
      const existing = s.shopping.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing && !existing.done) continue;
      if (existing) {
        existing.done = false;
        existing.note = itemNote || existing.note;
      } else {
        s.shopping.unshift({ id: uid(), name, note: itemNote, done: false, addedAt: Date.now() });
      }
      added += 1;
    }
  });
  return added;
}

// Zutaten eines Rezepts (oder mehrerer) auf die Einkaufsliste – vorher auswählen. Grundzutaten (Salz, Öl …) und
// was schon auf der Liste steht, sind anfangs abgewählt. lines: Rezeptzeilen wie „400 g Kartoffeln“.
export function shopIngredients(lines, label = '') {
  const seen = new Set();
  const items = lines.map(splitIngredient).filter((it) => {
    const key = termKey(it.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!items.length) return toast('Keine Zutaten hinterlegt');
  const open = new Set(state.shopping.filter((i) => !i.done).map((i) => termKey(i.name)));
  openSheet({
    title: 'Auf die Einkaufsliste',
    body: `
      ${label ? `<p class="muted small" style="margin:0 0 10px">${esc(label)}</p>` : ''}
      <div class="pick-list">${items.map((it, n) => {
        const onList = open.has(termKey(it.name));
        return `<label class="pick-row">
          <input type="checkbox" name="i${n}" ${isStaple(it.name) || onList ? '' : 'checked'}>
          <span class="list-main">${esc(it.name)}<small>${esc([it.amount, onList ? 'steht schon auf der Liste' : isStaple(it.name) ? 'meist zu Hause' : ''].filter(Boolean).join(' · '))}</small></span>
        </label>`;
      }).join('')}</div>`,
    submitLabel: 'Hinzufügen',
    onSubmit(data) {
      const chosen = items.filter((_, n) => data.get(`i${n}`));
      if (!chosen.length) return;
      const count = addToShopping(chosen.map((it) => ({ name: it.name, note: it.amount })), label);
      toast(`${count} ${count === 1 ? 'Artikel' : 'Artikel'} auf der Einkaufsliste`);
    },
  });
}

// Für den Vergleich: klein, ohne Akzente/Umlaut-Punkte – „apfel“ findet „Äpfel“, „cafe“ findet „Café“
const plain = (text) => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Vorschläge zum Text im Feld. Gemeint ist der Teil nach dem letzten Komma („Milch, Br“ → „Br“).
// Quelle: gemerkte Begriffe und die Zutaten der Menüideen. Ohne Eingabe: die häufigsten Begriffe.
// Was schon offen auf der Liste oder weiter vorne im Feld steht, wird nicht vorgeschlagen.
function suggestions(text) {
  const parts = text.split(',');
  const query = plain(parts.pop().trim());
  const skip = new Set([
    ...state.shopping.filter((i) => !i.done).map((i) => termKey(i.name)),
    ...parts.map(termKey),
  ]);
  const pool = new Map(state.terms.map((t) => [t.id, t]));
  for (const idea of state.ideas) {
    for (const ing of idea.ingredients || []) {
      const { name } = splitIngredient(ing); // „400 g Kartoffeln“ → „Kartoffeln“
      const id = termKey(name);
      if (id && !pool.has(id)) pool.set(id, { id, name, count: 0, lastUsed: 0 });
    }
  }
  const byUse = (a, b) => (b.count || 0) - (a.count || 0) || (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, 'de');
  const candidates = [...pool.values()].filter((t) => !skip.has(t.id));
  if (!query) return candidates.filter((t) => t.count > 0).sort(byUse).slice(0, MAX_SUGGESTIONS);
  // Rang: Anfang des Begriffs vor Anfang eines Worts im Begriff vor irgendwo enthalten
  const rank = (t) => {
    const name = plain(t.name);
    if (name === query) return -1; // genau das Getippte – kein Vorschlag nötig
    if (name.startsWith(query)) return 0;
    if (name.split(/[\s-]+/).some((w) => w.startsWith(query))) return 1;
    return name.includes(query) ? 2 : -1;
  };
  return candidates
    .map((t) => ({ t, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || byUse(a.t, b.t))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.t);
}

const suggestionsHtml = (text) => suggestions(text)
  .map((t) => `<button type="button" class="chip suggest-chip" data-action="pick" data-name="${esc(t.name)}" data-keep-focus>${icon('plus', 'icon-sm')}${esc(t.name)}</button>`)
  .join('');

// Antippen des Namens: Abteilung wählen (nur bei offenen Artikeln)
const item = (i) => `
  <li class="${i.done ? 'is-done' : ''}">
    <button type="button" class="check" data-action="toggle" data-id="${i.id}" aria-label="${i.done ? 'Wieder offen' : 'Erledigt'}: ${esc(i.name)}">${icon('check', 'icon-sm')}</button>
    ${i.done
      ? `<span class="list-main">${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span>`
      : `<button type="button" class="list-main" data-action="aisle" data-id="${i.id}" aria-label="${esc(i.name)} – Abteilung ändern">${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</button>`}
    <button type="button" class="icon-btn" data-action="remove" data-id="${i.id}" aria-label="${esc(i.name)} löschen">${icon('x', 'icon-sm')}</button>
  </li>`;

export default {
  id: 'einkauf',
  title: 'Einkauf',
  icon: 'cart',

  render() {
    const open = state.shopping.filter((i) => !i.done);
    const done = state.shopping.filter((i) => i.done);
    const mode = sortMode();
    // Nach Abteilungen in der Reihenfolge des Ladens, innerhalb einer Abteilung alphabetisch
    let openHtml = `<ul class="list">${open.map(item).join('')}</ul>`;
    if (mode === 'laden') {
      const groups = new Map(aisleOrder(state.settings).map((id) => [id, []]));
      for (const i of open) groups.get(aisleOf(i.name, state.terms)).push(i);
      openHtml = [...groups]
        .filter(([, items]) => items.length)
        .map(([id, items]) => `
          <h3 class="aisle-title">${esc(aisleLabel(id))}</h3>
          <ul class="list">${items.sort((a, b) => a.name.localeCompare(b.name, 'de')).map(item).join('')}</ul>`)
        .join('');
    }
    return `
      <form class="add-row" data-form="add">
        <input class="input" id="shop-input" name="name" placeholder="Was brauchen wir?" autocomplete="off" enterkeyhint="done" required data-input="suggest">
        <button type="submit" class="btn btn-primary" aria-label="Hinzufügen">${icon('plus')}</button>
      </form>
      <div class="suggest" id="shop-suggest" aria-label="Vorschläge – antippen setzt den Artikel auf die Liste">${suggestionsHtml('')}</div>
      ${open.length ? `
        <div class="seg" role="group" aria-label="Sortierung">
          <button type="button" class="seg-btn" data-action="sort" data-sort="laden" aria-pressed="${mode === 'laden'}">Nach Laden</button>
          <button type="button" class="seg-btn" data-action="sort" data-sort="neu" aria-pressed="${mode === 'neu'}">Neueste</button>
        </div>
        ${openHtml}`
        : `<div class="empty"><strong>Alles eingekauft</strong>Neue Artikel oben eintragen.</div>`}
      ${done.length ? `
        <h2 class="section-title">Erledigt (${done.length})
          <button type="button" class="btn btn-ghost btn-sm" data-action="clearDone">Aufräumen</button>
        </h2>
        <ul class="list">${done.map(item).join('')}</ul>` : ''}`;
  },

  input: {
    // Beim Tippen nur die Vorschläge neu zeichnen, nicht die ganze Ansicht
    suggest(el, root) {
      root.querySelector('#shop-suggest').innerHTML = suggestionsHtml(el.value);
    },
  },

  actions: {
    // Vorschlag antippen: Artikel sofort auf die Liste. Was davor schon im Feld stand („Milch, Br“ → „Milch, “)
    // bleibt stehen, damit man weiterschreiben kann.
    pick(el) {
      const input = document.getElementById('shop-input');
      const parts = (input?.value || '').split(',');
      parts.pop();
      const rest = parts.map((p) => p.trim()).filter(Boolean);
      const keep = rest.length ? `${rest.join(', ')}, ` : '';
      addToShopping([el.dataset.name]);
      const fresh = document.getElementById('shop-input'); // nach dem Neuzeichnen ein neues Feld
      if (!fresh) return;
      fresh.value = keep;
      fresh.focus();
      document.getElementById('shop-suggest').innerHTML = suggestionsHtml(keep);
    },
    sort(el) {
      try { localStorage.setItem(SORT_KEY, el.dataset.sort); } catch { /* privates Fenster */ }
      refresh();
    },
    // Abteilung eines Artikels wählen – gilt danach für diesen Begriff im ganzen Haushalt
    aisle(el) {
      const entry = state.shopping.find((x) => x.id === el.dataset.id);
      if (!entry) return;
      const current = aisleOf(entry.name, state.terms);
      openSheet({
        title: entry.name,
        body: `
          <p class="muted small" style="margin:0 0 12px">In welcher Abteilung liegt das im Laden? Gilt künftig für alle im Haushalt.</p>
          <div class="chips">${AISLES.map((a) => `
            <button type="button" class="chip aisle-chip" data-sheet-action="set" data-aisle="${a.id}" aria-pressed="${a.id === current}">${esc(a.label)}</button>`).join('')}</div>`,
        actions: {
          set(btn) {
            const id = termKey(entry.name);
            update((s) => {
              let term = s.terms.find((t) => t.id === id);
              if (!term) {
                term = { id, name: entry.name.slice(0, 64), count: 0, lastUsed: 0 };
                s.terms.push(term);
              }
              term.aisle = btn.dataset.aisle;
            });
            closeSheet();
          },
        },
      });
    },
    toggle(el) {
      update((s) => {
        const i = s.shopping.find((x) => x.id === el.dataset.id);
        if (i) i.done = !i.done;
      });
    },
    remove(el) {
      update((s) => { s.shopping = s.shopping.filter((x) => x.id !== el.dataset.id); });
    },
    clearDone() {
      update((s) => { s.shopping = s.shopping.filter((x) => !x.done); });
    },
  },

  submit: {
    add(form) {
      const name = form.elements.name.value;
      // Mehrere auf einmal: „Milch, Brot, Eier“
      if (!addToShopping(name.split(','))) toast('Steht schon auf der Liste');
      // Neu gezeichnet → Feld wieder fokussieren, damit man gleich weiterschreiben kann
      document.getElementById('shop-input')?.focus();
    },
  },
};
