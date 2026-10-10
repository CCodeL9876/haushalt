// Verbindung zur Supabase-Datenbank, direkt über deren REST-Schnittstelle (ohne zusätzliche Bibliothek).
//
// Zugriffsprinzip wie bei Mallorca: Jeder Haushalt hat einen geheimen, zufälligen Schlüssel (steht im Link)
// und einen Zugangscode. Beide gehen bei jeder Anfrage als Header mit ("x-hh-key", "x-hh-code"); die Datenbank
// gibt nur Zeilen genau dieses Haushalts heraus und nur, wenn der Code stimmt (supabase/schema.sql).
//
// Alle Daten liegen in einer Tabelle „items“: eine Zeile pro Eintrag (collection + id), Inhalt als JSON.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sharingConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Der Code geht als HTTP-Header mit – dort sind nur einfache Zeichen sicher (Umlaute senden Browser nicht als UTF-8)
export const validCodeChars = (code) => /^[\x20-\x7E]+$/.test(code);

export class AccessError extends Error {
  // status: 'unknown' (kein Haushalt zu diesem Link) oder 'wrong' (Code fehlt oder stimmt nicht)
  constructor(status) {
    super(status === 'unknown' ? 'Diesen Haushalt gibt es nicht' : 'Zugangscode stimmt nicht');
    this.status = status;
  }
}

export class Remote {
  constructor(key, code) {
    this.key = key;
    this.code = code;
  }

  async #request(path, { method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      'x-hh-key': this.key,
      'x-hh-code': this.code,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    };
    // Ältere „anon“-Keys sind JWTs und gehören zusätzlich in Authorization; neue „publishable“-Keys nicht
    if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Datenbank antwortet mit ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Prüft Schlüssel und Code. Gibt den Namen des Haushalts zurück oder wirft AccessError.
  async login() {
    const info = await this.#request('rpc/household_login', { method: 'POST', body: {} });
    if (info?.status !== 'ok') throw new AccessError(info?.status === 'unknown' ? 'unknown' : 'wrong');
    return info.name || 'Haushalt';
  }

  async loadAll() {
    return this.#request(`items?select=collection,id,data&household_key=eq.${encodeURIComponent(this.key)}`);
  }

  // rows: [{ collection, id, data }]
  async upsert(rows) {
    if (!rows.length) return;
    await this.#request('items', {
      method: 'POST',
      body: rows.map((r) => ({ household_key: this.key, ...r })),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  // ids: { collection: [id, …] }
  async remove(ids) {
    for (const [collection, list] of Object.entries(ids)) {
      if (!list.length) continue;
      const inList = list.map((id) => `"${String(id).replace(/["\\]/g, '')}"`).join(',');
      await this.#request(`items?household_key=eq.${encodeURIComponent(this.key)}&collection=eq.${collection}&id=in.(${encodeURIComponent(inList)})`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      });
    }
  }

  async setCode(newCode) {
    await this.#request('rpc/set_household_code', { method: 'POST', body: { new_code: newCode } });
    this.code = newCode;
  }
}
