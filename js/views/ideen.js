// Menüideen: Sammlung von Gerichten mit Zutaten und Stichworten – Quelle für Wochenplan und Einkaufsliste.
// Eine Idee kann einen Rezept-Link haben (url). „Einlesen“ holt Titel, Zutaten und Stichworte von der Rezeptseite
// (js/recipes.js); die Zutaten stehen mit Mengen da („400 g Kartoffeln“), beim Einkaufen wird die Menge zur Notiz.

import { state, update, uid } from '../store.js';
import { closeSheet, esc, icon, openSheet, safeLink, toast } from '../ui.js';
import { todayKey } from '../dates.js';
import { shopIngredients } from './einkauf.js';
import { importRecipe, normalizeUrl, recipeImportAvailable } from '../recipes.js';
import { SLOTS, setMeal } from './wochenplan.js';
import { askRecipeIdeas, ideasAvailable } from '../ai.js';

const splitList = (text, sep) => String(text || '').split(sep).map((x) => x.trim()).filter(Boolean);
const searchText = (i) => [i.title, ...i.tags, ...i.ingredients].join(' ').toLowerCase();

function editIdea(id) {
  const idea = state.ideas.find((i) => i.id === id);
  openSheet({
    title: idea ? idea.title : 'Neue Menüidee',
    body: `
      <div class="field"><span>Rezept-Link</span>
        <div class="add-row" style="margin-bottom:6px">
          <input class="input" type="url" name="url" value="${esc(idea?.url)}" placeholder="https://… z. B. Betty Bossi, Swissmilk, Fooby" inputmode="url" autocomplete="off" autocapitalize="off">
          <button type="button" class="btn" data-sheet-action="import" style="width:auto;padding:0 14px">Einlesen</button>
        </div>
        <p class="muted small import-status" style="margin:0">${recipeImportAvailable()
          ? (safeLink(idea?.url) ? `<a href="${esc(safeLink(idea.url))}" target="_blank" rel="noopener noreferrer">Rezept öffnen ↗</a>` : 'Link einfügen und „Einlesen“ – Name und Zutaten werden übernommen.')
          : 'Einlesen braucht das Supabase-Projekt (ANLEITUNG.md). Den Link kannst du trotzdem speichern.'}</p>
      </div>
      <label class="field"><span>Name</span>
        <input class="input" name="title" value="${esc(idea?.title)}" required autocomplete="off" placeholder="z. B. Risotto">
      </label>
      <label class="field"><span>Zutaten (eine pro Zeile)</span>
        <textarea class="textarea" name="ingredients" placeholder="Reis&#10;Zwiebel&#10;Bouillon">${esc(idea?.ingredients.join('\n'))}</textarea>
      </label>
      <label class="field"><span>Zubereitung (ein Schritt pro Zeile)</span>
        <textarea class="textarea" name="steps" placeholder="Zwiebel andünsten&#10;Reis dazugeben …">${esc((idea?.steps || []).join('\n'))}</textarea>
      </label>
      <label class="field"><span>Stichworte (mit Komma getrennt)</span>
        <input class="input" name="tags" value="${esc(idea?.tags.join(', '))}" placeholder="Vegi, Schnell" autocomplete="off">
      </label>
      <label class="field"><span>Notiz</span>
        <input class="input" name="note" value="${esc(idea?.note)}" placeholder="Tipp, Beilage, Portionen …" autocomplete="off">
      </label>`,
    submitLabel: 'Speichern',
    footer: idea ? `
      <div class="row">
        <button type="button" class="btn" data-sheet-action="plan">${icon('calendar', 'icon-sm')} Planen</button>
        <button type="button" class="btn" data-sheet-action="shop">${icon('cart', 'icon-sm')} Einkaufen</button>
      </div>
      <button type="button" class="btn btn-danger btn-block" data-sheet-action="remove">Idee löschen</button>` : '',
    actions: {
      plan() { planIdea(idea); },
      shop() { shopIngredients(idea.ingredients, `für ${idea.title}`); },
      // Rezeptseite einlesen und das Formular füllen – gespeichert wird erst mit „Speichern“
      async import(btn, form) {
        const url = normalizeUrl(form.elements.url.value);
        const status = form.querySelector('.import-status');
        if (!url) return form.elements.url.focus();
        btn.disabled = true;
        status.textContent = 'Wird eingelesen …';
        try {
          const r = await importRecipe(url);
          form.elements.url.value = r.url || url;
          if (r.title) form.elements.title.value = r.title;
          if (r.ingredients?.length) form.elements.ingredients.value = r.ingredients.join('\n');
          const tags = splitList(form.elements.tags.value, ',');
          for (const t of r.tags || []) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
          form.elements.tags.value = tags.join(', ');
          const extra = [r.servings && (/\D/.test(r.servings) ? r.servings : `${r.servings} Portionen`), r.minutes && `${r.minutes} Min.`].filter(Boolean).join(' · ');
          if (extra && !form.elements.note.value.trim()) form.elements.note.value = extra;
          status.textContent = `✓ ${r.ingredients?.length || 0} Zutaten eingelesen – kurz prüfen und speichern.`;
        } catch (err) {
          status.textContent = err.message;
        } finally {
          btn.disabled = false;
        }
      },
      remove() {
        if (!confirm(`„${idea.title}“ löschen?`)) return;
        update((s) => { s.ideas = s.ideas.filter((i) => i.id !== idea.id); });
        closeSheet();
      },
    },
    onSubmit(data) {
      const values = {
        url: normalizeUrl(data.get('url')),
        title: String(data.get('title')).trim(),
        ingredients: splitList(data.get('ingredients'), /\n/),
        steps: splitList(data.get('steps'), /\n/),
        tags: splitList(data.get('tags'), ','),
        note: String(data.get('note') || '').trim(),
      };
      update((s) => {
        if (idea) Object.assign(s.ideas.find((i) => i.id === idea.id), values);
        else s.ideas.unshift({ id: uid(), ...values });
      });
    },
  });
}

// ---------- Claude fragen ----------

let lastAsk = { ingredients: '', wishes: '' }; // bleibt stehen, falls man nochmals fragen will

const ideaCard = (r, n) => `
  <article class="card ai-idea">
    <h3>${esc(r.title)}</h3>
    ${r.description ? `<p class="small" style="margin:2px 0 6px">${esc(r.description)}</p>` : ''}
    <div class="muted small">${esc([r.minutes && `${r.minutes} Min.`, r.servings && `${r.servings} Pers.`, `${r.ingredients.length} Zutaten`].filter(Boolean).join(' · '))}</div>
    ${r.tags.length ? `<div class="chips">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${r.missing.length ? `<p class="small ai-missing">Fehlt noch: ${esc(r.missing.join(', '))}</p>` : '<p class="small ai-missing">Alles da (ausser Grundzutaten)</p>'}
    <details class="ai-more"><summary>Zutaten und Zubereitung</summary>
      <ul>${r.ingredients.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <ol>${r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    </details>
    <div class="row">
      <button type="button" class="btn btn-sm btn-primary" data-sheet-action="save" data-i="${n}">${icon('plus', 'icon-sm')} Als Menüidee</button>
      ${r.missing.length ? `<button type="button" class="btn btn-sm" data-sheet-action="shop" data-i="${n}">${icon('cart', 'icon-sm')} Fehlendes</button>` : ''}
    </div>
  </article>`;

function askClaude() {
  let results = [];
  const form = openSheet({
    title: 'Claude fragen',
    body: `
      <label class="field"><span>Was hast du da?</span>
        <textarea class="textarea" name="ingredients" required maxlength="600" placeholder="z. B. Kartoffeln, Lauch, Rahm, Eier, Speck">${esc(lastAsk.ingredients)}</textarea>
      </label>
      <label class="field"><span>Wünsche (optional)</span>
        <input class="input" name="wishes" maxlength="200" value="${esc(lastAsk.wishes)}" placeholder="z. B. vegetarisch, schnell, für 2" autocomplete="off">
      </label>
      <p class="muted small" style="margin:-4px 0 0">${ideasAvailable()
        ? 'An Claude (Anthropic) gehen nur diese Angaben und die Namen eurer Menüideen, damit nichts doppelt kommt.'
        : 'Geht nur im gemeinsamen Haushalt mit Supabase – siehe ANLEITUNG.md, „Claude fragen“.'}</p>
      <div class="ai-results" aria-live="polite"></div>`,
    submitLabel: 'Ideen holen',
    onSubmit(data, f) {
      lastAsk = { ingredients: String(data.get('ingredients')).trim(), wishes: String(data.get('wishes') || '').trim() };
      const out = f.querySelector('.ai-results');
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Claude überlegt …';
      out.innerHTML = '<p class="muted small ai-wait">Das dauert meist 10–30 Sekunden.</p>';
      askRecipeIdeas({ ...lastAsk, existing: state.ideas.map((i) => i.title) })
        .then((ideas) => {
          results = ideas;
          out.innerHTML = `<h2 class="section-title">${ideas.length} Vorschläge</h2>${ideas.map(ideaCard).join('')}`;
          out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
        .catch((err) => { out.innerHTML = `<p class="small amount-minus">${esc(err.message)}</p>`; })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = 'Nochmals fragen';
        });
      return false; // Fenster bleibt offen und zeigt die Vorschläge
    },
    actions: {
      save(btn) {
        const r = results[Number(btn.dataset.i)];
        if (!r) return;
        const note = [r.servings && `${r.servings} Personen`, r.minutes && `${r.minutes} Min.`].filter(Boolean).join(' · ');
        update((s) => { s.ideas.unshift({ id: uid(), title: r.title, ingredients: r.ingredients, steps: r.steps, tags: r.tags, note }); });
        btn.disabled = true;
        btn.innerHTML = `${icon('check', 'icon-sm')} Gespeichert`;
        toast(`„${r.title}“ bei den Menüideen`);
      },
      shop(btn) {
        const r = results[Number(btn.dataset.i)];
        if (r) shopIngredients(r.missing, `für ${r.title}`);
      },
    },
  });
  form.elements.ingredients.focus();
}

function planIdea(idea) {
  openSheet({
    title: `„${idea.title}“ planen`,
    body: `
      <div class="row">
        <label class="field"><span>Tag</span><input class="input" type="date" name="day" value="${todayKey()}" required></label>
        <label class="field"><span>Mahlzeit</span>
          <select class="select" name="slot">${SLOTS.map((s) => `<option value="${s.id}" ${s.id === 'abend' ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </label>
      </div>`,
    submitLabel: 'In den Wochenplan',
    onSubmit(data) {
      setMeal(String(data.get('day')), String(data.get('slot')), idea.title);
      toast('Im Wochenplan eingetragen');
    },
  });
}

export default {
  id: 'ideen',
  title: 'Menüideen',
  icon: 'book',

  render() {
    return `
      <button type="button" class="ask-claude" data-action="ask">
        ${icon('sparkles')}
        <span><strong>Claude fragen</strong><small>Zutaten angeben, Rezeptideen bekommen</small></span>
        ${icon('right', 'icon-sm')}
      </button>
      <div class="search">
        ${icon('search')}
        <input class="input" type="search" data-input="filter" placeholder="Gericht, Zutat oder Stichwort" autocomplete="off" aria-label="Menüideen durchsuchen">
      </div>
      ${state.ideas.length ? [...state.ideas].sort((a, b) => a.title.localeCompare(b.title, 'de')).map((i) => `
        <button type="button" class="card idea" data-action="edit" data-id="${i.id}" data-search="${esc(searchText(i))}">
          <h3>${esc(i.title)}</h3>
          <div class="muted small">${i.ingredients.length} Zutaten${i.steps?.length ? ' · mit Zubereitung' : i.url ? ' · mit Rezept' : ''}</div>
          ${i.note ? `<p class="small">${esc(i.note)}</p>` : ''}
          ${i.tags.length ? `<div class="chips">${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </button>`).join('')
        : `<div class="empty"><strong>Noch keine Ideen</strong>Mit + das erste Lieblingsgericht anlegen.</div>`}
      <p class="empty" data-no-results hidden>Nichts gefunden.</p>
      <button type="button" class="fab" data-action="edit" aria-label="Neue Menüidee">${icon('plus')}</button>`;
  },

  actions: {
    edit(el) { editIdea(el.dataset.id); },
    ask() { askClaude(); },
  },

  // Suche filtert direkt in der Seite – kein Neuzeichnen, damit die Tastatur offen bleibt
  input: {
    filter(el, root) {
      const q = el.value.trim().toLowerCase();
      let visible = 0;
      for (const card of root.querySelectorAll('[data-search]')) {
        card.hidden = q && !card.dataset.search.includes(q);
        if (!card.hidden) visible += 1;
      }
      root.querySelector('[data-no-results]').hidden = visible > 0 || !state.ideas.length;
    },
  },
};
