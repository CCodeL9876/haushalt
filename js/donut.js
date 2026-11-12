// Ring mit abgerundeten Enden (Geld → Monat): parts = [{ value, cls }]; total = Wert für den vollen Ring.
// Ein Teil ist so lang wie sein Anteil; die runden Enden ragen je 4 Einheiten (Strichbreite 44 von Umfang ≈ 553) darüber hinaus.
export function donutSvg(parts, total) {
  const CAP = 4;
  let at = 0;
  const arcs = parts.filter((p) => p.value > 0 && total > 0).map((p) => {
    const len = Math.min(100, (p.value / total) * 100);
    const draw = Math.max(len - 2 * CAP, 0.01); // shortcut: Teile unter ~8 % werden zu einem Punkt, bei sehr vielen kleinen überlappen sie
    const arc = `<circle class="dn-arc ${p.cls}" r="88" pathLength="100" stroke-dasharray="${draw.toFixed(2)} 200" stroke-dashoffset="${(-(at + CAP)).toFixed(2)}"/>`;
    at += len;
    return arc;
  });
  return `<svg viewBox="0 0 260 260" aria-hidden="true"><g transform="translate(130 130) rotate(-90)"><circle class="dn-track" r="88"/>${arcs.reverse().join('')}</g></svg>`;
}
