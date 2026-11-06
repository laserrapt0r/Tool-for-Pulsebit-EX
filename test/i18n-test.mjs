// Prüft alle Sprachdateien: gleiche Schlüssel und Platzhalter wie de.js, gültiges HTML-Tag-Gleichgewicht.
import { readdirSync } from 'node:fs';
const de = (await import('../js/locales/de.js')).default;
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
const tags = s => (s.match(/<\/?(b|strong|i|code|a)\b/g) || []).sort().join();
let bad = 0;
for (const f of readdirSync('js/locales').filter(f => f !== 'de.js')) {
  const d = (await import(`../js/locales/${f}`)).default;
  const miss = Object.keys(de).filter(k => !(k in d)), extra = Object.keys(d).filter(k => !(k in de));
  const phBad = Object.keys(de).filter(k => k in d && ph(de[k]) !== ph(d[k]));
  const tagBad = Object.keys(de).filter(k => k in d && tags(de[k]) !== tags(d[k]));
  const same = Object.keys(de).filter(k => k in d && d[k] === de[k] && de[k].length > 25);
  console.log(`${f}: ${Object.keys(d).length} Schlüssel, fehlend ${miss.length}, überzählig ${extra.length}, Platzhalter ${phBad.length}, Tags ${tagBad.length}, unübersetzt? ${same.length}`);
  if (miss.length || extra.length || phBad.length || tagBad.length) { bad++; console.log('  ', [...miss, ...extra, ...phBad, ...tagBad].slice(0, 20)); }
}
if (bad) process.exit(1);
