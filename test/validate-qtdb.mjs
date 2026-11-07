// Vergleicht die App-Vermessung (erste Ableitung) mit den Kardiologen-Markierungen der QT-Datenbank, nach Herzfrequenz geschichtet.
// Aufruf: node test/validate-qtdb.mjs <qtdb.json aus tools/validation/qtdb_prepare.py>
import { readFileSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
const recs = JSON.parse(readFileSync(process.argv[2]));
const band = h => h == null ? '?' : h < 60 ? '<60' : h < 80 ? '60-80' : h < 100 ? '80-100' : '≥100';
const stat = () => ({ n: 0, d: [], miss: 0 });
const add = (s, d) => { if (d == null) s.miss++; else { s.n++; s.d.push(d); } };
const fmt = s => {
  if (!s.n) return `n0 fehlend ${s.miss}`;
  const bias = s.d.reduce((x, y) => x + y, 0) / s.n, mae = s.d.reduce((x, y) => x + Math.abs(y), 0) / s.n;
  return `n${String(s.n).padStart(3)} Bias ${String(Math.round(bias)).padStart(4)} MAE ${String(Math.round(mae)).padStart(3)} ±20 ms ${String(Math.round(100 * s.d.filter(v => Math.abs(v) <= 20).length / s.n)).padStart(3)}% ±40 ms ${String(Math.round(100 * s.d.filter(v => Math.abs(v) <= 40).length / s.n)).padStart(3)}% fehlend ${s.miss}`;
};
const S = {}, lq = [];
for (const r of recs) {
  const a = analyze(Float32Array.from(r.signal), r.fs); const iv = a.intervals || {};
  for (const k of [band(r.ref.hr), 'alle']) {
    const s = S[k] ??= { pr: stat(), qrs: stat(), qt: stat(), qtRel: stat(), n: 0 }; s.n++;
    if (r.ref.pr != null) add(s.pr, iv.pr != null ? iv.pr - r.ref.pr : null);
    add(s.qrs, iv.qrs != null ? iv.qrs - r.ref.qrs : null);
    if (r.ref.qt != null) { add(s.qt, iv.qt != null ? iv.qt - r.ref.qt : null); if (iv.qtReliable) add(s.qtRel, iv.qt - r.ref.qt); else s.qtRel.miss++; }
  }
  if (r.ref.qt != null && iv.qt != null) { const rr = 60 / r.ref.hr; lq.push([r.ref.qt / Math.cbrt(rr) >= 450, iv.qtReliable && iv.qtcF >= 450]); }
}
for (const [k, s] of Object.entries(S)) console.log(`${k.padEnd(6)} n${String(s.n).padStart(3)} | PR ${fmt(s.pr)} | QRS ${fmt(s.qrs)} | QT ${fmt(s.qt)} | QT nur verlässlich ${fmt(s.qtRel)}`);
const tp = lq.filter(x => x[0] && x[1]).length, fn = lq.filter(x => x[0] && !x[1]).length, fp = lq.filter(x => !x[0] && x[1]).length, tn = lq.filter(x => !x[0] && !x[1]).length;
console.log(`QTc (Fridericia) ≥ 450 ms laut Kardiologe vs. verlässliche App-Messung ≥ 450: erkannt ${tp}/${tp + fn}, falsch-positiv ${fp}/${fp + tn}`);
