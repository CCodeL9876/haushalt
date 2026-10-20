// Wischgesten in Listen (Einkauf, ToDo): nach rechts = abhaken (bzw. wieder öffnen), nach links = löschen.
// Gilt für jede Zeile einer .list, die einen Knopf data-action="toggle" bzw. "remove" hat – ausgelöst wird genau
// dieser Knopf, die Ansicht macht also dasselbe wie beim Antippen. Kurze Bewegungen springen zurück.

const START = 12; // ab so vielen Pixeln waagrecht gilt es als Wischen
let suppressUntil = 0;

export function setupSwipe(root) {
  let s = null;

  const reset = (li) => {
    li.classList.remove('is-swiping', 'is-armed');
    li.style.removeProperty('--dx');
    delete li.dataset.swipe;
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // am Computer gibt es die Knöpfe
    const li = e.target.closest('.list > li');
    if (!li || !li.querySelector('[data-action="toggle"], [data-action="remove"]')) return;
    s = { li, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
  });

  root.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; } // senkrecht: Seite scrollt
      if (Math.abs(dx) < START) return;
      s.active = true;
      s.li.classList.add('is-swiping');
    }
    const dir = dx < 0 ? 'left' : 'right';
    const btn = s.li.querySelector(`[data-action="${dir === 'left' ? 'remove' : 'toggle'}"]`);
    s.dx = btn ? dx : dx / 4; // ohne passenden Knopf nur ein kleiner Ruck
    s.li.dataset.swipe = dir;
    s.li.style.setProperty('--dx', `${s.dx}px`);
    s.li.classList.toggle('is-armed', Boolean(btn) && Math.abs(s.dx) > threshold(s.li));
  });

  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const { li, dx, active } = s;
    s = null;
    if (!active) return;
    suppressUntil = Date.now() + 400; // den Klick, der dem Loslassen folgt, nicht als Antippen werten
    const btn = li.querySelector(`[data-action="${dx < 0 ? 'remove' : 'toggle'}"]`);
    if (e.type === 'pointercancel' || !btn || Math.abs(dx) <= threshold(li)) return reset(li);
    navigator.vibrate?.(10);
    li.classList.add('is-leaving');
    li.style.setProperty('--dx', `${dx < 0 ? -li.offsetWidth : li.offsetWidth}px`);
    setTimeout(() => {
      suppressUntil = 0;
      btn.click();
      if (li.isConnected) { li.classList.remove('is-leaving'); reset(li); }
    }, 160);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('click', (e) => {
    if (Date.now() < suppressUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

const threshold = (li) => Math.min(110, li.offsetWidth * 0.3);
