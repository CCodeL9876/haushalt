// Fenster „Haushalt“ (Knopf oben rechts): Personen, Zugang (Link, Code), Mitteilungen, Farbdesign, Währung, Kategorien, Sicherung.

import { changeCode, replaceAll, resetAll, session, state, update } from '../store.js';
import { updatePersonal } from '../personal.js';
import { reloadApp } from '../refresh.js';
import { openTerms } from '../terms.js';
import { avatar, closeSheet, esc, icon, openSheet, toast } from '../ui.js';
import { todayKey } from '../dates.js';
import { addMember, currentMember } from '../login.js';
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, permission, pushConfigured, pushSupported, testPush } from '../push.js';
import { saveSession, shareLink } from '../session.js';
import { validCodeChars } from '../remote.js';
import { aisleLabel, aisleOrder } from '../aisles.js';
import { PALETTES } from '../palettes.js';

// Farbdesign: jedes Gerät wählt sein eigenes (localStorage). js/palette-boot.js setzt es beim Start, bevor die
// Seite gezeichnet wird; die Farben selbst stehen in css/palettes.css (erzeugt von tools/make-palettes.py).
const PALETTE_KEY = 'haushalt.palette';
const currentPalette = () => {
  try { return localStorage.getItem(PALETTE_KEY) || 'creme'; } catch { return 'creme'; }
};
function applyPalette(id) {
  try { localStorage.setItem(PALETTE_KEY, id); } catch { /* privates Fenster: gilt bis zum Neuladen */ }
  if (id === 'creme') document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', id);
  // Statusleiste des iPhones in der neuen Hintergrundfarbe
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}
// Hell/Dunkel pro Gerät: 'auto' folgt der Einstellung des iPhones, 'light'/'dark' gilt immer (data-theme auf <html>,
// die Farben dafür stehen schon in css/styles.css und css/palettes.css)
const THEME_KEY = 'haushalt.theme';
const currentTheme = () => {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
};
function applyTheme(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch { /* privates Fenster: gilt bis zum Neuladen */ }
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}
const themeHtml = () => {
  const cur = currentTheme();
  return [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([id, label]) => `
    <button type="button" class="seg-btn" data-sheet-action="theme" data-id="${id}" aria-pressed="${id === cur}">${label}</button>`).join('');
};

const paletteHtml = () => {
  const cur = currentPalette();
  return PALETTES.map((p) => `
    <button type="button" class="palette-btn" data-sheet-action="palette" data-id="${p.id}" aria-pressed="${p.id === cur}">
      <span class="palette-dots" aria-hidden="true">${p.swatches.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="palette-name">${esc(p.name)}</span>
    </button>`).join('');
};

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

// Mitteilungen auf diesem Gerät (js/push.js). Der Stand ist erst nach einer Abfrage bekannt – darum wird der
// Inhalt nach dem Öffnen nachgetragen.
async function fillPush(box) {
  if (!box) return;
  let html;
  if (!pushSupported()) {
    html = isIos() && !isStandalone()
      ? '<p class="muted small push-text">Am iPhone gehen Mitteilungen nur in der App vom Home-Bildschirm: in Safari unten auf Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen (ab iOS 16.4).</p>'
      : '<p class="muted small push-text">Dieser Browser kann keine Mitteilungen empfangen.</p>';
  } else if (permission() === 'denied') {
    html = '<p class="muted small push-text">Mitteilungen sind für diese App ausgeschaltet. Am iPhone: Einstellungen → Mitteilungen → Haushalt → erlauben, dann hier einschalten.</p>';
  } else if (permission() === 'granted' && (await currentSubscription().catch(() => null))) {
    html = `<p class="small push-text">${icon('check', 'icon-sm')} Auf diesem Gerät eingeschaltet.</p>
      <div class="row">
        <button type="button" class="btn" data-sheet-action="pushTest">Probe senden</button>
        <button type="button" class="btn" data-sheet-action="pushOff">Ausschalten</button>
      </div>`;
  } else {
    html = `<button type="button" class="btn btn-block" data-sheet-action="pushOn">Mitteilungen einschalten</button>`;
  }
  box.innerHTML = html;
}

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
      ${session.mode === 'shared' && pushConfigured() ? `
        <div class="field"><span>Mitteilungen <small class="muted" style="font-weight:500">· nur auf diesem Gerät</small></span>
          <p class="muted small" style="margin:0 0 8px">Erinnert an Reste im Kühlschrank: am Vortag und am letzten Tag, jeweils um 17 Uhr.</p>
          <div class="push-box"></div>
        </div>` : ''}
      <div class="field"><span>Farbdesign <small class="muted" style="font-weight:500">· nur auf diesem Gerät</small></span>
        <div class="seg seg-wide theme-seg" role="group" aria-label="Hell oder dunkel">${themeHtml()}</div>
        <p class="muted small theme-hint" style="margin:-6px 0 10px">${currentTheme() === 'auto' ? 'Folgt der Einstellung des iPhones (hell am Tag, dunkel am Abend, falls so eingestellt).' : 'Gilt immer, unabhängig von der Einstellung des iPhones.'}</p>
        <div class="palette-grid">${paletteHtml()}</div>
      </div>
      <h3 class="settings-group">Einkauf</h3>
      <button type="button" class="btn btn-block" data-sheet-action="terms" style="margin-bottom:10px">${icon('cart', 'icon-sm')} Einkaufsbegriffe verwalten (${state.terms.length})</button>
      <details class="field aisles-field">
        <summary>Reihenfolge im Laden</summary>
        <p class="muted small" style="margin:6px 0 8px">So ist die Einkaufsliste bei „Nach Laden“ sortiert. An euren Laden anpassen: Abteilungen nach oben oder unten schieben.</p>
        <ul class="list aisle-order">${aisleListHtml()}</ul>
        <button type="button" class="btn btn-ghost btn-sm" data-sheet-action="resetAisles" style="margin-top:6px">Standard-Reihenfolge</button>
      </details>
      <h3 class="settings-group">Abrechnung</h3>
      <label class="field"><span>Währung</span>
        <select class="select" name="currency">${CURRENCIES.map((c) => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Zahlungsarten (mit Komma getrennt)</span>
        <input class="input" name="methods" value="${esc((state.settings.methods || []).join(', '))}" autocomplete="off">
      </label>
      <h3 class="settings-group">Daten</h3>
      <div class="field">
        <p class="muted small" style="margin:0 0 8px">${session.mode === 'shared'
          ? 'Gemeinsam gespeichert für alle im Haushalt. Einspielen ersetzt die Daten für alle.'
          : 'Ohne Anmeldung nur auf diesem Gerät gespeichert (Supabase noch nicht eingerichtet, siehe ANLEITUNG.md).'}</p>
        <div class="row">
          <button type="button" class="btn" data-sheet-action="export">Sicherung laden</button>
          <label class="btn">Einspielen<input type="file" name="import" accept="application/json,.json" hidden></label>
        </div>
      </div>`,
    footer: `<button type="button" class="btn btn-block" data-sheet-action="reloadApp">${icon('refresh', 'icon-sm')} App aktualisieren</button>
      ${session.mode === 'local' ? '<button type="button" class="btn btn-danger btn-block" data-sheet-action="reset">Alles zurücksetzen</button>' : ''}`,
    actions: {
      async pushOn(btn) {
        btn.disabled = true;
        try {
          await enablePush(currentMember()?.id);
          toast('Mitteilungen eingeschaltet');
        } catch (err) {
          toast(err.message);
        }
        fillPush(btn.closest('.push-box'));
      },
      async pushOff(btn) {
        btn.disabled = true;
        await disablePush().catch(() => {});
        toast('Mitteilungen ausgeschaltet');
        fillPush(btn.closest('.push-box'));
      },
      async pushTest(btn) {
        btn.disabled = true;
        try {
          await testPush();
          toast('Probe verschickt – kommt in ein paar Sekunden');
        } catch (err) {
          toast(err.message);
        }
        btn.disabled = false;
      },
      theme(btn) {
        applyTheme(btn.dataset.id);
        for (const b of document.querySelectorAll('#sheet .theme-seg .seg-btn')) b.setAttribute('aria-pressed', String(b === btn));
        document.querySelector('#sheet .theme-hint').textContent = btn.dataset.id === 'auto'
          ? 'Folgt der Einstellung des iPhones (hell am Tag, dunkel am Abend, falls so eingestellt).'
          : 'Gilt immer, unabhängig von der Einstellung des iPhones.';
      },
      palette(btn) {
        applyPalette(btn.dataset.id);
        for (const b of document.querySelectorAll('#sheet .palette-btn')) b.setAttribute('aria-pressed', String(b === btn));
      },
      // Neueste Version und Daten laden – dasselbe wie oben nach unten ziehen (js/refresh.js)
      reloadApp(btn) {
        btn.disabled = true;
        btn.textContent = 'Wird aktualisiert …';
        reloadApp();
      },
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
      terms() { openTerms(); },
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
        updatePersonal((d) => { d.lists = []; d.todos = []; }); // persönliche ToDo-Listen gehören auch dazu
        closeSheet();
        toast('Alles zurückgesetzt');
      },
      async change(el) {
        if (el.name === 'currency') update((s) => { s.settings.currency = el.value; });
        if (el.name === 'methods') {
          const list = [...new Set(el.value.split(',').map((x) => x.trim().slice(0, 30)).filter(Boolean))];
          if (list.length) update((s) => { s.settings.methods = list; });
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
  fillPush(document.querySelector('#sheet .push-box'));
}
