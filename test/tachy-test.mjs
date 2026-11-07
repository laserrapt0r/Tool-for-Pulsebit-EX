// Regressionstest: Sinustachykardie mit P-Welle auf der T-Welle (T-Wellen-Subtraktion) und Negativkontrollen.
import { analyze } from '../js/dsp/analysis.js';
import { interpret } from '../js/findings.js';
import { synthEcg } from '../js/demo.js';
import { setLang } from '../js/i18n.js';
await setLang('de');
const RHYTHM = ['af', 'irregular', 'sinus', 'sinus_brady', 'sinus_tachy', 'tachy_nop', 'brady_nop', 'rhythm_unclear'];
let fail = 0;
const check = (name, cond, info) => { console.log(`${cond ? 'ok  ' : 'FEHL'} ${name}${info ? ' – ' + info : ''}`); if (!cond) fail++; };
const run = (kind, rr, seed = 1) => { const d = synthEcg(kind, { rr, seed }); const a = analyze(d.signal, d.fs); const f = interpret(a, {}); const r = f.findings.find(x => RHYTHM.includes(x.id)); return { a, f, r, iv: a.intervals }; };
for (const hr of [135, 150]) {
  let ok = 0, prob = 0, prFinding = 0; const ids = {};
  for (let seed = 1; seed <= 5; seed++) {
    const { r, iv, f } = run('tachy', 60 / hr, seed); ids[r?.id] = (ids[r?.id] || 0) + 1;
    if (r?.id === 'sinus_tachy') ok++; if (r?.certainty === 'probable' && iv.pInT) prob++;
    if (f.findings.some(x => ['avb1', 'shortpr'].includes(x.id))) prFinding++;
  }
  check(`Sinustachykardie ${hr}/min erkannt (5 Seeds)`, ok === 5, JSON.stringify(ids));
  check(`  … als „wahrscheinlich“ mit P-auf-T-Kennzeichen`, prob === ok, `${prob}/${ok}`);
  check(`  … keine PR-Befunde (PR nicht verlässlich)`, prFinding === 0, `${prFinding}`);
}
{ const { r, iv } = run('normal', 0.88); check('Sinusrhythmus 68/min: gemessen, ohne T-Subtraktion', r?.id === 'sinus' && r.certainty === 'measured' && !iv.tSub, `${r?.id}/${r?.certainty} tSub=${iv.tSub}`); }
{ const { r } = run('tachy', 0.52); check('Sinustachykardie 115/min: erkannt', r?.id === 'sinus_tachy', r?.id); }
{ let af = 0; for (let seed = 1; seed <= 5; seed++) { const { r } = run('af', 0.45, seed); if (r?.id === 'af' || r?.id === 'irregular') af++; } check('Vorhofflimmern 133/min bleibt Vorhofflimmern/unregelmäßig (5 Seeds)', af === 5, `${af}/5`); }
if (fail) { console.log(`${fail} Prüfung(en) fehlgeschlagen`); process.exit(1); } else console.log('alle Prüfungen bestanden');
