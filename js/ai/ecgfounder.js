// ECGFounder (1-Kanal) – Vorverarbeitung und Label-Auswahl. Inferenz läuft in worker.js.
// Modell: PKUDigitalHealth/ECGFounder (MIT), Eingabe 10 s @ 500 Hz, 150 Ausgänge (Sigmoid).

import { notch, bandpass, medfilt, resample, mean, std } from '../dsp/filters.js';
import { THRESHOLDS, CALIBRATION } from './thresholds.js';
import { t } from '../i18n.js';

export const MODEL_URL = new URL('../../models/ecgfounder-1lead.onnx', import.meta.url).href;
export const LABELS_URL = new URL('./labels.json', import.meta.url).href;

/** Vorverarbeitung wie ECGFounder util.filter_bandpass + z-Score. x: 500 Hz, Länge 5000. */
export function preprocess500(x) {
  let y = notch(x, 50, 500, 30);
  y = bandpass(y, 0.67, 40, 500, 4);
  const base = medfilt(y, 201);
  for (let i = 0; i < y.length; i++) y[i] -= base[i];
  const m = mean(y), s = std(y) + 1e-8;
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = (y[i] - m) / s;
  return out;
}

/** Zerlegt eine Aufnahme in 10-s-Fenster (50 % Überlappung), jeweils vorverarbeitet. */
export function makeWindows(signal, fs) {
  const x = resample(signal, fs, 500);
  const L = x.length, W = 5000, wins = [];
  if (L <= W) {
    const p = new Float64Array(W); p.set(x);
    wins.push(preprocess500(p));
  } else {
    const starts = [];
    for (let s = 0; s + W <= L; s += 2500) starts.push(s);
    if (starts[starts.length - 1] + W < L) starts.push(L - W);
    for (const s of starts) wins.push(preprocess500(x.subarray(s, s + W)));
  }
  return wins;
}

// Labels, die bei einer Einkanal-Handableitung sinnvoll interpretierbar sind (Rhythmus/Überleitung).
// Morphologie-Labels (Hypertrophie, Lagetyp, Infarkt, Schenkelblock-Typ …) werden bewusst nicht gezeigt:
// Sie sind bei Handgeräten nicht kalibriert und führen zu Fehlalarmen.
export const SHOWN = [
  'SINUS RHYTHM', 'SINUS BRADYCARDIA', 'SINUS TACHYCARDIA', 'WITH SINUS ARRHYTHMIA', 'ATRIAL FIBRILLATION', 'ATRIAL FLUTTER',
  'PREMATURE ATRIAL COMPLEXES', 'PREMATURE SUPRAVENTRICULAR COMPLEXES', 'PREMATURE VENTRICULAR COMPLEXES', 'IN A PATTERN OF BIGEMINY',
  'SUPRAVENTRICULAR TACHYCARDIA', 'VENTRICULAR TACHYCARDIA', 'JUNCTIONAL RHYTHM',
]; // Anzeigenamen: t('lbl.' + label)
// Extrasystolen sind episodisch → Maximum über Fenster; Rhythmen → Mittelwert
const EPISODIC = new Set(['PREMATURE ATRIAL COMPLEXES', 'PREMATURE SUPRAVENTRICULAR COMPLEXES', 'PREMATURE VENTRICULAR COMPLEXES', 'IN A PATTERN OF BIGEMINY', 'VENTRICULAR TACHYCARDIA', 'SUPRAVENTRICULAR TACHYCARDIA']);

/** Fasst Fenster-Wahrscheinlichkeiten zusammen. probs: Float32Array[] (je 150). */
export function aggregate(probs, labels) {
  const out = {};
  labels.forEach((name, i) => {
    const v = probs.map(p => p[i]);
    out[name] = EPISODIC.has(name) ? Math.max(...v) : v.reduce((s, x) => s + x, 0) / v.length;
  });
  return { labels: out, thresholds: THRESHOLDS, calibration: CALIBRATION, windows: probs.length };
}

let worker = null, seq = 0;
const waiting = new Map();

/** Startet (einmalig) den Worker und lädt das Modell. onStatus(text) für Fortschritt. */
export function initAI(onStatus = () => {}) {
  if (worker) return worker.ready;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'status') onStatus(t(m.k, m));
    const w = waiting.get(m.id);
    if (w && (m.type === 'result' || m.type === 'error')) {
      waiting.delete(m.id);
      if (m.type === 'result') return w.resolve(m);
      let msg = m.error; try { const j = JSON.parse(m.error); msg = t(j.k, j); } catch { /* Klartext */ }
      w.reject(new Error(msg));
    }
  };
  worker.ready = call({ type: 'init', modelUrl: MODEL_URL, labelsUrl: LABELS_URL, forceWasm: /[?&]ep=wasm/.test(location.search) });
  return worker.ready;
}

function call(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }, transfer); });
}

/** Führt die KI-Analyse aus. */
export async function runAI(signal, fs, onStatus) {
  const info = await initAI(onStatus);
  const wins = makeWindows(signal, fs);
  const r = await call({ type: 'run', windows: wins });
  const res = aggregate(r.probs, info.labels);
  res.backend = info.backend; res.ms = r.ms;
  return res;
}
