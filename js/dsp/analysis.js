// Klassische EKG-Auswertung eines 1-Kanal-Streifens (ohne KI).
// R-Zacken-Erkennung angelehnt an NeuroKit2 ("neurokit"-Methode, MIT-Lizenz),
// Vermessung am Medianschlag, regelbasierte Schlag- und Rhythmusklassifikation.

import { cleanEcg, resample, median, mean, std, percentile } from './filters.js';

export const FS = 250; // interne Auswertungsrate

function movingAvg(x, k) {
  k = Math.max(1, Math.round(k));
  const y = new Float64Array(x.length), h = k >> 1;
  let s = 0, n = 0;
  for (let i = -h; i < x.length + h; i++) {
    const add = i + h, rem = i - h - 1;
    if (add < x.length && add >= 0) { s += x[add]; n++; }
    if (rem >= 0) { s -= x[rem]; n--; }
    if (i >= 0 && i < x.length) y[i] = s / n;
  }
  return y;
}

/** R-Zacken-Erkennung. Liefert Indizes und Polarität (+1 / -1). */
export function detectRPeaks(x, fs) {
  const grad = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) grad[i] = Math.abs(x[i] - x[i - 1]);
  const sg = movingAvg(grad, 0.1 * fs);
  const ag = movingAvg(grad, 0.75 * fs);
  const segs = [];
  let s = -1;
  for (let i = 0; i < x.length; i++) {
    const on = sg[i] > 1.5 * ag[i];
    if (on && s < 0) s = i;
    if (!on && s >= 0) { segs.push([s, i]); s = -1; }
  }
  if (s >= 0) segs.push([s, x.length - 1]);
  if (!segs.length) return { peaks: [], polarity: 1 };
  const avgLen = mean(segs.map(([a, b]) => b - a));
  const qrs = segs.filter(([a, b]) => b - a >= 0.4 * avgLen);

  // Polarität: dominante Auslenkung der QRS-Komplexe
  const maxs = [], mins = [];
  for (const [a, b] of qrs) {
    let mx = -Infinity, mn = Infinity;
    for (let i = a; i <= b; i++) { if (x[i] > mx) mx = x[i]; if (x[i] < mn) mn = x[i]; }
    maxs.push(mx); mins.push(-mn);
  }
  const polarity = median(mins) > 1.4 * median(maxs) ? -1 : 1;

  let peaks = qrs.map(([a, b]) => {
    let bi = a;
    for (let i = a; i <= b; i++) if (polarity * x[i] > polarity * x[bi]) bi = i;
    return bi;
  });
  // Refraktärzeit 250 ms: größeren Ausschlag behalten
  const out = [];
  for (const p of peaks) {
    const last = out[out.length - 1];
    if (last !== undefined && p - last < 0.25 * fs) {
      if (polarity * x[p] > polarity * x[last]) out[out.length - 1] = p;
    } else out.push(p);
  }
  // Ausreißer mit sehr kleiner Amplitude verwerfen (Artefakte/T-Wellen)
  const amps = out.map(p => polarity * x[p]);
  const mAmp = median(amps);
  peaks = out.filter((p, i) => amps[i] > 0.3 * mAmp);
  return { peaks, polarity };
}

function segment(x, c, a, b) {
  const out = new Float64Array(b - a);
  for (let i = a; i < b; i++) out[i - a] = x[Math.min(x.length - 1, Math.max(0, c + i))];
  return out;
}

function corr(a, b) {
  const ma = mean(a), mb = mean(b);
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { const u = a[i] - ma, v = b[i] - mb; s += u * v; sa += u * u; sb += v * v; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
}

/** QRS-Beginn/-Ende über die Steigung relativ zum Maximum (Indizes relativ zum Fenster). */
function qrsBounds(w, r, fs, isoLevel) {
  const d = new Float64Array(w.length);
  for (let i = 1; i < w.length - 1; i++) d[i] = Math.abs(w[i + 1] - w[i - 1]) / 2;
  const ds = movingAvg(d, 0.012 * fs);
  let mx = 0;
  for (let i = Math.max(0, r - 0.06 * fs); i < Math.min(w.length, r + 0.06 * fs); i++) mx = Math.max(mx, ds[Math.round(i)]);
  const thr = 0.07 * mx, hold = Math.round(0.01 * fs);
  let on = Math.round(r - 0.15 * fs);
  for (let i = r; i > r - 0.15 * fs && i > hold; i--) {
    let quiet = true;
    for (let k = 0; k < hold; k++) if (ds[i - k] > thr) quiet = false;
    if (quiet) { on = i; break; }
  }
  // Ende: nach R zuerst den steilen Abschnitt (inkl. S-Zacke) verlassen
  let off = Math.round(r + 0.18 * fs);
  for (let i = r + Math.round(0.02 * fs); i < r + 0.22 * fs && i < w.length - hold; i++) {
    let quiet = true;
    for (let k = 0; k < hold; k++) if (ds[i + k] > thr * 1.3) quiet = false;
    if (quiet && Math.abs(w[i] - isoLevel(i)) < 0.25 * Math.abs(w[r] - isoLevel(r))) { off = i; break; }
  }
  return { on, off };
}

/** Vermessung des Medianschlags. */
function delineate(tpl, r, fs, rrMean, polarity) {
  const n = tpl.length;
  // vorläufige isoelektrische Linie: Median im Bereich 60–100 ms vor R
  const preIso = median(Array.from(tpl.slice(Math.max(0, r - Math.round(0.1 * fs)), r - Math.round(0.06 * fs))));
  const q = qrsBounds(tpl, r, fs, () => preIso);
  // Isoelektrische Linie: kurzes Stück direkt vor QRS-Beginn (PR-Strecke)
  const iso = median(Array.from(tpl.slice(Math.max(0, q.on - Math.round(0.02 * fs)), q.on + 1)));
  const rAmp = (tpl[r] - iso);

  // P-Welle: Suche 20–400 ms vor QRS-Beginn, frühestens nach der T-Welle des Vorschlags.
  // Kriterium ist die Prominenz (Höhe über dem höheren der beiden Täler links/rechts) – robust auf T-Ausläufern.
  const prevTEnd = r - Math.round((rrMean - 0.33 * Math.sqrt(rrMean) - 0.06) * fs);
  const pA = Math.max(1, q.on - Math.round(0.40 * fs), Math.min(prevTEnd, q.on - Math.round(0.12 * fs))), pB = q.on - Math.round(0.02 * fs);
  let noise = 0;
  for (let i = pA + 1; i < pB; i++) noise += Math.abs(tpl[i] - tpl[i - 1]);
  noise /= Math.max(1, pB - pA - 1);
  const W = Math.round(0.10 * fs);
  let pPeak = -1, prom = 0, sg = 1, base = iso;
  for (const sgn of [1, -1]) {
    for (let i = pA + 1; i < pB - 1; i++) {
      const v = sgn * tpl[i];
      if (v < sgn * tpl[i - 1] || v < sgn * tpl[i + 1]) continue; // nur lokale Extrema
      let lMin = Infinity, rMin = Infinity;
      for (let k = Math.max(0, i - W); k <= i; k++) lMin = Math.min(lMin, sgn * tpl[k]);
      for (let k = i; k <= Math.min(q.on, i + W); k++) rMin = Math.min(rMin, sgn * tpl[k]);
      const pr = v - Math.max(lMin, rMin) - (sgn < 0 ? 0.005 : 0); // Prominenz; positive P leicht bevorzugt
      if (pr > prom) { prom = pr; pPeak = i; sg = sgn; base = sgn * Math.max(lMin, rMin); }
    }
  }
  const pAmp = pPeak > 0 ? tpl[pPeak] - iso : 0;
  const pPresent = pPeak > 0 && prom > Math.max(0.025, 0.03 * Math.abs(rAmp)) && prom > 5 * noise;
  let pOn = null, pOff = null;
  if (pPresent) {
    const lim = 0.2 * prom;
    pOn = pPeak;
    while (pOn > Math.max(1, pPeak - Math.round(0.12 * fs)) && sg * (tpl[pOn] - base) > lim && !(sg * (tpl[pOn - 1] - tpl[pOn]) > 0.002 && pPeak - pOn > 0.02 * fs)) pOn--;
    pOff = pPeak;
    while (pOff < Math.min(q.on - 1, pPeak + Math.round(0.12 * fs)) && sg * (tpl[pOff] - base) > lim && !(sg * (tpl[pOff + 1] - tpl[pOff]) > 0.002 && pOff - pPeak > 0.02 * fs)) pOff++;
  }

  // T-Welle: nach QRS-Ende bis min(R + 0.62·RR, R + 600 ms)
  const tA = q.off + Math.round(0.06 * fs), tB = Math.min(n - 2, r + Math.round(Math.min(0.62 * rrMean, 0.6) * fs));
  let tPeak = -1, tAmp = 0;
  for (let i = tA; i < tB; i++) if (Math.abs(tpl[i] - iso) > Math.abs(tAmp)) { tAmp = tpl[i] - iso; tPeak = i; }
  let tEnd = null;
  if (tPeak > 0 && Math.abs(tAmp) > 0.03) {
    // Tangentenmethode: steilste Stelle des absteigenden T-Schenkels, Schnitt mit isoelektrischer Linie
    let best = tPeak, slope = 0;
    for (let i = tPeak + 1; i < Math.min(n - 1, tPeak + 0.15 * fs); i++) {
      const s = (tpl[i + 1] - tpl[i - 1]) / 2;
      if (Math.sign(-s) === Math.sign(tAmp) && Math.abs(s) > Math.abs(slope)) { slope = s; best = i; }
    }
    if (slope !== 0) {
      const xi = best + (iso - tpl[best]) / slope;
      if (xi > tPeak && xi < n) tEnd = xi;
    }
  }
  // ST-Strecke: J-Punkt + 60 ms
  const st = q.off + Math.round(0.06 * fs) < n ? tpl[q.off + Math.round(0.06 * fs)] - iso : null;

  const ms = v => (v == null ? null : Math.round(v * 1000 / fs));
  const qt = tEnd != null ? ms(tEnd - q.on) : null;
  return {
    iso, rAmp, qrsOn: q.on, qrsOff: q.off, pOn, pOff, pPeak: pPresent ? pPeak : null, pAmp: pPresent ? pAmp : 0, pProm: pPresent ? sg * prom : 0, pPresent,
    tPeak: tPeak > 0 ? tPeak : null, tAmp, tEnd,
    pr: pPresent ? ms(q.on - pOn) : null,
    pDur: pPresent ? ms(pOff - pOn) : null,
    qrs: ms(q.off - q.on),
    qt,
    qtcB: qt != null ? Math.round(qt / Math.sqrt(rrMean)) : null,
    qtcF: qt != null ? Math.round(qt / Math.cbrt(rrMean)) : null,
    st, polarity,
  };
}

/** HRV-Kennzahlen aus NN-Intervallen (Sekunden). */
export function hrv(rr) {
  if (rr.length < 3) return null;
  const d = rr.slice(1).map((v, i) => v - rr[i]);
  const rmssd = Math.sqrt(mean(d.map(v => v * v)));
  // Wendepunktverhältnis (Turning Point Ratio)
  let tp = 0;
  for (let i = 1; i < rr.length - 1; i++) if ((rr[i] - rr[i - 1]) * (rr[i + 1] - rr[i]) < 0) tp++;
  // Shannon-Entropie der RR-Verteilung (16 Klassen, nach Dash et al. 2009)
  const s = [...rr].sort((a, b) => a - b).slice(1, -1);
  let ent = 0;
  if (s.length > 4) {
    const lo = s[0], hi = s[s.length - 1], bins = new Array(16).fill(0);
    for (const v of s) bins[Math.min(15, Math.floor((v - lo) / ((hi - lo) || 1) * 16))]++;
    for (const b of bins) if (b) { const p = b / s.length; ent -= p * Math.log(p) / Math.log(16); }
  }
  return {
    meanRR: mean(rr), sdnn: std(rr), rmssd, nrmssd: rmssd / mean(rr), cov: std(rr) / mean(rr),
    pnn50: d.filter(v => Math.abs(v) > 0.05).length / d.length,
    tpr: tp / Math.max(1, rr.length - 2), entropy: ent,
    minRR: Math.min(...rr), maxRR: Math.max(...rr),
  };
}

/** Bereiche ohne Signal (Elektrodenkontakt verloren): gleitende Streuung ≈ 0 über ≥ 0,8 s. */
function findGaps(x, fs) {
  const w = Math.round(0.4 * fs), gaps = [];
  let start = -1;
  for (let i = 0; i + w <= x.length; i += Math.round(w / 4)) {
    let m = 0, m2 = 0;
    for (let k = i; k < i + w; k++) { m += x[k]; m2 += x[k] * x[k]; }
    m /= w; const sd = Math.sqrt(Math.max(0, m2 / w - m * m));
    if (sd < 0.004) { if (start < 0) start = i; }
    else if (start >= 0) { if ((i + w * 0.75 - start) / fs >= 0.8) gaps.push([start / fs, (i + w * 0.75) / fs]); start = -1; }
  }
  if (start >= 0 && (x.length - start) / fs >= 0.8) gaps.push([start / fs, x.length / fs]);
  return gaps;
}

/** Ersetzt NaN/Infinity durch lineare Interpolation; gibt den Anteil ungültiger Werte zurück. */
function repairNonFinite(x) {
  let bad = 0, last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) {
      if (i - last > 1) for (let k = last + 1; k < i; k++) x[k] = last < 0 ? x[i] : x[last] + (x[i] - x[last]) * (k - last) / (i - last);
      last = i;
    } else bad++;
  }
  if (last < x.length - 1) for (let k = last + 1; k < x.length; k++) x[k] = last >= 0 ? x[last] : 0;
  return bad / Math.max(1, x.length);
}

/**
 * Vollständige Analyse.
 * @param {ArrayLike<number>} raw Signal in mV
 * @param {number} fsIn Abtastrate
 */
export function analyze(raw, fsIn) {
  const fs = FS;
  const fail = (k, extra = {}) => ({ fs, duration: (raw?.length || 0) / (fsIn || fs), signal: new Float64Array(0), beats: [], rr: [], polarity: 1,
    quality: { score: 0, label: 'none', reasons: [{ k }] }, ...extra });
  if (!Number.isFinite(fsIn) || fsIn < 50 || fsIn > 4000) return fail('q.r.fewBeats');
  if (!raw || raw.length < 3 * fsIn) return fail('q.r.fewBeats');
  const inp = Float64Array.from(raw);
  const badFrac = repairNonFinite(inp);
  const x0 = resample(inp, fsIn, fs);
  const gaps = findGaps(x0, fs);
  const x = cleanEcg(x0, fs);
  const duration = x.length / fs;
  const res = { fs, duration, signal: x, beats: [], issues: [], gaps };

  let { peaks, polarity } = detectRPeaks(x, fs);
  res.polarity = polarity;
  // keine Schläge in Signallücken
  peaks = peaks.filter(p => !gaps.some(([a, b]) => p / fs >= a && p / fs <= b));

  const pre = Math.round(0.45 * fs); // Fenster vor R: Platz für lange PR-Zeiten
  const qrsWin = s => s.slice(pre - Math.round(0.07 * fs), pre + Math.round(0.07 * fs));
  const baseAt = s => median(Array.from(s.slice(pre - Math.round(0.1 * fs), pre - Math.round(0.06 * fs))));
  const medTpl = (list, len) => { const t = new Float64Array(len); for (let i = 0; i < len; i++) t[i] = median(list.map(s => s[i])); return t; };

  // ---- Scheinschläge entfernen (T-Wellen, Störspitzen): klein, untypisch und zu nah am Nachbarn ----
  let removed = 0;
  for (let iter = 0; iter < 3 && peaks.length >= 4; iter++) {
    const segs0 = peaks.map(p => segment(x, p, -pre, Math.round(0.4 * fs)));
    const amps = segs0.map(s => polarity * (s[pre] - baseAt(s)));
    const top = [...amps].sort((a, b) => b - a)[Math.floor(amps.length * 0.25)] || amps[0];
    const strongIdx = amps.map((v, i) => (v >= 0.5 * top ? i : -1)).filter(i => i >= 0);
    const tpl0 = medTpl(strongIdx.map(i => segs0[i]), segs0[0].length);
    const c0 = segs0.map(s => corr(qrsWin(s), qrsWin(tpl0)));
    const strong = peaks.map((_, i) => amps[i] >= 0.6 * top && c0[i] >= 0.6);
    const sp = peaks.filter((_, i) => strong[i]);
    const trueRR = sp.length >= 3 ? median(sp.slice(1).map((p, i) => (p - sp[i]) / fs)) : median(peaks.slice(1).map((p, i) => (p - peaks[i]) / fs));
    const drop = peaks.map((p, i) => {
      if (strong[i]) return false;
      const dPrev = i > 0 ? (p - peaks[i - 1]) / fs : Infinity, dNext = i < peaks.length - 1 ? (peaks[i + 1] - p) / fs : Infinity;
      return Math.min(dPrev, dNext) < 0.6 * trueRR || (c0[i] < 0.3 && amps[i] < 0.4 * top);
    });
    if (!drop.some(Boolean)) break;
    removed += drop.filter(Boolean).length;
    peaks = peaks.filter((_, i) => !drop[i]);
  }
  if (peaks.length < 3) {
    res.quality = { score: 0, label: 'none', reasons: [{ k: 'q.r.fewBeats' }] };
    res.rr = [];
    return res;
  }
  const rr = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs);
  const rrMed = median(rr);
  // lokale Referenz: Median der bis zu 8 benachbarten Intervalle (ohne das eigene)
  const localRef = i => { const nb = []; for (let k = Math.max(0, i - 4); k <= Math.min(rr.length - 1, i + 4); k++) if (k !== i) nb.push(rr[k]); return nb.length ? median(nb) : rrMed; };

  // Medianschlag (−300 ms … +min(RR, 650 ms)) aus nicht vorzeitigen, typischen Schlägen
  const post = Math.round(Math.min(0.65, Math.max(0.4, rrMed * 0.85)) * fs);
  const segs = peaks.map(p => segment(x, p, -pre, post));
  const notEarly = peaks.map((_, i) => i === 0 || rr[i - 1] >= 0.88 * localRef(i - 1));
  let tpl = medTpl(segs.filter((_, i) => notEarly[i]).length >= 3 ? segs.filter((_, i) => notEarly[i]) : segs, pre + post);
  const corrs = segs.map(s => corr(qrsWin(s), qrsWin(tpl)));
  const good = segs.filter((_, i) => corrs[i] > 0.9 && notEarly[i]);
  if (good.length >= 3) tpl = medTpl(good, pre + post);
  const corrs2 = segs.map(s => corr(qrsWin(s), qrsWin(tpl)));

  const tplQ = qrsBounds(tpl, pre, fs, () => baseAt(tpl));
  const tplW = (tplQ.off - tplQ.on) / fs;
  const tplAmp = tpl[pre] - baseAt(tpl);
  const edgeT = 0.35;
  const beats = peaks.map((p, i) => {
    const s = segs[i];
    const iso = baseAt(s);
    const b = qrsBounds(s, pre, fs, () => iso);
    return {
      idx: p, t: p / fs, rrPrev: i > 0 ? rr[i - 1] : null, rrNext: i < rr.length ? rr[i] : null,
      corr: corrs2[i], width: (b.off - b.on) / fs, amp: s[pre] - iso, type: 'N',
      edge: p / fs < edgeT || p / fs > duration - edgeT, ref: i > 0 ? localRef(i - 1) : rrMed,
    };
  });

  // ---- Schlagklassifikation ----
  const nnLike = rr.filter((v, i) => v >= 0.88 * localRef(i));
  const rrNormal = nnLike.length >= 3 ? median(nnLike) : mean(rr);
  for (const [i, b] of beats.entries()) {
    if (b.edge) continue; // Randschläge sind nicht beurteilbar
    const premature = b.rrPrev != null && b.rrPrev < 0.82 * b.ref;
    const prevRR = i > 1 ? beats[i - 1].rrPrev : null;
    const abrupt = prevRR == null || b.rrPrev < 0.85 * prevRR;          // plötzlich (nicht allmählich wie bei Sinusarrhythmie)
    const nextPremature = i + 1 < beats.length && beats[i + 1].rrPrev < 0.82 * beats[i + 1].ref;
    const pauseAfter = b.rrNext == null || nextPremature || (b.rrNext >= 0.9 * b.ref && b.rrNext >= 1.1 * b.rrPrev);
    const compensatory = premature && b.rrNext != null && b.rrPrev + b.rrNext >= 1.85 * rrNormal;
    const wide = b.width >= 0.12 && b.width > tplW + 0.04;
    const ampOdd = Math.abs(tplAmp) > 0 && (b.amp / tplAmp < 0.35 || b.amp / tplAmp > 2.5);
    const veryDifferent = b.corr < 0.7 || (b.corr < 0.8 && ampOdd) || (wide && b.corr < 0.85);
    // VES: deutlich andere Form, vorzeitig, mit Pause danach (oder Teil einer Salve)
    if (veryDifferent && premature && (pauseAfter || compensatory)) b.type = 'V';
    else if (b.corr < 0.5) b.type = 'U';             // unklar/Artefakt
    else if (premature && abrupt && pauseAfter && b.corr >= 0.8) b.type = 'S';
    b.premature = premature;
    b.compensatory = compensatory;
  }
  res.beats = beats;

  // NN-Intervalle: nur zwischen zwei normalen Schlägen
  const nn = [];
  for (let i = 1; i < beats.length; i++) if (beats[i].type === 'N' && beats[i - 1].type === 'N') nn.push(beats[i].rrPrev);
  res.hrvAll = hrv(rr);
  res.hrv = nn.length >= 5 ? hrv(nn) : res.hrvAll;
  // Herzfrequenz ohne Lückenzeit
  const gapRR = rr.filter((v, i) => !gaps.some(([a, b2]) => beats[i].t < b2 && beats[i + 1].t > a));
  res.hr = Math.round(60 / mean(gapRR.length ? gapRR : rr));
  res.hrNN = nn.length >= 3 ? Math.round(60 / mean(nn)) : res.hr;
  res.peaks = peaks;
  res.rr = rr;

  // Vorlage für die Vermessung nur aus Normalschlägen mit typischer Form
  const nSegs = segs.filter((_, i) => beats[i].type === 'N' && corrs2[i] > 0.9);
  if (nSegs.length >= 3) tpl = medTpl(nSegs, pre + post);
  res.template = { data: tpl, r: pre, fs, beatsUsed: nSegs.length || segs.length };
  res.intervals = delineate(tpl, pre, fs, nn.length >= 3 ? mean(nn) : rrNormal, polarity);

  // P-Wellen-Anteil je Normalschlag (für die Vorhofflimmern-Bewertung)
  if (res.intervals.pPeak != null) {
    const off = res.intervals.pPeak - pre, ref = res.intervals.pProm, w = Math.round(0.03 * fs), W = Math.round(0.1 * fs);
    const nIdx = beats.map((b, i) => (b.type === 'N' ? i : -1)).filter(i => i >= 0);
    const use = nIdx.length >= 3 ? nIdx.map(i => segs[i]) : segs;
    let present = 0;
    for (const s of use) {
      const sg = Math.sign(ref);
      let best = -Infinity;
      for (let k = -w; k <= w; k++) {
        const c = pre + off + k;
        let lMin = Infinity, rMin = Infinity;
        for (let j = c - W; j <= c; j++) lMin = Math.min(lMin, sg * (s[j] ?? 0));
        for (let j = c; j <= Math.min(pre - 5, c + W); j++) rMin = Math.min(rMin, sg * (s[j] ?? 0));
        best = Math.max(best, sg * s[c] - Math.max(lMin, rMin));
      }
      if (best > 0.4 * Math.abs(ref)) present++;
    }
    res.pRatio = present / use.length;
  } else res.pRatio = 0;

  res.quality = assessQuality(x, fs, beats, corrs2, peaks, { gaps, badFrac, duration, removed });
  return res;
}

/** Signalqualität 0–100 mit Begründungen. */
function assessQuality(x, fs, beats, corrs, peaks, { gaps = [], badFrac = 0, duration = 0, removed = 0 } = {}) {
  const reasons = [];
  let score = 100;
  const gapSec = gaps.reduce((s, [a, b]) => s + b - a, 0);
  if (gapSec > 0) { score -= Math.min(60, gapSec / Math.max(1, duration) * 200); reasons.push({ k: 'q.r.gap', s: Math.round(gapSec * 10) / 10 }); }
  // verworfene Störspitzen/Scheinschläge sind ein direktes Maß für Störungen
  const remFrac = removed / Math.max(1, peaks.length);
  if (remFrac > 0.05) { score -= Math.min(50, remFrac * 150); reasons.push({ k: 'q.r.noise' }); }
  if (badFrac > 0.001) { score -= Math.min(40, badFrac * 400); reasons.push({ k: 'q.r.invalid' }); }
  const mc = mean(corrs);
  if (mc < 0.9) { score -= (0.9 - mc) * 150; reasons.push({ k: 'q.r.shape' }); }
  // Hochfrequentes Rauschen: Restsignal nach 15-Hz-Glättung außerhalb der QRS-Komplexe
  const mask = new Uint8Array(x.length);
  for (const p of peaks) for (let i = Math.max(0, p - 0.08 * fs); i < Math.min(x.length, p + 0.08 * fs); i++) mask[Math.round(i)] = 1;
  const sm = movingAvg(x, fs / 15);
  const resid = [];
  for (let i = 0; i < x.length; i++) if (!mask[i]) resid.push(Math.abs(x[i] - sm[i]));
  const noise = median(resid);
  const ramp = median(peaks.map(p => Math.abs(x[p])));
  if (ramp > 6) { score -= 30; reasons.push({ k: 'q.r.highAmp' }); }
  const snr = ramp / (noise || 1e-6);
  if (snr < 40) { score -= Math.min(45, (40 - snr) * 1.6); reasons.push({ k: 'q.r.noise' }); }
  // Grundlinienschwankung
  const base = movingAvg(x, fs * 0.6);
  const wander = percentile(Array.from(base), 0.98) - percentile(Array.from(base), 0.02);
  if (wander > 0.6 * ramp) { score -= 20; reasons.push({ k: 'q.r.wander' }); }
  if (ramp < 0.15) { score -= 20; reasons.push({ k: 'q.r.lowAmp' }); }
  const unclear = beats.filter(b => b.type === 'U').length;
  if (unclear) { score -= unclear * 5; reasons.push({ k: 'q.r.unclear', n: unclear }); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'limited' : 'poor';
  return { score, label, reasons, snr: Math.round(snr), meanCorr: mc };
}
