// Import aus Dateien: ViHealth-PDF, Pulsebit-Rohdatei, CSV/Text, Sicherung.
import { digitizePage, joinRows } from './pdf-digitize.js';
import { parseEcgFile } from './pulsebit-file.js';
import { t } from '../i18n.js';

/** Liest Datum/Uhrzeit aus Dateinamen wie „Pulsebit EX_0001_20250101120000_HeartCheck.pdf“. */
export function dateFromName(name) {
  const m = /(20\d{2})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(name);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

/** ViHealth-PDF: Seiten rendern und EKG-Kurve rekonstruieren. */
export async function importPdf(file, onStatus = () => {}) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    onStatus(t('imp.pdfPage', { i, n: doc.numPages }));
    const page = await doc.getPage(i);
    const tc = await page.getTextContent().catch(() => null);
    if (tc) text += tc.items.map(t => t.str).join(' ') + '\n';
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 1890 / vp1.width; // ≈ 9 px/mm wie im ViHealth-Bild
    const vp = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    try { pages.push(digitizePage(img.data, img.width, img.height)); } catch { /* Seite ohne EKG */ }
  }
  if (!pages.length) throw new Error(t('imp.noEcgInPdf'));
  const { signal, fs } = joinRows(pages, 250);
  return {
    source: 'pdf', fileName: file.name, date: dateFromName(file.name) || new Date(file.lastModified),
    fs, signal, deviceName: /^(.*?)_\d{4}_/.exec(file.name)?.[1] || 'ViHealth-PDF',
    pdfText: text.trim(),
  };
}

/** CSV/Text: eine Spalte mit mV-Werten oder „Zeit;Wert“. Abtastrate über Kopfzeile „fs=…“ oder Nachfrage. */
export async function importText(file, askFs) {
  const txt = await file.text();
  const fsMatch = /fs\s*[=:]\s*(\d+(?:\.\d+)?)/i.exec(txt);
  const nums = [];
  // Trennzeichen erkennen: bei „;“ oder Tab ist das Komma ein Dezimalkomma (deutsches Format)
  const sepSemi = /[;\t]/.test(txt.slice(0, 2000));
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const raw = sepSemi ? line.split(/[;\t]+/) : /^\s*-?\d+,\d+\s*$/.test(line) ? [line] : line.split(/[,\s]+/);
    const parts = raw.map(v => v.trim()).filter(Boolean).map(v => +v.replace(',', '.'));
    if (parts.length && parts.every(v => Number.isFinite(v))) nums.push(parts[parts.length - 1]);
  }
  if (nums.length < 500) throw new Error(t('imp.fewValues'));
  const amp = Math.max(...nums.slice(0, 5000).map(Math.abs));
  if (amp > 20) throw new Error(t('imp.badAmp', { v: Math.round(amp) }));
  const fs = fsMatch ? +fsMatch[1] : await askFs();
  return { source: 'text', fileName: file.name, date: dateFromName(file.name) || new Date(file.lastModified), fs, signal: Float32Array.from(nums) };
}

/** Rohdatei vom Gerät (Name yyyyMMddHHmmss, ohne Endung). */
export async function importPulsebitFile(file) {
  let r;
  try { r = parseEcgFile(new Uint8Array(await file.arrayBuffer()), file.name); } catch (e) { throw new Error(t(/^imp\./.test(e.message) ? e.message : 'imp.badFormat')); }
  return { ...r, date: r.date || new Date(file.lastModified), deviceName: 'Pulsebit EX' };
}

/** Wählt den passenden Importer anhand von Endung/Inhalt. */
export async function importFile(file, { onStatus, askFs } = {}) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return [await importPdf(file, onStatus)];
  if (n.endsWith('.csv') || n.endsWith('.txt')) return [await importText(file, askFs)];
  if (/^\d{14}$/.test(file.name) || n.endsWith('.dat') || n.endsWith('.bin')) return [await importPulsebitFile(file)];
  // unbekannt: als Pulsebit-Datei versuchen
  return [await importPulsebitFile(file)];
}
