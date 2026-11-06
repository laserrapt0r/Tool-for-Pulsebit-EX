// Vergleicht die App-Vermessung (Ableitung I) mit den ärztlichen Markierungen der LUDB.
// Aufruf: node test/validate-ludb.mjs <ludb.json aus tools/validation/ludb_prepare.py> [--detail]
import { readFileSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
import { interpret } from '../js/findings.js';
const recs = JSON.parse(readFileSync(process.argv[2]));
const detail = process.argv.includes('--detail');
const pick = (arr, k) => arr.filter(x => x[k] != null);
const stats = (pairs) => {
  const e = pairs.map(([a, r]) => a - r), ae = e.map(Math.abs).sort((a, b) => a - b);
  const m = e.reduce((s, v) => s + v, 0) / e.length, sd = Math.sqrt(e.reduce((s, v) => s + (v - m) ** 2, 0) / e.length);
  return { n: e.length, bias: Math.round(m), sd: Math.round(sd), mae: Math.round(ae.reduce((s, v) => s + v, 0) / ae.length),
    median_ae: Math.round(ae[ae.length >> 1]), within10: Math.round(100 * ae.filter(v => v <= 10).length / ae.length), within20: Math.round(100 * ae.filter(v => v <= 20).length / ae.length), within40: Math.round(100 * ae.filter(v => v <= 40).length / ae.length) };
};
const rows = [];
for (const r of recs) {
  if (r.paced) continue;
  const a = analyze(r.signal, r.fs); a.source = 'raw';
  const f = interpret(a, { sex: r.sex === 'M' ? 'm' : r.sex === 'F' ? 'w' : '' });
  const iv = a.intervals || {};
  rows.push({ id: r.id, rhythm: r.rhythm, ref: r.ref, pr: iv.pr, qrs: iv.qrs, qt: iv.qt, pPresent: !!iv.pPresent, pRatio: a.pRatio, q: a.quality?.score,
    ids: f.findings.map(x => x.id), head: f.headline });
}
const sinusLike = rows.filter(r => /sinus/i.test(r.rhythm));
const out = {};
out.PR = stats(sinusLike.filter(r => r.pr != null && r.ref.pr != null && r.ref.pFraction >= 0.8).map(r => [r.pr, r.ref.pr]));
out.QRS = stats(rows.filter(r => r.qrs != null && r.ref.qrs != null).map(r => [r.qrs, r.ref.qrs]));
out.QT = stats(rows.filter(r => r.qt != null && r.ref.qt != null && !/fibrillation|flutter/i.test(r.rhythm)).map(r => [r.qt, r.ref.qt]));
const pRef = sinusLike.filter(r => r.ref.pFraction >= 0.8);
out.P_detected_in_sinus = `${pRef.filter(r => r.pPresent).length}/${pRef.length}`;
out.PR_missing_in_sinus = pRef.filter(r => r.pr == null).length;
// klinische Schwellen: AV-Block I° (>200), breiter QRS (≥120)
const cls = (pairs, thr) => { let tp = 0, fp = 0, fn = 0, tn = 0; for (const [a, rf] of pairs) { const A = a >= thr, R = rf >= thr; A && R ? tp++ : A ? fp++ : R ? fn++ : tn++; } return { tp, fp, fn, tn }; };
out.PR_gt200 = cls(sinusLike.filter(r => r.pr != null && r.ref.pr != null).map(r => [r.pr, r.ref.pr]), 201);
out.QRS_ge120 = cls(rows.filter(r => r.qrs != null && r.ref.qrs != null).map(r => [r.qrs, r.ref.qrs]), 120);
// Rhythmus
const af = rows.filter(r => /fibrillation/i.test(r.rhythm));
out.AF_rule_detected = `${af.filter(r => r.ids.includes('af')).length}/${af.length}`;
out.sinus_called_sinus = `${sinusLike.filter(r => r.ids.some(i => i.startsWith('sinus'))).length}/${sinusLike.length}`;
out.sinus_called_af = sinusLike.filter(r => r.ids.includes('af')).length;
out.n = rows.length;
console.log(JSON.stringify(out, null, 1));
if (detail) for (const r of rows) console.log(r.id, r.rhythm.padEnd(26), 'PR', r.pr, '/', r.ref.pr, ' QRS', r.qrs, '/', r.ref.qrs, ' QT', r.qt, '/', r.ref.qt && Math.round(r.ref.qt), ' q', r.q, ' →', r.head);
