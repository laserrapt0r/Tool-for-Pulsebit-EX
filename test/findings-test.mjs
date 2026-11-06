// Gibt Befunde für synthetische EKGs aus (optional: test/out-*.json aus eigenen PDFs, falls vorhanden).
import { readFileSync, existsSync } from 'node:fs';
import { analyze } from '../js/dsp/analysis.js';
import { interpret } from '../js/findings.js';
import { synthEcg } from '../js/demo.js';
import { setLang } from '../js/i18n.js';
await setLang(process.env.LANG_UI || 'de');
const cases = ['normal', 'pac', 'af', 'pvc', 'brady', 'tachy', 'noisy'].map(k => [k, synthEcg(k)]);
for (const k of process.argv.slice(2)) if (existsSync(`test/out-${k}.json`)) { const d = JSON.parse(readFileSync(`test/out-${k}.json`)); cases.push([`pdf-${k}`, { ...d, source: 'pdf' }]); }
for (const [k, d] of cases) {
  const r = analyze(d.signal, d.fs); r.source = d.source || 'demo';
  const f = interpret(r, { sex: 'm' });
  console.log(`== ${k}: [${f.overall}] ${f.headline}`);
  for (const x of f.findings) console.log(`  - [${x.level}/${x.certainty}] ${x.title}`);
}
