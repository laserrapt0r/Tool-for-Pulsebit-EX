// Darstellung: EKG-Streifen auf Millimeterpapier (25 mm/s, 10 mm/mV), Medianschlag, RR-Verlauf.

const TYPE_COLOR = { N: null, S: '#d97706', V: '#dc2626', U: '#6b7280' };
const TYPE_LABEL = { S: 'S', V: 'V', U: '?' };

function setupCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function grid(ctx, x0, y0, w, h, mm) {
  ctx.fillStyle = '#fff7f7'; ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = 1;
  for (const [step, col] of [[1, '#fbd5d5'], [5, '#f19999']]) {
    if (step === 1 && mm < 2.2) continue; // Feinraster nur, wenn erkennbar
    ctx.strokeStyle = col; ctx.beginPath();
    for (let x = 0; x <= w + 0.5; x += mm * step) { ctx.moveTo(Math.round(x0 + x) + 0.5, y0); ctx.lineTo(Math.round(x0 + x) + 0.5, y0 + h); }
    for (let y = 0; y <= h + 0.5; y += mm * step) { ctx.moveTo(x0, Math.round(y0 + y) + 0.5); ctx.lineTo(x0 + w, Math.round(y0 + y) + 0.5); }
    ctx.stroke();
  }
}

/**
 * Zeichnet den Streifen in Zeilen. opts: { signal, fs, beats, width, gain (mm/mV), speed (mm/s), rowMv }
 */
export function drawStrip(canvas, { signal, fs, beats = [], width, gain = 10, speed = 25, rowSec, rowMv = 3.2, print = false }) {
  if (!rowSec) rowSec = width >= 1000 ? 10 : width >= 640 ? 7.5 : 5;
  const mm = width / (rowSec * speed + 6); // +6 mm für Eichzacke
  const calW = 6 * mm, rowH = rowMv * gain * mm, labelH = 14;
  const dur = signal.length / fs, rows = Math.max(1, Math.ceil((dur - 0.2) / rowSec));
  const H = rows * (rowH + labelH) + 4;
  const ctx = setupCanvas(canvas, width, H);
  ctx.clearRect(0, 0, width, H);
  for (let r = 0; r < rows; r++) {
    const y0 = r * (rowH + labelH) + labelH, mid = y0 + rowH * 0.58;
    grid(ctx, 0, y0, width, rowH, mm);
    // Eichzacke 1 mV
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(0, mid); ctx.lineTo(mm, mid); ctx.lineTo(mm, mid - gain * mm); ctx.lineTo(4 * mm, mid - gain * mm); ctx.lineTo(4 * mm, mid); ctx.lineTo(calW, mid);
    ctx.stroke();
    // Kurve
    const i0 = Math.floor(r * rowSec * fs), i1 = Math.min(signal.length, Math.floor((r + 1) * rowSec * fs));
    ctx.strokeStyle = '#111'; ctx.lineWidth = print ? 1 : 1.2; ctx.lineJoin = 'round'; ctx.beginPath();
    const pxPerSample = speed * mm / fs;
    for (let i = i0; i < i1; i++) {
      const x = calW + (i - i0) * pxPerSample, y = mid - signal[i] * gain * mm;
      i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Zeitmarke
    ctx.fillStyle = '#6b7280'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${(r * rowSec).toFixed(r * rowSec % 1 ? 1 : 0)} s`, 2, y0 + rowH - 3);
    // Schlagmarker
    for (const b of beats) {
      if (b.idx < i0 || b.idx >= i1) continue;
      const x = calW + (b.idx - i0) * pxPerSample;
      const col = TYPE_COLOR[b.type];
      if (col) {
        ctx.fillStyle = col; ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText(TYPE_LABEL[b.type], x - 4, y0 - 2);
        ctx.globalAlpha = 0.12; ctx.fillRect(x - 0.06 * fs * pxPerSample, y0, 0.12 * fs * pxPerSample, rowH); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#9ca3af'; ctx.fillRect(x - 0.5, y0 - 5, 1, 4);
      }
    }
  }
  return { mm, rows };
}

/** Medianschlag mit Messpunkten. */
export function drawTemplate(canvas, { template, intervals, width = 320, height = 220, labels = { tEnd: 'T' } }) {
  const ctx = setupCanvas(canvas, width, height);
  const { data, fs } = template, n = data.length;
  const mm = width / (n / fs * 50); // 50 mm/s für bessere Lesbarkeit
  grid(ctx, 0, 0, width, height, mm);
  const iso = intervals.iso ?? 0;
  let up = 0, down = 0;
  for (const v of data) { up = Math.max(up, v - iso); down = Math.max(down, iso - v); }
  const gain = Math.min(20 * mm, (height - 30) / Math.max(0.5, up + down)); // max. 20 mm/mV, R-Zacke passt immer
  const mid = 26 + up * gain;
  const X = i => (i / n) * width, Y = v => mid - (v - iso) * gain;
  const mark = (i, col, label, row = 0) => {
    if (i == null) return;
    ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(i), 14); ctx.lineTo(X(i), height); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.font = '10px system-ui, sans-serif'; ctx.fillText(label, X(i) + 2, 11 + row * 11);
  };
  mark(intervals.pOn, '#2563eb', 'P'); mark(intervals.qrsOn, '#059669', 'QRS', 1); mark(intervals.qrsOff, '#059669', 'J', 0);
  mark(intervals.tEnd, '#dc2626', labels.tEnd, 1);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.beginPath();
  for (let i = 0; i < n; i++) i ? ctx.lineTo(X(i), Y(data[i])) : ctx.moveTo(X(i), Y(data[i]));
  ctx.stroke();
}

/** RR-Abstände über die Zeit (Tachogramm). */
export function drawRR(canvas, { beats, duration, width = 320, height = 140 }) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  const pts = beats.filter(b => b.rrPrev != null);
  if (!pts.length) return;
  const lo = 0.3, hi = Math.max(1.6, ...pts.map(b => b.rrPrev)) + 0.1;
  const L = 34, B = height - 18;
  const X = t => L + (t / duration) * (width - L - 6), Y = v => B - ((v - lo) / (hi - lo)) * (B - 6);
  ctx.strokeStyle = '#e5e7eb'; ctx.fillStyle = '#6b7280'; ctx.font = '10px system-ui, sans-serif';
  for (let v = 0.4; v < hi; v += 0.4) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(width, Y(v)); ctx.stroke(); ctx.fillText(`${Math.round(v * 1000)}`, 2, Y(v) + 3); }
  for (let t = 0; t <= duration; t += 10) ctx.fillText(`${t} s`, X(t) - 6, height - 4);
  ctx.strokeStyle = '#9ca3af'; ctx.beginPath();
  pts.forEach((b, i) => (i ? ctx.lineTo(X(b.t), Y(b.rrPrev)) : ctx.moveTo(X(b.t), Y(b.rrPrev))));
  ctx.stroke();
  for (const b of pts) {
    ctx.fillStyle = TYPE_COLOR[b.type] || '#111';
    ctx.beginPath(); ctx.arc(X(b.t), Y(b.rrPrev), b.type === 'N' ? 2.5 : 4, 0, Math.PI * 2); ctx.fill();
  }
}
