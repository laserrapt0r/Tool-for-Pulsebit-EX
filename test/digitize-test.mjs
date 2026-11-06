import { readFileSync, writeFileSync } from 'node:fs';
import { digitizePage, joinRows } from '../js/import/pdf-digitize.js';
const load = f => { const b = readFileSync(f); const w = b.readUInt32LE(0), h = b.readUInt32LE(4); return { d: new Uint8Array(b.buffer, b.byteOffset + 8), w, h }; };
const sets = { a: ['a1'], b: ['b1', 'b2'] };
for (const [k, files] of Object.entries(sets)) {
  const pages = files.map(f => { const { d, w, h } = load(`test/fixtures/${f}.rgba`); const p = digitizePage(d, w, h); console.log(f, 'pxPerMm', p.pxPerMm.toFixed(3), 'fs', p.fs.toFixed(1), 'rows', p.rows.map(r => (r.length / p.fs).toFixed(2) + 's'), 'grid', JSON.stringify(p.grid), 'bases', p.baselines); return p; });
  const { signal, fs } = joinRows(pages);
  console.log(k, 'total', (signal.length / fs).toFixed(2), 's');
  writeFileSync(`test/out-${k}.json`, JSON.stringify({ fs, signal: Array.from(signal) }));
}
