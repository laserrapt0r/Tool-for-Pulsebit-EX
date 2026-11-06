import { readFileSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
for (const k of process.argv.slice(2)) {
  const { fs, signal } = JSON.parse(readFileSync(`test/out-${k}.json`));
  const t0 = Date.now();
  const r = analyze(signal, fs);
  const { signal: _, template, ...iv } = r.intervals ? { ...r.intervals, signal: 0 } : {};
  console.log(`== ${k} (${Date.now() - t0} ms) HR ${r.hr} HRnn ${r.hrNN} beats ${r.beats.length} pol ${r.polarity} pRatio ${r.pRatio?.toFixed(2)}`);
  console.log(' types', r.beats.map(b => b.type).join(''));
  console.log(' rr', r.rr.map(v => v.toFixed(2)).join(' '));
  console.log(' corr', r.beats.map(b => b.corr.toFixed(2)).join(' '));
  console.log(' width ms', r.beats.map(b => Math.round(b.width * 1000)).join(' '));
  const I = r.intervals; console.log(' intervals', JSON.stringify({ pr: I.pr, pDur: I.pDur, qrs: I.qrs, qt: I.qt, qtcB: I.qtcB, qtcF: I.qtcF, st: I.st?.toFixed(3), pAmp: I.pAmp.toFixed(3), rAmp: I.rAmp.toFixed(3), tAmp: I.tAmp.toFixed(3) }));
  console.log(' hrv', JSON.stringify(Object.fromEntries(Object.entries(r.hrv).map(([a, b]) => [a, +b.toFixed(3)]))));
  console.log(' quality', JSON.stringify(r.quality));
}
