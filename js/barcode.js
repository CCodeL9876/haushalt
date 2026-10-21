// Strichcodes zeichnen (SVG), ohne Zusatzbibliothek – für Kundenkarten (js/cards.js).
//   EAN-13 / EAN-8: Nummern mit 13 bzw. 8 Ziffern und gültiger Prüfziffer (z. B. Cumulus, Supercard)
//   Code 128: alles andere (Ziffern und Buchstaben)
// barcodeSvg(text, format) → { svg, format } oder null, wenn sich der Text nicht darstellen lässt.
// format 'code128' erzwingt Code 128 (für Karten, deren Nummer zufällig wie eine EAN aussieht).

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Prüfziffer nach EAN: von rechts abwechselnd mal 3 und mal 1
function eanCheck(digits) {
  const sum = [...digits].reverse().reduce((n, d, i) => n + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
const validEan = (t) => /^(\d{8}|\d{13})$/.test(t) && eanCheck(t.slice(0, -1)) === t.at(-1);

function ean13Bits(t) {
  const parity = PARITY[Number(t[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) bits += (parity[i - 1] === 'L' ? L : G)[Number(t[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) bits += R[Number(t[i])];
  return `${bits}101`;
}
function ean8Bits(t) {
  let bits = '101';
  for (let i = 0; i < 4; i += 1) bits += L[Number(t[i])];
  bits += '01010';
  for (let i = 4; i < 8; i += 1) bits += R[Number(t[i])];
  return `${bits}101`;
}

// Code 128: Breiten von Strich/Lücke je Zeichen (0–105), dazu Stopp
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 '
  + '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 '
  + '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
  + '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 '
  + '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 '
  + '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 '
  + '311141 411131 211412 211214 211232').split(' ');
const C128_STOP = '2331112';

function code128Bits(t) {
  if (!/^[\x20-\x7E]+$/.test(t)) return null;
  // Nur Ziffern in gerader Anzahl (ab 4): Zeichensatz C, je zwei Ziffern ein Zeichen – kürzer
  const codes = /^\d+$/.test(t) && t.length % 2 === 0 && t.length >= 4
    ? [105, ...t.match(/\d\d/g).map(Number)]
    : [104, ...[...t].map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce((n, c, i) => n + c * (i || 1), 0) % 103;
  let bits = '';
  for (const widths of [...codes, check].map((c) => C128[c]).concat(C128_STOP)) {
    [...widths].forEach((w, i) => { bits += (i % 2 === 0 ? '1' : '0').repeat(Number(w)); });
  }
  return bits;
}

// Bitfolge → SVG (Ruhezone links und rechts je 10 Module)
function toSvg(bits) {
  const quiet = 10;
  const width = bits.length + 2 * quiet;
  let rects = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== '1') { i += 1; continue; }
    let j = i;
    while (bits[j] === '1') j += 1;
    rects += `<rect x="${i + quiet}" y="0" width="${j - i}" height="60"/>`;
    i = j;
  }
  return `<svg class="barcode" viewBox="0 0 ${width} 60" preserveAspectRatio="none" role="img" aria-label="Strichcode">${rects}</svg>`;
}

export function barcodeSvg(text, format = 'auto') {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return null;
  if (format !== 'code128' && validEan(t)) return { svg: toSvg(t.length === 13 ? ean13Bits(t) : ean8Bits(t)), format: t.length === 13 ? 'EAN-13' : 'EAN-8' };
  const bits = code128Bits(t);
  return bits ? { svg: toSvg(bits), format: 'Code 128' } : null;
}
