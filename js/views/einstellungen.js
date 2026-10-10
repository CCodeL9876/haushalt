// Fenster „Haushalt“ (Knopf oben rechts): Personen, Zugang (Link, Code), Währung, Kategorien, Sicherung.

import { changeCode, replaceAll, resetAll, session, state, update } from '../store.js';
import { avatar, closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { todayKey } from '../dates.js';
import { addMember } from '../login.js';
import { saveSession, shareLink } from '../session.js';
import { validCodeChars } from '../remote.js';
import { aisleLabel, aisleOrder } from '../aisles.js';

// Reihenfolge der Abteilungen im Laden: Liste mit Pfeilen nach oben/unten
const aisleListHtml = () => {
  const order = aisleOrder(state.settings);
  return order.map((id, i) => `
    <li><span class="list-main">${esc(aisleLabel(id))}</span>
      <button type="button" class="icon-btn" data-sheet-action="moveAisle" data-id="${id}" data-dir="-1" aria-label="${esc(aisleLabel(id))} nach oben"${i === 0 ? ' disabled' : ''}>${icon('up', 'icon-sm')}</button>
      <button type="button" class="icon-btn" data-sheet-action="moveAisle" data-id="${id}" data-dir="1" aria-label="${esc(aisleLabel(id))} nach unten"${i === order.length - 1 ? ' disabled' : ''}>${icon('down', 'icon-sm')}</button>
    </li>`).join('');
};

const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];

export function openSettings() {
  openSheet({
    title: 'Haushalt',
    body: `
      <div class="field"><span>Personen</span>
        ${state.members.length ? `<ul class="list" style="margin-bottom:10px">${state.members.map((m) => `
          <li>${avatar(m)}<span class="list-main">${esc(m.name)}</span>
            <button type="button" class="icon-btn" data-sheet-action="removeMember" data-id="${m.id}" aria-label="${esc(m.name)} entfernen">${icon('trash', 'icon-sm')}</button>
          </li>`).join('')}</ul>` : ''}
        <div class="add-row">
          <input class="input" name="member" placeholder="Name" autocomplete="off" enterkeyhint="done">
          <button type="button" class="btn btn-primary" data-sheet-action="addMember" aria-label="Person hinzufügen">${icon('plus')}</button>
        </div>
      </div>
      ${session.mode === 'shared' ? `
        <div class="field"><span>Zugang</span>
          <p class="muted small" style="margin:0 0 8px">Wer dazukommen soll, braucht den Link und den Zugangscode.</p>
          <button type="button" class="btn btn-block" data-sheet-action="share">${icon('link', 'icon-sm')} Link teilen</button>
          <div class="add-row" style="margin:10px 0 0">
            <input class="input" type="password" name="newCode" placeholder="Neuer Zugangscode" autocomplete="new-password" autocapitalize="off">
            <button type="button" class="btn" style="width:auto;padding:0 14px" data-sheet-action="code">Ändern</button>
          </div>
        </div>` : ''}
      <label class="field"><span>Währung</span>
        <select class="select" name="currency">${CURRENCIES.map((c) => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Kategorien für Ausgaben (mit Komma getrennt)</span>
        <input class="input" name="categories" value="${esc(state.settings.categories.join(', '))}" autocomplete="off">
      </label>
      <details class="field aisles-field">
        <summary>Reihenfolge im Laden</summary>
        <p class="muted small" style="margin:6px 0 8px">So ist die Einkaufsliste bei „Nach Laden“ sortiert. An euren Laden anpassen: Abteilungen nach oben oder unten schieben.</p>
        <ul class="list aisle-order">${aisleListHtml()}</ul>
        <button type="button" class="btn btn-ghost btn-sm" data-sheet-action="resetAisles" style="margin-top:6px">Standard-Reihenfolge</button>
      </details>
      <details class="field terms-field"${state.terms.length ? '' : ' hidden'}>
        <summary>Einkaufsbegriffe <span class="muted">(${state.terms.length})</span></summary>
        <p class="muted small" style="margin:6px 0 8px">Werden beim Einkauf vorgeschlagen, häufige zuerst. Falsch geschriebene hier löschen.</p>
        <div class="chips">${[...state.terms].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((t) => `
          <span class="chip term-chip">${esc(t.name)}<button type="button" class="term-x" data-sheet-action="removeTerm" data-id="${esc(t.id)}" aria-label="${esc(t.name)} vergessen">${icon('x', 'icon-sm')}</button></span>`).join('')}</div>
      </details>
      <div class="field"><span>Daten</span>
        <p class="muted small" style="margin:0 0 8px">${session.mode === 'shared'
          ? 'Gemeinsam gespeichert für alle im Haushalt. Einspielen ersetzt die Daten für alle.'
          : 'Ohne Anmeldung nur auf diesem Gerät gespeichert (Supabase noch nicht eingerichtet, siehe ANLEITUNG.md).'}</p>
        <div class="row">
          <button type="button" class="btn" data-sheet-action="export">Sicherung laden</button>
          <label class="btn">Einspielen<input type="file" name="import" accept="application/json,.json" hidden></label>
        </div>
      </div>`,
    footer: session.mode === 'local' ? `<button type="button" class="btn btn-danger btn-block" data-sheet-action="reset">Alles zurücksetzen</button>` : '',
    actions: {
      addMember(_, form) {
        const name = form.elements.member.value.trim();
        if (!name) return form.elements.member.focus();
        addMember(name);
        openSettings();
      },
      removeMember(btn) {
        const id = btn.dataset.id;
        if (state.expenses.some((e) => e.payerId === id || e.splitIds.includes(id))) {
          return toast('Person hat Ausgaben – zuerst diese löschen oder ändern');
        }
        update((s) => { s.members = s.members.filter((m) => m.id !== id); });
        openSettings();
      },
      moveAisle(btn) {
        const order = aisleOrder(state.settings);
        const i = order.indexOf(btn.dataset.id);
        const j = i + Number(btn.dataset.dir);
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        update((s) => { s.settings.aisleOrder = order; });
        const list = document.querySelector('#sheet .aisle-order');
        list.innerHTML = aisleListHtml();
        // Fokus beim verschobenen Eintrag lassen, damit man mehrmals hintereinander tippen kann
        list.querySelector(`[data-id="${btn.dataset.id}"][data-dir="${btn.dataset.dir}"]:not([disabled])`)?.focus();
      },
      resetAisles() {
        update((s) => { delete s.settings.aisleOrder; });
        document.querySelector('#sheet .aisle-order').innerHTML = aisleListHtml();
      },
      // Begriff vergessen: nur der Chip verschwindet, das Fenster bleibt an derselben Stelle
      removeTerm(btn) {
        const id = btn.dataset.id;
        update((s) => { s.terms = s.terms.filter((t) => t.id !== id); });
        btn.closest('.term-chip')?.remove();
        const count = document.querySelector('#sheet .terms-field summary .muted');
        if (count) count.textContent = `(${state.terms.length})`;
      },
      export() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `haushalt-${todayKey()}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      async share() {
        const url = shareLink(session.key);
        try {
          if (navigator.share) await navigator.share({ title: session.name, text: 'Unser Haushalt (Zugangscode separat)', url });
          else {
            await navigator.clipboard.writeText(url);
            toast('Link kopiert – Zugangscode separat weitergeben');
          }
        } catch {
          // Teilen abgebrochen
        }
      },
      async code(btn, form) {
        const code = form.elements.newCode.value.trim();
        if (code.length < 6) return toast('Mindestens 6 Zeichen');
        if (!validCodeChars(code)) return toast('Bitte ohne Umlaute und Sonderzeichen');
        if (!confirm('Zugangscode für alle ändern? Andere Geräte müssen danach den neuen Code eingeben.')) return;
        btn.disabled = true;
        try {
          await changeCode(code);
          saveSession(session.key, code);
          form.elements.newCode.value = '';
          toast('Zugangscode geändert');
        } catch (err) {
          toast(`Nicht geändert: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      },
      reset() {
        if (!confirm('Wirklich alle Daten auf diesem Gerät löschen?')) return;
        resetAll();
        closeSheet();
        toast('Alles zurückgesetzt');
      },
      async change(el) {
        if (el.name === 'currency') update((s) => { s.settings.currency = el.value; });
        if (el.name === 'categories') {
          const list = el.value.split(',').map((x) => x.trim()).filter(Boolean);
          if (list.length) update((s) => { s.settings.categories = list; });
        }
        if (el.name === 'import' && el.files[0]) {
          try {
            const data = JSON.parse(await el.files[0].text());
            if (!confirm(session.mode === 'shared' ? 'Die Daten des ganzen Haushalts (für alle!) durch die Sicherung ersetzen?' : 'Die aktuellen Daten werden durch die Sicherung ersetzt. Weiter?')) return;
            replaceAll(data);
            closeSheet();
            toast('Sicherung eingespielt');
          } catch {
            toast('Datei konnte nicht gelesen werden');
          }
        }
      },
    },
  });
  // Enter im Namensfeld fügt die Person hinzu, statt das Formular abzuschicken
  document.querySelector('#sheet [name="member"]').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.querySelector('#sheet [data-sheet-action="addMember"]').click();
  });
}
