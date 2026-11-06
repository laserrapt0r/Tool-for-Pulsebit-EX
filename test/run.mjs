// Node-Tests: Protokoll-Simulation, Analyse und Befunde (synthetische EKGs), Sprachdateien.
// Mit eigenen ViHealth-PDFs (lokal, nicht im Repo): Bilder nach test/fixtures/*.rgba legen → Digitalisierungs-Test.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
const run = (f, ...a) => { console.log(`\n### ${f} ${a.join(' ')}`); console.log(execFileSync('node', [`test/${f}`, ...a], { encoding: 'utf8' })); };
if (existsSync('test/fixtures/a1.rgba')) run('digitize-test.mjs');
run('protocol-test.mjs');
run('findings-test.mjs');
run('i18n-test.mjs');
