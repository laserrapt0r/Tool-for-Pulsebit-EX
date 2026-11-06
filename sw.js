// Service Worker: Offline-Betrieb und kontrollierte Updates.
// App-Dateien werden versioniert vorab geladen (cache-first). Eine neue Version wird aktiv, sobald der
// Nutzer „Jetzt aktualisieren“ wählt (SKIP_WAITING) – oder spätestens, wenn alle App-Fenster geschlossen waren.
// VERSION, HASH, BIG und SHELL werden von tools/release.mjs gepflegt – nicht von Hand ändern.
const VERSION = '1.0.0';
const HASH = 'e44fa071d9';
const APP = `ekg-app-${VERSION}-${HASH}`;
const BIG = 'ekg-big-bc211fb245'; // KI-Modell, WASM, pdf.js (Name enthält Inhalts-Hash)
// <shell>
const SHELL = [
  './',
  'icons/icon-192.png#e5417bc364',
  'icons/icon-512.png#1fb513e1e6',
  'icons/icon-maskable-512.png#a743f9fc93',
  'icons/icon.svg#e3bf215483',
  'index.html#00d9350ebb',
  'js/ai/ecgfounder.js#7a0a289f97',
  'js/ai/labels.json#e953c4748a',
  'js/ai/thresholds.js#5145bc318d',
  'js/ai/worker.js#be32000c7f',
  'js/app.js#1966e919d8',
  'js/demo.js#7bdcf0cca5',
  'js/device/transports.js#7cbef1834f',
  'js/device/viatom-protocol.js#f51e97ee7f',
  'js/dsp/analysis.js#8f8fd4e025',
  'js/dsp/filters.js#8e9d60323d',
  'js/ecg-view.js#1be07f2e8c',
  'js/findings.js#b20b0af6cd',
  'js/i18n.js#dfdb95dc4a',
  'js/import/importers.js#392a0f2e25',
  'js/import/pdf-digitize.js#7d978fe456',
  'js/import/pulsebit-file.js#2e0f7be90e',
  'js/locales/de.js#0798b0de5d',
  'js/locales/en.js#f458c7f3de',
  'js/locales/es.js#e172f01680',
  'js/locales/fr.js#057039f95c',
  'js/locales/it.js#2c2ed741f0',
  'js/locales/nl.js#f7a24c8507',
  'js/locales/pl.js#cf5ba6a89c',
  'js/locales/tr.js#399ad1473f',
  'js/storage.js#bcf8921352',
  'js/version.js#0ee3eaf6e9',
  'manifest.webmanifest#7c731c3df7',
  'styles.css#19a3bed65f',
];
// </shell>
const BIG_PRELOAD = ['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    // ?h=<Datei-Hash> erzwingt frische Dateien auch an CDN-Zwischenspeichern vorbei; gespeichert wird unter der URL ohne Parameter
    await Promise.all(SHELL.map(async entry => {
      const [path, h] = entry.split('#');
      const res = await fetch(new Request(h ? `${path}?h=${h}` : path, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      await c.put(new Request(new URL(path, self.registration.scope).href), res);
    }));
    // pdf.js für Offline-PDF-Import (nicht kritisch)
    const b = await caches.open(BIG);
    await Promise.all(BIG_PRELOAD.map(async p => { if (!(await b.match(p))) { const r = await fetch(p, { cache: 'reload' }).catch(() => null); if (r?.ok) await b.put(p, r); } }));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('ekg-') && k !== APP && k !== BIG).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'VERSION') e.ports[0]?.postMessage({ version: VERSION });
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/(models|vendor)\//.test(u.pathname)) {
    // groß: einmal laden (am HTTP-Cache vorbei), dann aus dem Cache
    e.respondWith(caches.open(BIG).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(APP);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return req.mode === 'navigate' ? (await c.match('./')) || Response.error() : Response.error(); }
  })());
});
