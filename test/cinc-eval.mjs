// Bewertet die regelbasierte Auswertung auf der CinC-2017-Teilmenge (A/N/O/~).
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
import { interpret } from '../js/findings.js';
const base = process.argv[2];
const meta = JSON.parse(readFileSync(base + '.json'));
const buf = readFileSync(base + '.f32'); const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const ai = process.argv[3] ? Object.fromEntries(JSON.parse(readFileSync(process.argv[3])).map(r => [r.rec, r])) : null;
const conf = {}; const rows = [];
const t0 = Date.now();
for (const r of meta.records) {
  const x = all.subarray(r.off, r.off + r.n);
  let a; try { a = analyze(x, meta.fs); } catch (e) { a = { beats: [], quality: { score: 0, reasons: [String(e)] } }; }
  const f = interpret(a, {});
  const ids = f.findings.map(z => z.id);
  const pred = ids.includes('af') ? 'AF' : (a.quality?.score ?? 0) < 25 ? 'nicht auswertbar' : 'kein AF';
  (conf[r.label] ||= {})[pred] = ((conf[r.label] ||= {})[pred] || 0) + 1;
  rows.push({ rec: r.rec, label: r.label, pred, q: a.quality?.score, ids, h: a.hrvAll, hn: a.hrv, pr: a.pRatio, nb: a.beats?.length });
}
console.log('Zeit', ((Date.now() - t0) / meta.records.length).toFixed(1), 'ms/Aufnahme');
console.log(JSON.stringify(conf, null, 1));
const A = conf.A || {}, nA = Object.values(A).reduce((s, v) => s + v, 0);
const NO = ['N', 'O'].map(k => conf[k] || {}); const nNO = NO.reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
console.log('Sensitivität AF', ((A.AF || 0) / nA).toFixed(3), ' Spezifität (N+O)', (1 - NO.reduce((s, c) => s + (c.AF || 0), 0) / nNO).toFixed(3));
const qs = l => rows.filter(r => r.label === l).map(r => r.q ?? 0).sort((a, b) => a - b);
for (const l of ['N', 'A', 'O', '~']) { const q = qs(l); console.log('Qualität', l, 'Median', q[q.length >> 1], ' <60:', (q.filter(v => v < 60).length / q.length).toFixed(2)); }
writeFileSync(base + '.rules.json', JSON.stringify(rows));
