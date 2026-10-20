// Verschlüsselte Sicherung: alle Daten des Haushalts (und auf Wunsch die eigenen persönlichen ToDo-Listen) als
// Datei, verschlüsselt mit einem Passwort – so seid ihr nicht allein von Supabase abhängig, und die Datei verrät
// nichts, wenn sie in die falschen Hände gerät. Verschlüsselt wird im Browser (PBKDF2 → AES-GCM, Web Crypto);
// das Passwort wird nirgends gespeichert. Ohne Passwort lässt sich die Datei nicht mehr öffnen.
// Ältere, unverschlüsselte Sicherungen (reines JSON des Datensatzes) lassen sich weiterhin einspielen.

const FORMAT = 'haushalt-sicherung';
const ITERATIONS = 310000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// content: { state, personal? } → Text der Sicherungsdatei
export async function encryptBackup(content, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(content)));
  return JSON.stringify({ format: FORMAT, version: 1, created: new Date().toISOString(), iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

export const isEncrypted = (file) => file?.format === FORMAT;

// Geöffnete Datei (JSON) → { state, personal? }. Falsches Passwort: Fehler mit verständlicher Meldung.
export async function decryptBackup(file, password) {
  const iterations = Math.min(Math.max(Number(file.iterations) || ITERATIONS, 100000), 2000000);
  const key = await deriveKey(password, unb64(file.salt), iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
  } catch {
    throw new Error('Passwort stimmt nicht (oder die Datei ist beschädigt)');
  }
  const content = JSON.parse(new TextDecoder().decode(plain));
  if (!content || typeof content.state !== 'object') throw new Error('Die Sicherung enthält keine Daten');
  return content;
}

// Datei weitergeben: am iPhone über „Teilen“ (→ „In Dateien sichern“), sonst als Download
export async function saveFile(text, filename) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
