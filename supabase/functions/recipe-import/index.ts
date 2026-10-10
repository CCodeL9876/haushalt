// Supabase Edge Function „recipe-import“: liest Titel, Zutaten, Portionen und Stichworte aus einer Rezeptseite.
// Der Browser darf fremde Seiten nicht selbst abrufen – ein Server schon.
//
// Fast alle grossen Rezeptseiten (Betty Bossi, Swissmilk, Fooby, Migusto, Chefkoch …) beschreiben ihre Rezepte
// zusätzlich maschinenlesbar im schema.org-Format „Recipe“ (JSON-LD). Genau das wird gelesen; als Ersatz die
// Mikrodaten-Variante (itemprop="recipeIngredient"). Gibt nur diese Angaben zurück, nie die Seite selbst, und
// speichert und protokolliert nichts. Einrichtung: ANLEITUNG.md, Abschnitt „Rezepte per Link“ (JWT-Prüfung aus).
//
// Bewusst als eine einzige Datei in reinem JavaScript (gültiges TypeScript), damit sie sich im Supabase-Dashboard
// per Kopieren und Einfügen einrichten lässt. extractRecipe() hat keine Abhängigkeiten – so lässt sie sich auch
// im Browser testen.

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 12000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à',
  ccedil: 'ç', deg: '°', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', bdquo: '„', times: '×' };

// HTML-Zeichen („&amp;“, „&#228;“) dekodieren, Tags entfernen, Leerraum zusammenfassen
export function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isRecipe = (node) => asList(node?.['@type']).some((t) => String(t).toLowerCase() === 'recipe');

// Alle Objekte im JSON-LD durchgehen (Listen, @graph, verschachtelte Einträge wie mainEntity)
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipe(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const hit = findRecipe(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

// „PT1H30M“ → 90 (Minuten)
function minutes(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i.exec(String(iso || ''));
  if (!m) return null;
  const total = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
  return total > 0 ? total : null;
}

function firstImage(image) {
  const first = asList(image)[0];
  const url = typeof first === 'string' ? first : first?.url || first?.contentUrl;
  return /^https?:\/\//.test(url || '') ? url : '';
}

function servingsText(yieldValue) {
  const list = asList(yieldValue).map((v) => cleanText(v)).filter(Boolean);
  // Oft doppelt: ["4", "4 Personen"] → das ausführlichere nehmen
  return list.sort((a, b) => b.length - a.length)[0] || '';
}

function tagsOf(recipe) {
  const raw = [
    ...asList(recipe.recipeCategory),
    ...asList(recipe.recipeCuisine),
    ...asList(recipe.keywords).flatMap((k) => String(k).split(',')),
  ];
  const seen = new Set();
  return raw.map(cleanText).filter((t) => {
    const key = t.toLowerCase();
    if (!t || t.length > 30 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

// Rezept aus dem HTML einer Seite lesen. Rückgabe: { title, ingredients, servings, minutes, tags, image } oder null
export function extractRecipe(html, pageUrl = '') {
  const text = String(html || '');
  const blocks = [...text.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let data = null;
    const raw = body.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      data = JSON.parse(raw);
    } catch {
      try { data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; } // Zeilenumbrüche in Texten
    }
    const recipe = findRecipe(data);
    if (!recipe) continue;
    const ingredients = asList(recipe.recipeIngredient || recipe.ingredients).map(cleanText).filter(Boolean);
    let title = cleanText(recipe.name || recipe.headline);
    // Chefkoch hängt den Namen der Person an, die das Rezept eingestellt hat („… von Mathias56“)
    if (/chefkoch\./i.test(pageUrl)) title = title.replace(/\s+von\s+\S+$/i, '');
    if (!title && !ingredients.length) continue;
    return {
      title,
      ingredients: ingredients.slice(0, 80),
      servings: servingsText(recipe.recipeYield),
      minutes: minutes(recipe.totalTime) || minutes(recipe.cookTime),
      tags: tagsOf(recipe),
      image: firstImage(recipe.image),
      url: pageUrl,
    };
  }
  // Ersatz: Mikrodaten im HTML (z. B. Swissmilk: <tr itemprop="recipeIngredient">)
  const micro = microdataTexts(text, 'recipeIngredient');
  if (micro.length) {
    const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(text)?.[1];
    const title = pageTitle(og || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] || '');
    const image = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(text)?.[1] || '';
    return { title, ingredients: micro.slice(0, 80), servings: '', minutes: null, tags: [], image: firstImage(image), url: pageUrl };
  }
  return null;
}

// „Quittengelee - Rezept | Swissmilk“ → „Quittengelee“
function pageTitle(raw) {
  return cleanText(raw).split(/\s+[|·]\s+/)[0].replace(/\s+[-–]\s*Rezept\b.*$/i, '').trim();
}

// Inhalt aller Elemente mit itemprop="…" – bis zum passenden schliessenden Tag, auch wenn darin gleichnamige
// Elemente verschachtelt sind (<span itemprop=…><span>200</span> g Mehl</span>)
function microdataTexts(html, prop) {
  const out = [];
  const start = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*itemprop\\s*=\\s*["']${prop}["'][^>]*>`, 'gi');
  let m;
  while ((m = start.exec(html)) && out.length < 80) {
    const tag = m[1].toLowerCase();
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tags.lastIndex = start.lastIndex;
    let depth = 1;
    let end = -1;
    let t;
    while ((t = tags.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    if (end < 0) break;
    const value = cleanText(html.slice(start.lastIndex, end));
    if (value) out.push(value);
    start.lastIndex = end;
  }
  return out;
}

// Nur öffentliche Webseiten: keine internen Adressen, IPs oder ungewöhnlichen Ports
function allowedUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null; // IP-Adressen
  return url;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function readLimited(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c.subarray(0, Math.min(c.length, size - offset)), offset); offset += c.length; }
  return new TextDecoder('utf-8').decode(all);
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);
  let input = '';
  try {
    input = String((await req.json())?.url || '').trim();
  } catch {
    return json({ error: 'ungültige Anfrage' }, 400);
  }
  const url = input.length <= 2000 ? allowedUrl(input) : null;
  if (!url) return json({ error: 'Bitte einen Link zu einer Rezeptseite (https://…) einfügen.' }, 400);
  let res;
  try {
    res = await fetch(url.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Manche Seiten liefern Programmen ohne Browser-Kennung nichts aus
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-CH,de;q=0.9',
      },
    });
  } catch {
    return json({ error: 'Die Seite antwortet nicht.' }, 502);
  }
  if (!res.ok) return json({ error: `Die Seite meldet Fehler ${res.status}.` }, 502);
  if (!allowedUrl(res.url || url.href)) return json({ error: 'Weiterleitung auf eine nicht erlaubte Adresse.' }, 400);
  const recipe = extractRecipe(await readLimited(res), res.url || url.href);
  if (!recipe) return json({ error: 'Auf dieser Seite wurde kein Rezept gefunden.' }, 422);
  return json(recipe);
}

// Nur auf dem Server starten – im Browser (Test) wird nur extractRecipe gebraucht
if (typeof Deno !== 'undefined') Deno.serve(handle);
