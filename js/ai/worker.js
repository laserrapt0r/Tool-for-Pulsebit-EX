// Web Worker: ONNX-Inferenz für ECGFounder (WebGPU, sonst WASM).
import * as ort from '../../vendor/ort/ort.webgpu.min.mjs';

ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let session = null, labels = null, backend = '';

// Bekannte Modellgröße (unkomprimiert) für die Fortschrittsanzeige. Content-Length ist bei
// komprimierter Auslieferung (z. B. GitHub Pages: gzip) kleiner als die tatsächlich empfangenen Bytes.
const MODEL_BYTES = 61940022;
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(JSON.stringify({ k: 'ai.noModel', status: res.status }));
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const encoded = !!res.headers.get('content-encoding');
  const total = (!encoded && +res.headers.get('content-length')) || MODEL_BYTES;
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.min(0.99, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf;
}

async function init(modelUrl, labelsUrl, forceWasm = false) {
  labels = await (await fetch(labelsUrl)).json();
  const bytes = await fetchWithProgress(modelUrl, p => postMessage({ type: 'status', k: 'ai.loading', p: Math.round(p * 100) }));
  postMessage({ type: 'status', k: 'ai.init' });
  const tryEP = async ep => { session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' }); backend = ep; };
  // WebGPU nur mit echter Grafikkarte; Software-Adapter (z. B. SwiftShader) sind langsamer als WASM
  if (self.navigator?.gpu && !forceWasm) {
    try {
      const ad = await navigator.gpu.requestAdapter();
      const fallback = !ad || ad.isFallbackAdapter || ad.info?.isFallbackAdapter || /swiftshader|llvmpipe|software/i.test(`${ad.info?.vendor} ${ad.info?.architecture} ${ad.info?.description}`);
      if (!fallback) await tryEP('webgpu');
    } catch { session = null; }
  }
  if (!session) await tryEP('wasm');
  return { labels, backend };
}

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const r = await init(m.modelUrl, m.labelsUrl, m.forceWasm);
      postMessage({ type: 'result', id: m.id, ...r });
    } else if (m.type === 'run') {
      const t0 = performance.now(), probs = [];
      for (let i = 0; i < m.windows.length; i++) {
        postMessage({ type: 'status', k: 'ai.section', i: i + 1, n: m.windows.length });
        const t = new ort.Tensor('float32', m.windows[i], [1, 1, m.windows[i].length]);
        const out = await session.run({ ecg: t });
        const lg = out.logits.data;
        probs.push(Float32Array.from(lg, v => 1 / (1 + Math.exp(-v))));
      }
      postMessage({ type: 'result', id: m.id, probs, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, error: String(err?.message || err) });
  }
};
