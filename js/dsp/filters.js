// Digitale Filter (Biquad-Kaskaden, nullphasig per filtfilt) und Hilfsfunktionen.

/** Biquad-Koeffizienten [b0,b1,b2,a1,a2] (a0 = 1). */
function biquad(type, f0, fs, q) {
  const w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else if (type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; }
  a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Butterworth-Sektionen der Ordnung n (gerade). */
function butterSections(type, fc, fs, order) {
  const secs = [];
  for (let k = 0; k < order / 2; k++) {
    const q = 1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (2 * order)));
    secs.push(biquad(type, fc, fs, q));
  }
  return secs;
}

function runBiquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float64Array(x.length);
  // Startzustand: stationär auf x[0] (verringert Einschwingen)
  let x1 = x[0], x2 = x[0];
  const dc = (b0 + b1 + b2) / (1 + a1 + a2);
  let y1 = isFinite(dc) ? x[0] * dc : 0, y2 = y1;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Nullphasige Filterung mit Spiegel-Padding (wie scipy filtfilt). */
export function filtfilt(x, sections) {
  const n = x.length;
  if (n < 4) return Float64Array.from(x);
  const pad = Math.min(n - 1, 300); // ≥ 1 s bei 250 Hz – verhindert Einschwingen an den Rändern (z. B. 50-Hz-Kerbe)
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) {
    ext[i] = 2 * x[0] - x[pad - i];
    ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  ext.set(x, pad);
  let y = ext;
  for (const s of sections) y = runBiquad(y, s);
  y.reverse();
  for (const s of sections) y = runBiquad(y, s);
  y.reverse();
  return y.slice(pad, pad + n);
}

export const lowpass = (x, fc, fs, order = 4) => filtfilt(x, butterSections('lp', fc, fs, order));
export const highpass = (x, fc, fs, order = 4) => filtfilt(x, butterSections('hp', fc, fs, order));
export const bandpass = (x, lo, hi, fs, order = 4) =>
  filtfilt(x, [...butterSections('hp', lo, fs, order), ...butterSections('lp', hi, fs, order)]);
export const notch = (x, f0, fs, q = 30) => (f0 < fs / 2 ? filtfilt(x, [biquad('notch', f0, fs, q)]) : Float64Array.from(x));

/** Gleitender Median (Fenster ungerade), für Grundlinienschätzung. */
export function medfilt(x, k, edge = 'zero') {
  if (k % 2 === 0) k++;
  const h = k >> 1, n = x.length, y = new Float64Array(n);
  // sortiertes Fenster inkrementell pflegen
  const win = [];
  const ins = v => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; win[m] < v ? lo = m + 1 : hi = m; } win.splice(lo, 0, v); };
  const del = v => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; win[m] < v ? lo = m + 1 : hi = m; } win.splice(lo, 1); };
  const at = i => (i < 0 ? (edge === 'zero' ? 0 : x[0]) : i >= n ? (edge === 'zero' ? 0 : x[n - 1]) : x[i]); // 'zero' wie scipy.signal.medfilt
  for (let i = -h; i <= h; i++) ins(at(i));
  for (let i = 0; i < n; i++) {
    y[i] = win[h];
    del(at(i - h)); ins(at(i + h + 1));
  }
  return y;
}

/** Lineare Neuabtastung. */
export function resample(x, fsIn, fsOut) {
  if (fsIn === fsOut) return Float64Array.from(x);
  const n = Math.floor((x.length - 1) * fsOut / fsIn) + 1;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * fsIn / fsOut, k = Math.floor(t), f = t - k;
    y[i] = k + 1 < x.length ? x[k] * (1 - f) + x[k + 1] * f : x[x.length - 1];
  }
  return y;
}

/** Standard-Aufbereitung für Anzeige und Auswertung: 0,5–40 Hz, 50-Hz-Kerbe. */
export function cleanEcg(x, fs) {
  let y = notch(x, 50, fs);
  if (fs > 130) y = notch(y, 60, fs);
  // Grundlinie: Hochpass 0,5 Hz, 4. Ordnung, nullphasig (ein Median-Grundlinienfilter verfälscht bei hoher Herzfrequenz die PR-Strecke)
  y = highpass(y, 0.5, fs, 4);
  y = lowpass(y, 40, fs, 4);
  return y;
}

export const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
export const std = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
export function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort(), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function percentile(a, p) {
  const s = Float64Array.from(a).sort();
  const i = (s.length - 1) * p, k = Math.floor(i);
  return k + 1 < s.length ? s[k] + (s[k + 1] - s[k]) * (i - k) : s[k];
}
