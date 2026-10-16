#!/usr/bin/env python3
"""Farbdesigns der Haushalt-App erzeugen: aus vier Grundfarben pro Design alle Farbwerte (CSS-Variablen) für den
hellen und den dunklen Modus berechnen – mit Kontrastprüfung, damit Schrift überall lesbar bleibt.

Aufruf (im Ordner haushalt):   python3 tools/make-palettes.py
Schreibt:  css/palettes.css  (Farbwerte je Design, aktiv über <html data-palette="…">)
           js/palettes.js    (Namen und Farbtupfer für die Auswahl unter Haushalt → Farbdesign)

Neues Design: unten in PALETTES eintragen und das Skript ausführen.
  base    Grundton für den Hintergrund (wird für hell stark aufgehellt, für dunkel stark abgedunkelt)
  c1      Farbe für Abhaken, aktiven Umschalter, Abschnittspunkte, „Abend“
  c2      Farbe für Vorschläge, „Heute“, „Mittag“
  c3      dritte Farbe für Kacheln, Menüideen und Stichworte
  accent  Hauptfarbe für Knöpfe (+, Speichern) und Erledigt
  show    die vier Farben in der gelieferten Reihenfolge (Farbtupfer in der Auswahl)
Das Standard-Design „Creme“ steht von Hand in css/styles.css (:root) und wird hier nicht erzeugt.
"""

from pathlib import Path

PALETTES = [
    {'id': 'neon', 'name': 'Neon', 'show': ['#CCFF00', '#FF6B00', '#F900FF', '#5200FF'], 'base': '#5200FF', 'c1': '#CCFF00', 'c2': '#FF6B00', 'c3': '#F900FF', 'accent': '#5200FF'},
    {'id': 'fruehling', 'name': 'Frühling', 'show': ['#89F336', '#38A711', '#F23598', '#A835F2'], 'base': '#89F336', 'c1': '#89F336', 'c2': '#F23598', 'c3': '#38A711', 'accent': '#A835F2'},
    {'id': 'pastell', 'name': 'Pastell', 'show': ['#81D8D0', '#D99E82', '#D7D982', '#AE82D9'], 'base': '#81D8D0', 'c1': '#D7D982', 'c2': '#D99E82', 'c3': '#81D8D0', 'accent': '#AE82D9'},
    {'id': 'garten', 'name': 'Garten', 'show': ['#A8DCAB', '#519755', '#DBAAA7', '#BE91BE'], 'base': '#A8DCAB', 'c1': '#BE91BE', 'c2': '#DBAAA7', 'c3': '#A8DCAB', 'accent': '#519755'},
]
# Für die Auswahl: das Standard-Design (Farben aus css/styles.css)
STANDARD = {'id': 'creme', 'name': 'Creme', 'swatches': ['#FDFBD4', '#BDB96A', '#C1BFFF', '#CF6DFC']}

WHITE, BLACK = '#FFFFFF', '#000000'


# ---------- Farbrechnung ----------
def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexc(c):
    return '#' + ''.join(f'{max(0, min(255, round(v))):02X}' for v in c)


def mix(a, b, t):
    """a → b zu Anteil t (0 = a, 1 = b)"""
    ra, rb = rgb(a), rgb(b)
    return hexc(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def ensure(color, bg, target, toward=None):
    """color schrittweise Richtung Schwarz (helles bg) bzw. Weiss (dunkles bg) schieben, bis der Kontrast reicht"""
    toward = toward or (BLACK if lum(bg) > 0.18 else WHITE)
    c = color
    for i in range(41):
        c = mix(color, toward, i / 40)
        if contrast(c, bg) >= target:
            return c
    return c


def on(color, dark):
    """Schrift auf einer Farbfläche: die dunkle Wunschfarbe, wenn sie gut lesbar ist, sonst Weiss"""
    return dark if contrast(dark, color) >= 4.5 or contrast(dark, color) >= contrast(WHITE, color) else WHITE


def light_bg(base):
    """sehr heller Hintergrund im Ton der Grundfarbe"""
    for i in range(101):
        c = mix(base, WHITE, i / 100)
        if lum(c) >= 0.9:
            return c
    return WHITE


# ---------- Farbwerte eines Designs ----------
def light_tokens(p):
    c1, c2, c3, acc = p['c1'], p['c2'], p['c3'], p['accent']
    bg = light_bg(p['base'])
    card = mix(bg, WHITE, 0.6)
    ink = ensure(mix(c1, BLACK, 0.86), bg, 13)
    acc_text = ensure(acc, card, 4.6)
    t = {
        'bg': bg, 'card': card, 'chip': mix(bg, c1, 0.16), 'line': mix(bg, c1, 0.28),
        'text': ink, 'text-soft': ensure(mix(c1, BLACK, 0.72), bg, 8), 'muted': ensure(mix(ink, bg, 0.45), card, 4.6),  # neutral, damit aktive Tabs auffallen
        'accent': acc, 'accent-hover': mix(acc, BLACK, 0.1), 'accent-tint': mix(c2, WHITE, 0.75),
        'accent-text': acc_text, 'on-accent': on(acc, mix(acc, BLACK, 0.86)),
        'plus': '#2C6E3F', 'minus': '#A63D2F', 'bar': acc, 'bar-track': mix(bg, c1, 0.16),
        'tab-active': acc_text, 'check-border': c1 if contrast(c1, card) >= 1.5 else ensure(c1, card, 1.8),
        'suggest-bg': c2, 'suggest-text': on(c2, ink), 'suggest-icon': ensure(mix(c2, BLACK, 0.4), c2, 4.5),
        'seg-bg': mix(bg, c1, 0.16), 'seg-active-bg': c1, 'seg-active-text': on(c1, ink),
        'section-text': ensure(c1, bg, 4.6), 'section-dot': c1,
        'today-ring': acc, 'today-pill-bg': c2, 'today-pill-text': on(c2, ink),
        'mittag-bg': mix(c2, WHITE, 0.82), 'mittag-label-bg': c2, 'mittag-label-text': on(c2, ink),
        'abend-bg': mix(bg, c1, 0.2), 'abend-label-bg': c1, 'abend-label-text': on(c1, ink),
        'week-btn-bg': c2, 'week-btn-text': on(c2, ink),
        'idea-1': c1, 'idea-2': c2, 'idea-3': c3, 'idea-4': ensure(c1, bg, 4.6),
        'tag-1-bg': mix(c1, WHITE, 0.45), 'tag-2-bg': mix(c2, WHITE, 0.35), 'tag-3-bg': mix(c3, WHITE, 0.55),
        'tag-4-bg': mix(c2, WHITE, 0.75), 'tag-text': ink, 'tag-4-text': ink,
        'tile-1-bg': mix(c2, WHITE, 0.6), 'tile-1-badge': c2, 'tile-2-bg': mix(c1, WHITE, 0.6), 'tile-2-badge': c1,
        'tile-3-bg': mix(c3, WHITE, 0.7), 'tile-3-badge': mix(c3, WHITE, 0.25), 'tile-text': ink,
    }
    t['tile-badge-text'] = badge_text([t['tile-1-badge'], t['tile-2-badge'], t['tile-3-badge']], ink)
    r, g, b = rgb(ink)
    t['shadow'] = f'0 1px 2px rgba({r}, {g}, {b}, 0.08), 0 4px 14px rgba({r}, {g}, {b}, 0.06)'
    t['shadow-lg'] = f'0 -10px 40px rgba({r}, {g}, {b}, 0.18)'
    return t


def dark_tokens(p):
    c1, c2, c3, acc = p['c1'], p['c2'], p['c3'], p['accent']
    bg = mix(p['base'], BLACK, 0.9)
    card = mix(p['base'], BLACK, 0.86)
    text = ensure(mix(light_bg(p['base']), WHITE, 0.3), bg, 13, WHITE)
    # Hauptfarbe: zu dunkle (z. B. Violett) durch die hellste der anderen Farben ersetzen
    dacc = acc if contrast(acc, card) >= 3.5 else max((c1, c2, c3), key=lambda c: contrast(c, card))
    dacc_text = ensure(dacc, card, 4.6, WHITE)
    dark_ink = mix(bg, BLACK, 0.3)
    t = {
        'bg': bg, 'card': card, 'chip': mix(p['base'], BLACK, 0.8), 'line': mix(p['base'], BLACK, 0.74),
        'text': text, 'text-soft': mix(text, bg, 0.12), 'muted': ensure(mix(text, bg, 0.4), card, 4.6, WHITE),  # neutral, damit aktive Tabs auffallen
        'accent': dacc, 'accent-hover': mix(dacc, WHITE, 0.15), 'accent-tint': mix(c2, bg, 0.82),
        'accent-text': dacc_text, 'on-accent': on(dacc, dark_ink),
        'plus': '#A9C97C', 'minus': '#F08B7C', 'bar': dacc, 'bar-track': mix(p['base'], BLACK, 0.8),
        'tab-active': dacc_text, 'check-border': mix(c1, bg, 0.35),
        'suggest-bg': mix(c2, bg, 0.78), 'suggest-text': ensure(c2, mix(c2, bg, 0.78), 4.6, WHITE),
        'suggest-icon': ensure(dacc, mix(c2, bg, 0.78), 3, WHITE),
        'seg-bg': mix(p['base'], BLACK, 0.8), 'seg-active-bg': c1, 'seg-active-text': on(c1, dark_ink),
        'section-text': ensure(c1, bg, 4.6, WHITE), 'section-dot': c1,
        'today-ring': dacc, 'today-pill-bg': c2, 'today-pill-text': on(c2, dark_ink),
        'mittag-bg': mix(c2, bg, 0.85), 'mittag-label-bg': c2, 'mittag-label-text': on(c2, dark_ink),
        'abend-bg': mix(c1, bg, 0.88), 'abend-label-bg': c1, 'abend-label-text': on(c1, dark_ink),
        'week-btn-bg': c2, 'week-btn-text': on(c2, dark_ink),
        'idea-1': c1, 'idea-2': c2, 'idea-3': c3, 'idea-4': mix(c1, bg, 0.4),
        'tag-1-bg': c1, 'tag-2-bg': c2, 'tag-3-bg': c3, 'tag-4-bg': mix(c2, bg, 0.82),
        'tag-text': badge_text([c1, c2, c3], dark_ink), 'tag-4-text': ensure(c2, mix(c2, bg, 0.82), 4.6, WHITE),
        'tile-1-bg': mix(c2, bg, 0.8), 'tile-1-badge': c2, 'tile-2-bg': mix(c1, bg, 0.85), 'tile-2-badge': c1,
        'tile-3-bg': mix(c3, bg, 0.8), 'tile-3-badge': c3, 'tile-text': text,
        'shadow': '0 1px 3px rgba(0, 0, 0, 0.45)', 'shadow-lg': '0 -10px 40px rgba(0, 0, 0, 0.5)',
    }
    t['tile-badge-text'] = badge_text([c2, c1, c3], dark_ink)
    return t


def badge_text(colors, dark):
    """eine Schriftfarbe für mehrere Flächen: dunkel, wenn sie auf allen lesbar ist, sonst die bessere Wahl"""
    worst_dark = min(contrast(dark, c) for c in colors)
    worst_white = min(contrast(WHITE, c) for c in colors)
    return dark if worst_dark >= 4.5 or worst_dark >= worst_white else WHITE


# ---------- Prüfung: wichtige Paare Schrift/Fläche ----------
CHECKS = [('text', 'bg', 7), ('text', 'card', 7), ('muted', 'card', 4.5), ('accent-text', 'card', 4.5),
          ('on-accent', 'accent', 4.5), ('section-text', 'bg', 4.5), ('suggest-text', 'suggest-bg', 4.5),
          ('seg-active-text', 'seg-active-bg', 4.5), ('today-pill-text', 'today-pill-bg', 4.5),
          ('mittag-label-text', 'mittag-label-bg', 4.5), ('abend-label-text', 'abend-label-bg', 4.5),
          ('week-btn-text', 'week-btn-bg', 4.5), ('tile-text', 'tile-1-bg', 4.5), ('tile-text', 'tile-2-bg', 4.5),
          ('tile-text', 'tile-3-bg', 4.5), ('tile-badge-text', 'tile-1-badge', 4.5),
          ('tile-badge-text', 'tile-2-badge', 4.5), ('tile-badge-text', 'tile-3-badge', 4.5),
          ('tag-text', 'tag-1-bg', 4.5), ('tag-text', 'tag-2-bg', 4.5), ('tag-text', 'tag-3-bg', 4.5)]


def report(name, mode, t):
    bad = [(a, b, contrast(t[a], t[b]), need) for a, b, need in CHECKS if contrast(t[a], t[b]) < need]
    status = 'ok' if not bad else ', '.join(f'{a} auf {b} {c:.1f}:1 (soll {n})' for a, b, c, n in bad)
    print(f'  {name:9} {mode:6} {status}')
    return not bad


def block(selector, t, extra=''):
    lines = [f'  --{k}: {v};' for k, v in t.items()]
    return f'{selector} {{\n' + '\n'.join(lines) + (f'\n  {extra}' if extra else '') + '\n}\n'


def main():
    root = Path(__file__).resolve().parent.parent
    css = ['/* Farbdesigns – erzeugt von tools/make-palettes.py, nicht von Hand ändern.\n'
           '   Aktiv über <html data-palette="…"> (js/palette.js); ohne Attribut gilt das Standard-Design aus styles.css. */\n']
    ok = True
    print('Kontrastprüfung:')
    for p in PALETTES:
        lt, dt = light_tokens(p), dark_tokens(p)
        ok &= report(p['name'], 'hell', lt)
        ok &= report(p['name'], 'dunkel', dt)
        sel = f':root[data-palette="{p["id"]}"]'
        css.append(f'\n/* {p["name"]}: {p["c1"]} {p["c2"]} {p["c3"]} {p["accent"]} */\n')
        css.append(block(sel, lt, 'color-scheme: light;'))
        css.append('@media (prefers-color-scheme: dark) {\n' + block(f'  {sel}:not([data-theme="light"])', dt, 'color-scheme: dark;').replace('\n  --', '\n    --') + '}\n')
        css.append(block(f'{sel}[data-theme="dark"]', dt, 'color-scheme: dark;'))
    (root / 'css/palettes.css').write_text(''.join(css), encoding='utf-8')

    entries = [STANDARD] + [{'id': p['id'], 'name': p['name'], 'swatches': p['show']} for p in PALETTES]
    js = ('// Farbdesigns für die Auswahl unter Haushalt → Farbdesign – erzeugt von tools/make-palettes.py.\n'
          'export const PALETTES = [\n'
          + ''.join(f"  {{ id: '{e['id']}', name: '{e['name']}', swatches: [{', '.join(repr(s) for s in e['swatches'])}] }},\n" for e in entries)
          + '];\n')
    (root / 'js/palettes.js').write_text(js.replace('"', "'"), encoding='utf-8')
    print('Geschrieben: css/palettes.css, js/palettes.js' + ('' if ok else '  – ACHTUNG: nicht alle Kontraste reichen'))


if __name__ == '__main__':
    main()
