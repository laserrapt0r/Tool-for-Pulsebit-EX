#!/usr/bin/env node
// Setzt Version + Inhalts-Hashes im Service Worker.
// Aufruf:  node tools/release.mjs patch|minor|major|1.2.3     (neue Version veröffentlichen)
//          node tools/release.mjs                             (nur prüfen; bricht ab, wenn Dateien geändert wurden)
// Danach committen und pushen – installierte Apps bieten beim nächsten Start „Jetzt aktualisieren“ an.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const sw = join(root, 'sw.js'), ver = join(root, 'js/version.js');
const old = readFileSync(sw, 'utf8');
let cur = /VERSION = '([^']+)'/.exec(readFileSync(ver, 'utf8'))[1];
const arg = process.argv[2];
if (arg) {
  const [a, b, c] = cur.split('.').map(Number);
  cur = arg === 'patch' ? `${a}.${b}.${c + 1}` : arg === 'minor' ? `${a}.${b + 1}.0` : arg === 'major' ? `${a + 1}.0.0` : arg;
  if (!/^\d+\.\d+\.\d+$/.test(cur)) { console.error('Ungültige Version'); process.exit(1); }
  writeFileSync(ver, readFileSync(ver, 'utf8').replace(/VERSION = '[^']+'/, `VERSION = '${cur}'`));
}
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = p => relative(root, p);
const files = ['index.html', 'styles.css', 'manifest.webmanifest', ...walk(join(root, 'js')).map(rel), ...walk(join(root, 'icons')).map(rel)]
  .filter(f => !f.endsWith('.map')).sort();
const h = f => createHash('sha256').update(readFileSync(join(root, f))).digest('hex').slice(0, 10);
const all = createHash('sha256'); for (const f of files) all.update(f + h(f));
const hash = all.digest('hex').slice(0, 10);
const big = createHash('sha256'); for (const f of [...walk(join(root, 'vendor')), ...walk(join(root, 'models'))].map(rel).sort()) { const s = statSync(join(root, f)); big.update(`${f}:${s.size}:${h(f)}`); }
const bigName = `ekg-big-${big.digest('hex').slice(0, 10)}`;
let s = old.replace(/const VERSION = '[^']+';/, `const VERSION = '${cur}';`).replace(/const HASH = '[^']+';/, `const HASH = '${hash}';`)
  .replace(/const BIG = '[^']+';/, `const BIG = '${bigName}';`)
  .replace(/\/\/ <shell>[\s\S]*\/\/ <\/shell>/, `// <shell>\nconst SHELL = [\n  './',\n${files.map(f => `  '${f}#${h(f)}',`).join('\n')}\n];\n// </shell>`);
const oldHash = /const HASH = '([^']+)'/.exec(old)[1], oldVer = /const VERSION = '([^']+)'/.exec(old)[1];
if (!arg && oldHash !== hash && oldVer === cur && oldHash !== 'dev') {
  console.error(`Dateien wurden geändert, Version ${cur} aber nicht erhöht.\nBitte: node tools/release.mjs patch   (oder minor/major)`);
  process.exit(1);
}
writeFileSync(sw, s);
console.log(`Version ${cur} · Hash ${hash} · ${bigName} · ${files.length + 1} Dateien`);
