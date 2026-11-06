import { readFileSync } from 'node:fs';
import { preprocess500 } from '../js/ai/ecgfounder.js';
const ref = JSON.parse(readFileSync(process.argv[2]));
const js = preprocess500(Float64Array.from(ref.input500));
let md = 0, s = 0; for (let i = 0; i < js.length; i++) { const d = Math.abs(js[i] - ref.preprocessed[i]); md = Math.max(md, d); s += d; }
const inner = []; for (let i = 300; i < js.length - 300; i++) inner.push(Math.abs(js[i] - ref.preprocessed[i]));
console.log('max Abw.', md.toFixed(4), 'mittl.', (s / js.length).toFixed(5), 'max innen', Math.max(...inner).toFixed(4));
