// Prüft die Schlagklassifikation (N/SVES/VES) gegen MIT-BIH (ärztliche Schlag-Annotationen, AAMI-Klassen).
// Aufruf: node test/validate-mitdb.mjs <basis aus tools/validation/mitdb_prepare.py> [DS1|DS2|all]
import { readFileSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
import { interpret } from '../js/findings.js';
const base = process.argv[2], which = process.argv[3] || 'all', sinusOnly = process.argv.includes('--sinus');
// --sinus: nur Abschnitte mit reinem Sinusrhythmus (ohne Vorhofflimmern/-flattern, Tachykardien, Bigeminus-Markierung)
const idx = JSON.parse(readFileSync(base + '.json')).filter(s => (which === 'all' || s.set === which) && (!sinusOnly || (s.rhythm.length && s.rhythm.every(r => r === '(N'))));
const buf = readFileSync(base + '.f32'), all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const C = {}; const add = (r, a) => { C[r] ??= {}; C[r][a] = (C[r][a] || 0) + 1; };
const seg = { vRef: 0, vHit: 0, vNoRef: 0, vFalse: 0, sRef: 0, sHit: 0, sNoRef: 0, sFalse: 0, vAbklaeren: 0, vAbklaerenNoRef: 0 };
let fp = 0;
for (const s of idx) {
  const x = all.subarray(s.off, s.off + s.n);
  const a = analyze(x, s.fs);
  const f = interpret(a, {});
  const isAF = f.isAF;
  const ours = (a.beats || []).map(b => ({ t: b.t, type: isAF && b.type === 'S' ? 'N' : b.type, edge: b.edge, used: false }));
  const ref = s.beats.map(([smp, c]) => ({ t: smp / s.fs, c })).filter(b => b.t > 0.4 && b.t < s.n / s.fs - 0.4);
  for (const r of ref) {
    let best = null, bd = 0.15;
    for (const o of ours) if (!o.used && Math.abs(o.t - r.t) < bd) { bd = Math.abs(o.t - r.t); best = o; }
    if (best) { best.used = true; add(r.c, best.type); } else add(r.c, 'missed');
  }
  fp += ours.filter(o => !o.used && !o.edge).length;
  const hasV = ref.some(r => r.c === 'V'), hasS = ref.some(r => r.c === 'S');
  const vF = f.findings.find(z => z.id === 'ves'), sF = f.findings.find(z => z.id === 'sves');
  if (hasV) { seg.vRef++; if (vF) seg.vHit++; } else { seg.vNoRef++; if (vF) seg.vFalse++; if (vF?.level === 'abklaeren') seg.vAbklaerenNoRef++; }
  if (hasS) { seg.sRef++; if (sF) seg.sHit++; } else { seg.sNoRef++; if (sF) seg.sFalse++; }
}
const tot = (r) => Object.values(C[r] || {}).reduce((a, b) => a + b, 0);
const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);
const col = t => ['N', 'S', 'V', 'F', 'Q'].reduce((s, r) => s + ((C[r] || {})[t] || 0), 0);
const out = {
  set: which + (sinusOnly ? ' (nur Sinusrhythmus)' : ''), segments: idx.length,
  confusion: C,
  beats: { detectSe: pct(['N', 'S', 'V', 'F', 'Q'].reduce((s, r) => s + tot(r) - ((C[r] || {}).missed || 0), 0), ['N', 'S', 'V', 'F', 'Q'].reduce((s, r) => s + tot(r), 0)), extraDetections: fp },
  VES: { Se: pct((C.V || {}).V || 0, tot('V')), PPV: pct((C.V || {}).V || 0, col('V')) },
  SVES: { Se: pct((C.S || {}).S || 0, tot('S')), PPV: pct((C.S || {}).S || 0, col('S')) },
  segments_VES: { sensitivity: pct(seg.vHit, seg.vRef), falseRate: pct(seg.vFalse, seg.vNoRef), nWith: seg.vRef, nWithout: seg.vNoRef, abklaerenWithoutV: seg.vAbklaerenNoRef },
  segments_SVES: { sensitivity: pct(seg.sHit, seg.sRef), falseRate: pct(seg.sFalse, seg.sNoRef), nWith: seg.sRef, nWithout: seg.sNoRef },
};
console.log(JSON.stringify(out, null, 1));
