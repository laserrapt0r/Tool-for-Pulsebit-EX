// Rekonstruiert ein EKG-Signal aus einem gerasterten EKG-Streifen (z. B. ViHealth-PDF-Export).
// Eingabe: RGBA-Pixel (Uint8ClampedArray / Uint8Array), Breite, Höhe.
// Annahmen (ViHealth-Layout): rotes Millimeterraster, schwarze Kurve, 25 mm/s, 10 mm/mV,
// erste Zeile jeder Seite beginnt mit einem 1-mV-Eichimpuls.

const isDark = (d, i) => d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110;
const isRed = (d, i) => d[i] > 170 && d[i] - d[i + 1] > 35 && d[i] - d[i + 2] > 25;

function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Findet Bereich und Abstand des Rasters. */
function findGrid(d, w, h) {
  const colRed = new Uint32Array(w), rowRed = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isRed(d, (y * w + x) * 4)) { colRed[x]++; rowRed[y]++; }
    }
  }
  // Rasterfläche: Zeilen/Spalten mit nennenswert vielen roten Pixeln
  const rowThr = Math.max(50, Math.max(...rowRed) * 0.15);
  let y0 = rowRed.findIndex(v => v > rowThr), y1 = h - 1;
  while (y1 > 0 && rowRed[y1] <= rowThr) y1--;
  if (y0 < 0 || y1 - y0 < 50) return null;

  // Spalten innerhalb [y0,y1] neu zählen
  colRed.fill(0);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (isRed(d, (y * w + x) * 4)) colRed[x]++;
  const colThr = (y1 - y0) * 0.15;
  let x0 = colRed.findIndex(v => v > colThr), x1 = w - 1;
  while (x1 > 0 && colRed[x1] <= colThr) x1--;

  // Hauptlinien (5 mm): Spalten, die fast über die gesamte Höhe rot sind
  const H = y1 - y0 + 1;
  const major = [];
  for (let x = x0; x <= x1; x++) {
    if (colRed[x] > H * 0.75 && (!major.length || x - major[major.length - 1] > 3)) major.push(x);
  }
  const diffs = [];
  for (let i = 1; i < major.length; i++) diffs.push(major[i] - major[i - 1]);
  // Feinlinien können ebenfalls >75 % erreichen – größten häufigen Abstand wählen
  let box = median(diffs);
  if (major.length >= 2) {
    const span = major[major.length - 1] - major[0];
    // Annahme: Großkästchen ~ 5 mm; prüfe ob box eher 1 mm ist (zu viele Linien)
    if (diffs.length > 60) box *= 5;
    if (!(box > 10)) box = span / Math.round(span / 45);
  }
  return { x0, x1, y0, y1, pxPerMm: box / 5 };
}

/** Senkrechte Dunkel-Läufe einer Spalte im Bereich [ya,yb]. */
function darkRuns(d, w, x, ya, yb) {
  const runs = [];
  let start = -1;
  for (let y = ya; y <= yb; y++) {
    const dk = isDark(d, (y * w + x) * 4);
    if (dk && start < 0) start = y;
    if (!dk && start >= 0) { runs.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, yb]);
  return runs;
}

/** Findet die Grundlinien der Kurvenzeilen über das horizontale Dunkel-Profil. */
function findRowBaselines(d, w, g) {
  const prof = new Float64Array(g.y1 - g.y0 + 1);
  for (let y = g.y0; y <= g.y1; y++) {
    let c = 0;
    for (let x = g.x0; x <= g.x1; x++) if (isDark(d, (y * w + x) * 4)) c++;
    prof[y - g.y0] = c;
  }
  // glätten (±1 mm)
  const r = Math.max(2, Math.round(g.pxPerMm));
  const sm = prof.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) if (prof[i + k] !== undefined) { s += prof[i + k]; n++; }
    return s / n;
  });
  const minSep = g.pxPerMm * 15; // Zeilen liegen mind. 15 mm auseinander
  const thr = (g.x1 - g.x0) * 0.04;
  const cand = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > thr) cand.push(i);
  }
  cand.sort((a, b) => sm[b] - sm[a]);
  const peaks = [];
  for (const c of cand) if (peaks.every(p => Math.abs(p - c) > minSep)) peaks.push(c);
  return peaks.sort((a, b) => a - b).map(p => p + g.y0);
}

/** Verfolgt die Kurve einer Zeile Spalte für Spalte. */
function traceRow(d, w, g, baseY, pitch, lineW) {
  const ya = Math.max(g.y0, Math.round(baseY - pitch * 1.2));
  const yb = Math.min(g.y1, Math.round(baseY + pitch * 1.2));
  const ys = new Float64Array(g.x1 - g.x0 + 1).fill(NaN);
  let prev = baseY, lost = 0, started = false;
  for (let x = g.x0; x <= g.x1; x++) {
    const runs = darkRuns(d, w, x, ya, Math.min(yb, d.length / 4 / w - 1));
    let best = null, bestDist = Infinity;
    for (const r of runs) {
      const dist = prev < r[0] ? r[0] - prev : prev > r[1] ? prev - r[1] : 0;
      if (dist < bestDist) { bestDist = dist; best = r; }
    }
    const maxJump = started ? pitch * 0.35 + lost * 2 : pitch * 0.3;
    if (!best || bestDist > maxJump) {
      lost++;
      if (started && lost > g.pxPerMm * 2) break; // Kurve zu Ende
      continue;
    }
    started = true; lost = 0;
    const len = best[1] - best[0] + 1;
    let y;
    if (len <= lineW * 1.6) y = (best[0] + best[1]) / 2;
    else {
      // senkrechter Strich: vom vorherigen Punkt zum entfernteren Ende
      const up = Math.abs(best[0] - prev), down = Math.abs(best[1] - prev);
      y = up > down ? best[0] + lineW / 2 : best[1] - lineW / 2;
    }
    ys[x - g.x0] = y;
    prev = y;
  }
  return ys;
}

/** Sucht den Eichimpuls am Zeilenanfang; liefert Spaltenindex, ab dem das EKG beginnt. */
function findCalibrationEnd(ys, baseY, pxPerMm) {
  const high = pxPerMm * 7; // Impuls ist 10 mm hoch
  const n = Math.min(ys.length, Math.round(pxPerMm * 40));
  let rise = -1, fall = -1;
  for (let i = 0; i < n; i++) {
    const v = baseY - ys[i];
    if (rise < 0 && v > high) rise = i;
    if (rise >= 0 && v < high * 0.5 && i > rise + pxPerMm) { fall = i; break; }
  }
  if (rise < 0 || fall < 0) return 0;
  return fall + (fall - rise);
}

/**
 * Digitalisiert eine Seite.
 * @returns {{rows: Float64Array[], fs: number, pxPerMm: number}} Zeilen in mV, Abtastrate in Hz
 */
export function digitizePage(data, w, h, { mmPerS = 25, mmPerMv = 10 } = {}) {
  const g = findGrid(data, w, h);
  if (!g) throw new Error('imp.noGrid');
  const bases = findRowBaselines(data, w, g);
  if (!bases.length) throw new Error('imp.noTrace');
  const pitch = bases.length > 1 ? median(bases.slice(1).map((b, i) => b - bases[i])) : g.pxPerMm * 25;

  // Strichstärke: Median der Lauflängen auf der ersten Grundlinie
  const lens = [];
  for (let x = g.x0; x <= g.x1; x += 3) for (const r of darkRuns(data, w, x, bases[0] - 6, bases[0] + 6)) lens.push(r[1] - r[0] + 1);
  const lineW = Math.max(2, median(lens) || 3);

  const rows = [];
  bases.forEach((b, ri) => {
    let ys = traceRow(data, w, g, b, pitch, lineW);
    let start = 0;
    if (ri === 0) start = findCalibrationEnd(ys, b, g.pxPerMm);
    // Ende: letzte gültige Spalte
    let end = ys.length - 1;
    while (end > start && isNaN(ys[end])) end--;
    ys = ys.slice(start, end + 1);
    // Lücken linear interpolieren
    let last = -1;
    for (let i = 0; i < ys.length; i++) {
      if (!isNaN(ys[i])) {
        if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) ys[k] = ys[last] + (ys[i] - ys[last]) * (k - last) / (i - last);
        if (last < 0) for (let k = 0; k < i; k++) ys[k] = ys[i];
        last = i;
      }
    }
    if (ys.length < g.pxPerMm * 5) return; // zu kurz (Rest/Text)
    // 3-Punkte-Median gegen Strichkanten-Zacken
    const m = ys.slice();
    for (let i = 1; i < ys.length - 1; i++) {
      const a = ys[i - 1], b = ys[i], c = ys[i + 1];
      m[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }
    ys = m;
    const base = median(Array.from(ys));
    rows.push(Float64Array.from(ys, y => (base - y) / (g.pxPerMm * mmPerMv)));
  });
  return { rows, fs: g.pxPerMm * mmPerS, pxPerMm: g.pxPerMm, grid: g, baselines: bases };
}

/** Lineare Neuabtastung auf eine Zielrate. */
export function resample(x, fsIn, fsOut) {
  const n = Math.floor((x.length - 1) * fsOut / fsIn) + 1;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * fsIn / fsOut, k = Math.floor(t), f = t - k;
    y[i] = k + 1 < x.length ? x[k] * (1 - f) + x[k + 1] * f : x[x.length - 1];
  }
  return y;
}

/** Fügt Zeilen mehrerer Seiten zu einem Signal zusammen (Übergänge auf Grundlinie angeglichen). */
export function joinRows(pages, fsOut = 250) {
  const parts = [];
  for (const p of pages) for (const r of p.rows) parts.push(resample(r, p.fs, fsOut));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { signal: out, fs: fsOut };
}
