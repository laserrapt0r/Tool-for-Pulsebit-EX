// Lokale Speicherung (IndexedDB). Alle Daten bleiben im Browser des Geräts.
const DB = 'ekg-auswertung', VER = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('persons')) db.createObjectStore('persons', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveRecord = rec => tx('records', 'readwrite', s => s.put(rec));
export const getRecord = id => tx('records', 'readonly', s => s.get(id));
export const deleteRecord = id => tx('records', 'readwrite', s => s.delete(id));
export async function listRecords() {
  const all = await tx('records', 'readonly', s => s.getAll());
  return (all || []).sort((a, b) => (b.date || 0) - (a.date || 0));
}
export const savePerson = p => tx('persons', 'readwrite', s => s.put(p));
export const deletePerson = id => tx('persons', 'readwrite', s => s.delete(id));
export async function listPersons() {
  const all = await tx('persons', 'readonly', s => s.getAll());
  return (all || []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
export const newPersonId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const getSetting = (k, def) => tx('settings', 'readonly', s => s.get(k)).then(v => (v === undefined ? def : v));
export const setSetting = (k, v) => tx('settings', 'readwrite', s => s.put(v, k));

/** Eindeutige ID aus Quelle und Zeitpunkt (verhindert doppelte Importe). */
export function recordId(source, date, extra = '') {
  const t = date instanceof Date && !isNaN(date) ? date.toISOString() : String(Date.now());
  return `${source}:${t}${extra ? ':' + extra : ''}`;
}

/** Sicherung aller Aufnahmen als JSON (Signale als Arrays). */
export async function exportAll() {
  const recs = await listRecords();
  return JSON.stringify({ format: 'ekg-auswertung-backup', version: 2, exported: new Date().toISOString(), persons: await listPersons(), records: recs.map(r => ({ ...r, signal: Array.from(r.signal), date: r.date?.toISOString?.() || r.date })) });
}
export async function importBackup(text) {
  const d = JSON.parse(text);
  if (d.format !== 'ekg-auswertung-backup') throw new Error('Keine Sicherungsdatei dieser App');
  for (const p of d.persons || []) await savePerson(p);
  for (const r of d.records) await saveRecord({ ...r, signal: Float32Array.from(r.signal), date: r.date ? new Date(r.date) : null });
  return d.records.length;
}
