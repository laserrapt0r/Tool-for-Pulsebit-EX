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
  // Ausreißer mit sehr kleinem Ausschlag verwerfen – gemessen als Spitze-Spitze-Höhe (auch nach unten gerichtete VES zählen)
  const w = Math.round(0.06 * fs);
  const amps = out.map(p => { if (!DET_OPT.p2pFilter) return polarity * x[p]; let mx = -Infinity, mn = Infinity; for (let k = Math.max(0, p - w); k <= Math.min(x.length - 1, p + w); k++) { mx = Math.max(mx, x[k]); mn = Math.min(mn, x[k]); } return mx - mn; });
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
// Schalter für Validierungsexperimente. Gewählt nach MIT-BIH (DS1) und CinC-2017-Normal-EKGs:
// protectQrsLike/lateV erhöhen die VES-Erkennung bei Holter-EKGs, verursachen bei Handgerät-Aufnahmen aber viele Fehlalarme.
export const P_OPT = { onsetFrac: 0.1, leftCut: true, tEndMargin: 0.06, minProm: 0.012, useMeasuredT: true, subtractT: true };
export const T_OPT = { maxFrac: 0.55, subGapMs: 160 }; // T-Gipfel spätestens bei maxFrac·RR; T-Subtraktion nur, wenn die T-Welle des Vorschlags näher als subGapMs an den QRS-Beginn reicht
export const RR_OPT = { qtcFromPrecedingRR: true, madOutlier: true, madK: 2.5 }; // madK an MIT-BIH DS1 gewählt // P-Beginn/-Ende: Anteil der Prominenz (an LUDB geprüft)
export const DET_OPT = { protectQrsLike: false, p2pFilter: true, lateV: false, searchBack: true, svesIqr: 1.5 };
export const QRS_OPT = { k: 0.05, kOn: 0.05, iso: 0.25, holdMs: 10, lookMs: 0, lookFactor: 2.5, ampFrac: 0.15, advanceOn: false, moveOff: 0.08, floor: 0, floorOff: 0, humpFix: true, crossFix: true, robustOnsetIso: true, robustIso: false, offsetFromPR: true, tpMaxDev: 0.15 }; // floor: Mindestschwelle der Steigung in (1/s)·R-Amplitude – nötig bei stark tiefpassgefilterten Geräten (Pulsebit: < 25 Hz) // advanceOn verschlechtert QRS/QT an LUDB (überspringt kleine Q-Zacken)
/**
 * QRS-Beginn und -Ende am (Median-)Schlag. Kriterium: Steigung klein über 'holdMs' UND (optional) davor/danach
 * 'lookMs' lang keine steile Stelle UND Amplitude nahe der Grundlinie – damit weder der P-Gipfel (Steigung kurz null)
 * noch das S-Tal als Grenze gewählt wird.
 */
function qrsBounds(w, r, fs, isoLevel) {
  const d = new Float64Array(w.length);
  for (let i = 1; i < w.length - 1; i++) d[i] = Math.abs(w[i + 1] - w[i - 1]) / 2;
  const ds = movingAvg(d, 0.012 * fs);
  let mx = 0;
  for (let i = Math.max(0, r - 0.06 * fs); i < Math.min(w.length, r + 0.06 * fs); i++) mx = Math.max(mx, ds[Math.round(i)]);
  const rAmp = Math.abs(w[r] - isoLevel(r));
  // ds ist mV je Abtastschritt; Untergrenze floor·R [mV/s] → je Abtastschritt: floor·R/fs
  const flo = QRS_OPT.floor * rAmp / fs;
  const thrOff = Math.max(QRS_OPT.k * mx, (QRS_OPT.floorOff ?? QRS_OPT.floor) * rAmp / fs), thrOn = Math.max((QRS_OPT.kOn ?? QRS_OPT.k) * mx, flo);
  const hold = Math.max(2, Math.round(QRS_OPT.holdMs / 1000 * fs)), look = Math.round(QRS_OPT.lookMs / 1000 * fs);
  const maxIn = (a, b) => { let m = 0; for (let k = Math.max(0, a); k < Math.min(w.length, b); k++) m = Math.max(m, ds[k]); return m; };
  const nearBase = i => Math.abs(w[i] - isoLevel(i)) < Math.max(QRS_OPT.ampFrac * rAmp, 0.03);
  // Beginn: rückwärts ab R
  let on = -1;
  for (let i = r; i > r - 0.15 * fs && i > hold; i--) {
    if (maxIn(i - hold + 1, i + 1) > thrOn) continue;
    if (look && maxIn(i - hold - look, i - hold + 1) > QRS_OPT.lookFactor * thrOn) continue;
    if (look && !nearBase(i)) continue;
    on = i; break;
  }
  if (on < 0) on = Math.round(r - 0.15 * fs);
  // Liegt der Beginn deutlich über der Grundlinie (auf der P-Welle, die ohne PR-Strecke in die Q-Zacke übergeht),
  // ist der QRS-Beginn die Stelle, an der die Kurve auf dem Weg in die Q-Zacke die Grundlinie kreuzt.
  let crossed = false;
  if (QRS_OPT.crossFix && w[on] - isoLevel(on) > Math.max(0.03 * rAmp, 0.025)) {
    for (let j = on; j < r - Math.round(0.012 * fs); j++) {
      if (w[j] - isoLevel(j) <= 0 && w[j + 1] <= w[j]) { on = j; crossed = true; break; }
      if (ds[j] > 0.3 * mx) break; // schon im R-Anstieg: keine Kreuzung gefunden
    }
  }
  // Landet der Beginn auf einem Gipfel/Tal (P-Welle, die ohne PR-Strecke in die Q-Zacke übergeht – z. B. durch den
  // Hochpass-Unterschwinger mancher Geräte), ist das kein QRS-Beginn: vorwärts bis zum Knick suchen, an dem die
  // Steigung sprunghaft zunimmt (Übergang P-Schräge → Q-Zacke). Bei flacher PR-Strecke greift die Regel nie.
  if (QRS_OPT.humpFix && !crossed) {
    const e = Math.round(0.04 * fs), delta = 0.02;
    const a = on - e >= 0 ? w[on - e] : w[on], b = Math.min(w.length - 1, on + e) < r ? w[on + e] : w[on];
    // nur positive Gipfel (P-Welle); ein „Tal“ ist am echten QRS-Beginn normal (40 ms später liegt bereits der R-Anstieg)
    const isPeak = w[on] > a + delta && w[on] > b + delta;
    if (isPeak) {
      // mittlere Steigung der Schräge direkt nach dem Gipfel als Bezug
      let ref = 0, n0 = 0;
      for (let j = on + e; j < Math.min(r, on + Math.round(0.05 * fs)); j++) { ref += ds[j]; n0++; }
      ref = n0 ? ref / n0 : thrOn;
      let j = on + e;
      while (j < r - Math.round(0.015 * fs) && ds[j] < Math.max(2 * ref, 2.5 * thrOn)) j++;
      // auf den Beginn des Anstiegs zurück (bis die Steigung wieder unter 1,3·ref fällt)
      while (j > on + e && ds[j - 1] >= Math.max(1.3 * ref, thrOn)) j--;
      if (QRS_OPT.humpLog) QRS_OPT.humpLog.push({ on0: on, on1: j, r, peak: +(w[on] - a).toFixed(3), shift: Math.round((j - on) / fs * 1000) });
      on = j;
    }
  }
  // Über flache, grundliniennahe Abschnitte (kleine Hügel/Kerben) bis zum letzten Punkt vor der QRS-Auslenkung vorrücken
  if (QRS_OPT.advanceOn) {
    const lim = Math.max(0.1 * rAmp, 0.03);
    let j = on;
    while (j + 1 < r - Math.round(0.02 * fs) && Math.abs(w[j + 1] - isoLevel(j + 1)) < lim && ds[j + 1] < 2 * thrOn) j++;
    on = j;
  }
  // Bezugspegel für das Ende: PR-Strecke direkt vor dem gefundenen Beginn. Die (robuste) Beginn-Grundlinie kann bei hoher
  // Herzfrequenz auf der T-Welle des Vorschlags liegen – dann würde das Ende erst an der nächsten T-Welle gefunden.
  const isoOff = QRS_OPT.offsetFromPR ? median(Array.from(w.slice(Math.max(0, on - Math.round(0.02 * fs)), on + 1))) : isoLevel(r);
  const rAmpOff = Math.max(Math.abs(w[r] - isoOff), 0.05);
  // Ende: vorwärts ab R + 20 ms (S-Zacke überspringen)
  let off = -1;
  for (let i = r + Math.round(0.02 * fs); i < r + 0.22 * fs && i < w.length - hold; i++) {
    if (maxIn(i, i + hold) > thrOff * 1.3) continue;
    if (!(Math.abs(w[i] - isoOff) < QRS_OPT.iso * rAmpOff)) continue;
    if (look && maxIn(i + hold, i + hold + look) > QRS_OPT.lookFactor * thrOff) continue;
    // kein S-Tal: in den folgenden 20 ms darf sich das Signal nicht mehr deutlich bewegen (langsamer Rückgang der S-Zacke)
    if (QRS_OPT.moveOff) { const j = Math.min(w.length - 1, i + Math.round(0.02 * fs)); if (Math.abs(w[j] - w[i]) > QRS_OPT.moveOff * rAmpOff) continue; }
    off = i; break;
  }
  if (off < 0) {
    // nie ruhig: Ende des letzten steilen Abschnitts
    off = Math.round(r + 0.06 * fs);
    for (let j = Math.min(w.length - 1, Math.round(r + 0.18 * fs)); j > r; j--) if (ds[j] > 3 * thrOff) { off = j + hold; break; }
  }
  return { on, off };
}

/**
 * T-Welle als Gauß-Kurve modellieren: Lage und Höhe aus dem gemessenen T-Gipfel, Breite aus dem aufsteigenden Schenkel
 * (Halbwertspunkt), den die P-Welle des Folgeschlags nicht beeinflusst. Der Medianschlag selbst taugt nicht als Vorlage:
 * bei regelmäßigem Rhythmus enthält er hinter der T-Welle die P-Welle des Folgeschlags, die Subtraktion entfernte sie mit.
 */
function tModel(tpl, iso, tPeak, tAmp, qOff, fs) {
  let h = tPeak;
  while (h > qOff && Math.abs(tpl[h] - iso) > Math.abs(tAmp) / 2) h--;
  const sigma = Math.max(0.02 * fs, (tPeak - h) / 1.1774); // halbe Halbwertsbreite → σ
  return { peak: tPeak, amp: tAmp, sigma, end: tPeak + Math.round(3 * sigma) };
}

/**
 * Zieht die modellierte T-Welle des Vorschlags (um rrS nach links verschoben) vom Bereich vor dem QRS ab. Bei hoher
 * Herzfrequenz liegt die P-Welle auf dem absteigenden T-Schenkel und ist sonst nicht abgrenzbar.
 */
function subtractPrevT(arr, m, rrS, qOn) {
  const out = Float64Array.from(arr);
  const i0 = Math.max(0, m.peak - rrS - Math.round(2 * m.sigma)), i1 = Math.min(qOn - 1, m.end - rrS);
  for (let i = i0; i <= i1; i++) { const d = i + rrS - m.peak; out[i] -= m.amp * Math.exp(-d * d / (2 * m.sigma * m.sigma)); }
  return out;
}

/** Vermessung des Medianschlags. */
function delineate(tpl, r, fs, rrMean, polarity, rrMin = rrMean) {
  const n = tpl.length;
  // vorläufige isoelektrische Linie: Median im Bereich 60–100 ms vor R
  // Robuste Grundlinie: Pegel des flachsten 40-ms-Fensters in der TP-Strecke (100–360 ms vor R)
  const tpBase = (() => {
    const w = Math.round(0.04 * fs); let best = Infinity, lvl = null;
    for (let a = Math.max(0, r - Math.round(0.36 * fs)); a + w <= r - Math.round(0.10 * fs); a += 2) {
      let v = 0; for (let k = a + 1; k < a + w; k++) v += Math.abs(tpl[k] - tpl[k - 1]);
      if (v < best) { best = v; lvl = median(Array.from(tpl.slice(a, a + w))); }
    }
    return lvl;
  })();
  const preIso = median(Array.from(tpl.slice(Math.max(0, r - Math.round(0.1 * fs)), r - Math.round(0.06 * fs))));
  const tpOk = tpBase != null && Math.abs(tpBase - preIso) <= QRS_OPT.tpMaxDev;
  const q = qrsBounds(tpl, r, fs, () => (QRS_OPT.robustOnsetIso && tpOk ? tpBase : preIso));
  // Isoelektrische Linie: PR-Strecke (20 ms vor QRS-Beginn) – weicht sie deutlich vom TP-Niveau ab (P-Welle reicht bis
  // an den QRS), gilt die TP-Grundlinie
  const prIso = median(Array.from(tpl.slice(Math.max(0, q.on - Math.round(0.02 * fs)), q.on + 1)));
  const iso = QRS_OPT.robustIso && tpOk && Math.abs(prIso - tpBase) > 0.03 ? tpBase : prIso;
  const rAmp = (tpl[r] - iso);

  // T-Welle: Suchfenster endet frequenzabhängig (T-Gipfel liegt physiologisch vor ≈ 0,42·√RR + 100 ms nach R),
  // damit nicht U-Welle, nächste P-Welle oder Rauschen als "T" gilt.
  const tA = q.off + Math.round(0.06 * fs), tB = Math.min(n - 2, r + Math.round(Math.min(T_OPT.maxFrac * rrMean, 0.42 * Math.sqrt(rrMean) + 0.1) * fs));
  let tPeak = -1, tAmp = 0;
  for (let i = tA; i < tB; i++) if (Math.abs(tpl[i] - iso) > Math.abs(tAmp)) { tAmp = tpl[i] - iso; tPeak = i; }
  // Rauschen im T-Fenster (mittlere Punkt-zu-Punkt-Abweichung) für die Verlässlichkeit
  let tNoise = 0;
  for (let i = tA + 1; i < tB; i++) tNoise += Math.abs(tpl[i] - tpl[i - 1]);
  tNoise /= Math.max(1, tB - tA - 1);
  let tEnd = null;
  const tOk = tPeak > 0 && Math.abs(tAmp) >= Math.max(0.05, 0.06 * Math.abs(rAmp)) && Math.abs(tAmp) > 6 * tNoise * Math.sqrt(fs / 250);
  // Tangentenmethode: steilste Stelle des absteigenden T-Schenkels, Schnitt mit isoelektrischer Linie
  const tangentEnd = arr => {
    let best = tPeak, slope = 0;
    for (let i = tPeak + 1; i < Math.min(n - 1, tPeak + 0.15 * fs); i++) {
      const sl = (arr[i + 1] - arr[i - 1]) / 2;
      if (Math.sign(-sl) === Math.sign(tAmp) && Math.abs(sl) > Math.abs(slope)) { slope = sl; best = i; }
    }
    if (slope === 0) return null;
    const xi = best + (iso - arr[best]) / slope;
    return xi > tPeak && xi < n ? xi : null;
  };
  // Verlässlichkeit der QT-Messung: T-Welle ausgeprägt, nach dem T-Ende kehrt das Signal zur Grundlinie zurück
  // (sonst U-Welle/P-Welle/Störung), QT physiologisch plausibel: T-Ende vor der nächsten P-Welle (≤ RR − 100 ms),
  // QTc (Fridericia) ≤ 600 ms
  const qtReliability = (arr, te) => {
    const e = Math.round(te), w0 = Math.min(n, e + Math.round(0.02 * fs)), w1 = Math.min(n, e + Math.round(0.09 * fs));
    let after = 0;
    for (let i = w0; i < w1; i++) after = Math.max(after, Math.abs(arr[i] - iso));
    const flat = w1 - w0 >= 3 && after <= Math.max(0.35 * Math.abs(tAmp), 0.04);
    const qtS = (te - q.on) / fs;
    return flat && qtS <= rrMean - 0.10 && qtS / Math.cbrt(rrMean) <= 0.6;
  };
  if (tOk) tEnd = tangentEnd(tpl);
  let qtReliable = tEnd != null && qtReliability(tpl, tEnd);
  // P-Welle: Suche 20–400 ms vor QRS-Beginn, frühestens nach der T-Welle des Vorschlags.
  // Kriterium ist die Prominenz (Höhe über dem höheren der beiden Täler links/rechts) – robust auf T-Ausläufern.
  // Fensterbeginn: gemessenes T-Ende des Vorschlags (minus 40 ms Überlappung, P darf auf dem T-Ausläufer beginnen);
  // ohne verlässliche T-Messung die Formel 0,33·√RR
  // T-Wellen-Subtraktion: reicht die modellierte T-Welle des Vorschlags ins P-Fenster, wird sie abgezogen und das
  // Fenster beginnt schon 20 ms nach dem verschobenen T-Gipfel
  const rrS = Math.round(rrMean * fs);
  const pWin0 = Math.max(1, q.on - Math.round(0.40 * fs));
  const tM = P_OPT.subtractT && tOk ? tModel(tpl, iso, tPeak, tAmp, q.off, fs) : null;
  const tWinEnd = P_OPT.useMeasuredT && tOk && tEnd != null
    ? Math.round(tEnd - rrMean * fs - 0.04 * fs)
    : r - Math.round((rrMean - 0.33 * Math.sqrt(rrMean) - P_OPT.tEndMargin) * fs);
  // Subtraktion nur bei Bedarf: endet die T-Welle des Vorschlags näher als 160 ms vor dem QRS-Beginn, überlagert sie
  // zwangsläufig eine P-Welle (PR 120–200 ms, Dauer ≈ 100 ms). Sonst bleibt die Suche im Rohsignal (an LUDB genauer).
  const tIntrudes = tOk && tEnd != null && tEnd - rrS > q.on - Math.round(T_OPT.subGapMs / 1000 * fs);
  const tSub = !!tM && tIntrudes && tM.end - rrS > pWin0 + Math.round(0.02 * fs);
  const src = tSub ? subtractPrevT(tpl, tM, rrS, q.on) : tpl; // Signal für die P-Suche
  const prevTEnd = tSub ? Math.max(pWin0, tM.peak - rrS + Math.round(0.02 * fs)) : tWinEnd;
  const pA = Math.max(1, q.on - Math.round(0.40 * fs), q.off - Math.round(rrMin * fs) + Math.round(0.04 * fs), Math.min(prevTEnd, q.on - Math.round(0.12 * fs))), pB = q.on - Math.round(0.01 * fs);
  let noise = 0;
  for (let i = pA + 1; i < pB; i++) noise += Math.abs(src[i] - src[i - 1]);
  noise /= Math.max(1, pB - pA - 1);
  const W = Math.round(0.10 * fs);
  let pPeak = -1, prom = 0, sg = 1, base = iso;
  for (const sgn of [1, -1]) {
    for (let i = pA + 1; i < pB - 1; i++) {
      const v = sgn * src[i];
      if (v < sgn * src[i - 1] || v < sgn * src[i + 1]) continue; // nur lokale Extrema
      let lMin = Infinity, rMin = Infinity;
      for (let k = Math.max(0, i - W); k <= i; k++) lMin = Math.min(lMin, sgn * src[k]);
      for (let k = i; k <= Math.min(q.on, i + W); k++) rMin = Math.min(rMin, sgn * src[k]);
      // Prominenz = Höhe über dem höheren der beiden Täler. Liegt die linke Flanke am Fensterrand (P auf dem T-Ausläufer) und
      // ist links eine echte Kerbe vorhanden (nicht nur ein Rauschbuckel), zählt nur das rechte Tal.
      const promL = v - lMin, promR = v - rMin;
      const cutL = P_OPT.leftCut && i - pA < W && promL >= Math.max(0.015, 3 * noise);
      const pr = (cutL ? promR : Math.min(promL, promR)) - (sgn < 0 ? 0.005 : 0); // positive P leicht bevorzugt
      if (pr > prom) { prom = pr; pPeak = i; sg = sgn; base = sgn * Math.max(lMin, rMin); }
    }
  }
  const pAmp = pPeak > 0 ? src[pPeak] - iso : 0;
  let pPresent = pPeak > 0 && prom > Math.max(P_OPT.minProm, 0.03 * Math.abs(rAmp)) && prom > 6 * noise;
  let pOn = null, pOff = null, pOnEdge = false;
  if (pPresent) {
    const lim = P_OPT.onsetFrac * prom;
    pOn = pPeak;
    while (pOn > Math.max(1, pPeak - Math.round(0.12 * fs)) && sg * (src[pOn] - base) > lim && !(sg * (src[pOn - 1] - src[pOn]) > 0.002 && pPeak - pOn > 0.02 * fs)) pOn--;
    pOnEdge = pOn <= pA + 1; // Beginn läuft in den Fensterrand (T-Ausläufer) – PR-Messung unsicher
    pOff = pPeak;
    while (pOff < Math.min(q.on - 1, pPeak + Math.round(0.12 * fs)) && sg * (src[pOff] - base) > lim && !(sg * (src[pOff + 1] - src[pOff]) > 0.002 && pOff - pPeak > 0.02 * fs)) pOff++;
    // im subtrahierten T-Bereich gilt nur, was wie eine P-Welle aussieht (≤ 140 ms, deutlich kleiner als die R-Zacke)
    if (tSub && pPeak < tWinEnd && ((pOff - pOn) / fs > 0.14 || prom >= 0.3 * Math.abs(rAmp))) { pPresent = false; pOn = pOff = null; pOnEdge = false; }
  }
  // P-Welle beginnt auf der T-Welle des Vorschlags: PR-Zeit unsicher, und umgekehrt verfälscht die P-Welle des Folgeschlags
  // das T-Ende dieses Schlags → T-Ende am um die (als Gauß-Kurve modellierte) P-Welle bereinigten Signal neu messen
  const pInT = pPresent && tSub && pOn < Math.round(tEnd - rrS) + Math.round(0.02 * fs);
  if (pInT && tOk) {
    const sgm = Math.max(0.02 * fs, (pOff - pOn) / 4), pos = pPeak + rrS, clean = Float64Array.from(tpl);
    for (let i = Math.max(0, pos - Math.round(3 * sgm)); i <= Math.min(n - 1, pos + Math.round(3 * sgm)); i++) { const d = i - pos; clean[i] -= pAmp * Math.exp(-d * d / (2 * sgm * sgm)); }
    const te = tangentEnd(clean);
    if (te != null) { tEnd = te; qtReliable = qtReliability(clean, te); }
  }

  // ST-Strecke: J-Punkt + 60 ms
  const st = q.off + Math.round(0.06 * fs) < n ? tpl[q.off + Math.round(0.06 * fs)] - iso : null;

  const ms = v => (v == null ? null : Math.round(v * 1000 / fs));
  const qt = tEnd != null ? ms(tEnd - q.on) : null;
  return {
    iso, rAmp, qrsOn: q.on, qrsOff: q.off, pOn, pOff, pPeak: pPresent ? pPeak : null, pAmp: pPresent ? pAmp : 0, pProm: pPresent ? sg * prom : 0, pNoise: noise, pPresent, pOnEdge, pA, pB, tSub, tModel: tM, pInT,
    tPeak: tPeak > 0 ? tPeak : null, tAmp, tEnd, qtReliable, tNoise, tOk, tFromJ: tPeak > 0 ? ms(tPeak - q.off) : null,
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
  // Umgekehrt gepolt (Gerät seitenverkehrt gehalten): zur Auswertung spiegeln, damit P/T/ST-Logik stimmt
  if (polarity < 0) { for (let i = 0; i < x.length; i++) x[i] = -x[i]; polarity = 1; res.signal = x; }
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
    // QRS-typisch: Spitze-Spitze-Höhe und Steilheit wie bei kräftigen Schlägen – solche Schläge (z. B. VES) nie verwerfen
    const qw = Math.round(0.07 * fs);
    const p2p = segs0.map(s => { let mx = -Infinity, mn = Infinity; for (let k = pre - qw; k <= pre + qw; k++) { mx = Math.max(mx, s[k]); mn = Math.min(mn, s[k]); } return mx - mn; });
    const slope = segs0.map(s => { let m = 0; for (let k = pre - qw; k < pre + qw; k++) m = Math.max(m, Math.abs(s[k + 1] - s[k])); return m; });
    const topP = [...p2p].sort((a, b) => b - a)[Math.floor(p2p.length * 0.25)] || p2p[0];
    const topS = [...slope].sort((a, b) => b - a)[Math.floor(slope.length * 0.25)] || slope[0];
    const qrsLike = peaks.map((_, i) => p2p[i] >= 0.6 * topP && slope[i] >= 0.45 * topS);
    const strong = peaks.map((_, i) => (amps[i] >= 0.6 * top && c0[i] >= 0.6) || (DET_OPT.protectQrsLike && qrsLike[i]));
    const sp = peaks.filter((_, i) => strong[i]);
    const trueRR = sp.length >= 3 ? median(sp.slice(1).map((p, i) => (p - sp[i]) / fs)) : median(peaks.slice(1).map((p, i) => (p - peaks[i]) / fs));
    const drop = peaks.map((p, i) => {
      if (strong[i]) return false;
      const dPrev = i > 0 ? (p - peaks[i - 1]) / fs : Infinity, dNext = i < peaks.length - 1 ? (peaks[i + 1] - p) / fs : Infinity;
      return Math.min(dPrev, dNext) < 0.6 * trueRR || (c0[i] < 0.3 && amps[i] < 0.4 * top);
    });
    if (!drop.some(Boolean)) break;
    // T-Wellen-Kandidaten (120–600 ms nach einem kräftigen Schlag, kleiner) sind keine Störung
    removed += drop.filter((d, i) => d && !(i > 0 && strong[i - 1] && (peaks[i] - peaks[i - 1]) / fs >= 0.12 && (peaks[i] - peaks[i - 1]) / fs <= 0.6 && amps[i] < 0.6 * top)).length;
    peaks = peaks.filter((_, i) => !drop[i]);
  }
  // Rückwärtssuche: In Lücken von ≥ 1,6 × RR nach einem übersehenen, QRS-ähnlichen Schlag suchen
  if (DET_OPT.searchBack && peaks.length >= 4) {
    for (let iter = 0; iter < 3; iter++) {
      const segs0 = peaks.map(p => segment(x, p, -pre, Math.round(0.4 * fs)));
      const tpl0 = medTpl(segs0, segs0[0].length), tq = qrsWin(tpl0);
      const rr0 = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs), ref0 = median(rr0);
      const qw = Math.round(0.07 * fs);
      const p2pAt = k => { let mx = -Infinity, mn = Infinity; for (let j = Math.max(0, k - qw); j <= Math.min(x.length - 1, k + qw); j++) { mx = Math.max(mx, x[j]); mn = Math.min(mn, x[j]); } return mx - mn; };
      const p2pRef = median(peaks.map(p2pAt));
      const ins = [];
      for (let i = 0; i < rr0.length; i++) {
        if (rr0[i] < 1.6 * ref0) continue;
        let best = -1, bc = 0;
        for (let k = peaks[i] + Math.round(0.3 * fs); k <= peaks[i + 1] - Math.round(0.3 * fs); k += 2) {
          if (p2pAt(k) < 0.4 * p2pRef) continue;
          const c = corr(qrsWin(segment(x, k, -pre, Math.round(0.4 * fs))), tq);
          if (c > bc) { bc = c; best = k; }
        }
        if (best >= 0 && bc >= 0.8) { // nur eindeutig QRS-förmige Schläge einsetzen (Rauschen in echten Pausen bleibt draußen)
          let m = best; // auf die R-Spitze setzen
          for (let j = best - Math.round(0.03 * fs); j <= best + Math.round(0.03 * fs); j++) if (j >= 0 && j < x.length && polarity * x[j] > polarity * x[m]) m = j;
          ins.push(m);
        }
      }
      if (!ins.length) break;
      peaks = [...peaks, ...ins].sort((a, b) => a - b);
    }
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
  // Vergleichsabstand nur aus Intervallen zwischen zwei normal geformten Schlägen (sonst verfälschen häufige VES den Bezug)
  const nnOk = rr.map((_, k) => corrs2[k] >= 0.85 && corrs2[k + 1] >= 0.85);
  const nnVals = rr.filter((_, k) => nnOk[k]);
  const localRefNN = i => {
    const nb = [];
    for (let k = Math.max(0, i - 6); k <= Math.min(rr.length - 1, i + 6); k++) if (k !== i && nnOk[k]) nb.push(rr[k]);
    return nb.length >= 2 ? median(nb) : nnVals.length >= 3 ? median(nnVals) : localRef(i);
  };

  const qw2 = Math.round(0.07 * fs);
  const p2pF = segs.map(s => { let mx = -Infinity, mn = Infinity; for (let k = pre - qw2; k <= pre + qw2; k++) { mx = Math.max(mx, s[k]); mn = Math.min(mn, s[k]); } return mx - mn; });
  const p2pMed = median(p2pF);
  const flatBase = s => { // flachstes 40-ms-Fenster 100–360 ms vor R (wie beim Medianschlag)
    const w = Math.round(0.04 * fs); let best = Infinity, lvl = null;
    for (let a0 = Math.max(0, pre - Math.round(0.36 * fs)); a0 + w <= pre - Math.round(0.10 * fs); a0 += 4) {
      let v = 0; for (let k = a0 + 1; k < a0 + w; k++) v += Math.abs(s[k] - s[k - 1]);
      if (v < best) { best = v; lvl = median(Array.from(s.slice(a0, a0 + w))); }
    }
    const b0 = baseAt(s);
    return lvl != null && Math.abs(lvl - b0) <= QRS_OPT.tpMaxDev ? lvl : b0;
  };
  const tplQ = qrsBounds(tpl, pre, fs, () => flatBase(tpl));
  const tplW = (tplQ.off - tplQ.on) / fs;
  const tplAmp = tpl[pre] - flatBase(tpl);
  const edgeT = 0.35;
  const beats = peaks.map((p, i) => {
    const s = segs[i];
    const iso = flatBase(s);
    const b = qrsBounds(s, pre, fs, () => iso);
    return {
      idx: p, t: p / fs, rrPrev: i > 0 ? rr[i - 1] : null, rrNext: i < rr.length ? rr[i] : null,
      // Schläge, die dem Medianschlag gleichen, erhalten dessen (robuste) Breite; nur abweichende werden einzeln vermessen
      corr: corrs2[i], width: corrs2[i] >= 0.9 ? tplW : (b.off - b.on) / fs, amp: s[pre] - iso, type: 'N', // Schwelle 0,8 kostet 8 Punkte VES-Erkennung an MIT-BIH
      edge: p / fs < edgeT || p / fs > duration - edgeT, ref: i > 0 ? localRefNN(i - 1) : rrMed,
    };
  });

  // ---- Schlagklassifikation ----
  // Normal-Intervalle: weder vorzeitig noch postextrasystolische Pause (Vorgänger-Intervall nicht vorzeitig).
  // Bei Bigeminus gibt es keine → Mittel aller RR (Kopplung + Pause ≈ 2 Sinusintervalle).
  const notPrem = i => rr[i] >= 0.88 * localRefNN(i);
  const nnLike = rr.filter((v, i) => notPrem(i) && (i === 0 || notPrem(i - 1)));
  const rrNormal = nnLike.length >= 3 ? median(nnLike) : mean(rr);
  // Streuung der normalen RR-Abstände (für die Ausreißerprüfung vorzeitiger Schläge; Sinusarrhythmie streut breit)
  const nnQ1 = nnLike.length >= 4 ? percentile(nnLike, 0.25) : rrNormal, nnIqr = nnLike.length >= 4 ? percentile(nnLike, 0.75) - nnQ1 : 0;
  const rrMad = median(rr.map(v => Math.abs(v - rrMed)));
  // Streng abwechselnde Abstände (Bigeminus: Wendepunktrate ≈ 1) machen MAD/Median unbrauchbar → dort IQR der Normal-Intervalle
  let turns = 0; for (let i = 1; i < rr.length - 1; i++) if ((rr[i] - rr[i - 1]) * (rr[i + 1] - rr[i]) < 0) turns++;
  const alternating = rr.length >= 6 && turns / (rr.length - 2) >= 0.85;
  const iqrLimit = DET_OPT.svesIqr > 0 ? nnQ1 - DET_OPT.svesIqr * Math.max(nnIqr, 0.02) : Infinity;
  const outlierLimit = RR_OPT.madOutlier && !alternating
    ? rrMed - RR_OPT.madK * Math.max(1.4826 * rrMad, 0.015)   // robuste Streuung aller Abstände (Sinusarrhythmie zählt mit)
    : iqrLimit;
  for (const [i, b] of beats.entries()) {
    if (b.edge) continue; // Randschläge sind nicht beurteilbar
    // Abstände zu Randschlägen (Einschwingbereich am Anfang/Ende) sind nicht beurteilbar
    const prevEdge = i > 0 && beats[i - 1].edge, nextEdge = i + 1 < beats.length && beats[i + 1].edge;
    const premature = !prevEdge && b.rrPrev != null && b.rrPrev < 0.82 * b.ref;
    const prevRR = i > 1 ? beats[i - 1].rrPrev : null;
    const abrupt = prevRR == null || b.rrPrev < 0.85 * prevRR || (i > 0 && beats[i - 1].type === 'S'); // plötzlich (nicht allmählich wie bei Sinusarrhythmie) oder Fortsetzung einer SVES-Gruppe
    const nextPremature = i + 1 < beats.length && beats[i + 1].rrPrev < 0.82 * beats[i + 1].ref;
    const pauseAfter = !nextEdge && b.rrNext != null && (nextPremature || (b.rrNext >= 0.9 * b.ref && b.rrNext >= 1.1 * b.rrPrev));
    const compensatory = premature && b.rrNext != null && b.rrPrev + b.rrNext >= 1.85 * rrNormal;
    const wide = b.width >= 0.12 && b.width > tplW + 0.04;
    const ampOdd = Math.abs(tplAmp) > 0 && (b.amp / tplAmp < 0.35 || b.amp / tplAmp > 2.5);
    const veryDifferent = b.corr < 0.7 || (b.corr < 0.8 && ampOdd) || (wide && b.corr < 0.85);
    // VES: deutlich andere Form, vorzeitig, mit Pause danach (oder Teil einer Salve)
    // nicht vorzeitige VES (spät einfallend, häufig bei gehäuften VES): nur bei eindeutig breiter, kräftiger, ganz anderer Form
    const lateV = DET_OPT.lateV && !premature && b.corr < 0.6 && wide && p2pF[i] >= 0.8 * p2pMed && b.rrPrev != null;
    if ((veryDifferent && premature && (pauseAfter || compensatory)) || lateV) b.type = 'V';
    else if (b.corr < 0.5) b.type = 'U';             // unklar/Artefakt
    else if (premature && abrupt && pauseAfter && b.corr >= 0.8 && b.rrPrev < outlierLimit) b.type = 'S';
    b.premature = premature;
    b.compensatory = compensatory;
  }
  res.beats = beats;

  // Intervalle über Signallücken (Kontaktverlust) sind keine Herzschlag-Abstände
  const spansGap = i => gaps.some(([a, b2]) => beats[i].t < b2 && beats[i + 1].t > a);
  const gapRR = rr.filter((v, i) => !spansGap(i));
  // NN-Intervalle: nur zwischen zwei normalen Schlägen
  const nn = [];
  for (let i = 1; i < beats.length; i++) if (beats[i].type === 'N' && beats[i - 1].type === 'N' && !spansGap(i - 1)) nn.push(beats[i].rrPrev);
  res.hrvAll = hrv(gapRR.length >= 3 ? gapRR : rr);
  res.hrv = nn.length >= 5 ? hrv(nn) : res.hrvAll;
  res.hr = Math.round(60 / mean(gapRR.length ? gapRR : rr));
  res.hrNN = nn.length >= 3 ? Math.round(60 / mean(nn)) : res.hr;
  res.peaks = peaks;
  res.rr = rr;

  // Vorlage für die Vermessung nur aus Normalschlägen mit typischer Form
  const nSegs = segs.filter((_, i) => beats[i].type === 'N' && corrs2[i] > 0.9);
  if (nSegs.length >= 3) tpl = medTpl(nSegs, pre + post);
  res.template = { data: tpl, r: pre, fs, beatsUsed: nSegs.length || segs.length };
  const precRR = beats.filter((b, i) => b.type === 'N' && corrs2[i] > 0.9 && b.rrPrev != null && !b.edge).map(b => b.rrPrev);
  const rrForQtc = RR_OPT.qtcFromPrecedingRR && precRR.length >= 3 ? median(precRR) : nn.length >= 3 ? mean(nn) : rrNormal;
  // kürzester typischer RR-Abstand (10. Perzentil): das P-Fenster darf nie in den QRS des Vorschlags reichen
  const rrMin = precRR.length >= 3 ? precRR.slice().sort((a, b) => a - b)[Math.floor(0.1 * (precRR.length - 1))] : rrForQtc;
  res.intervals = delineate(tpl, pre, fs, rrForQtc, polarity, rrMin);

  // P-Wellen-Anteil je Normalschlag (für die Vorhofflimmern-Bewertung)
  if (res.intervals.pPeak != null) {
    const off = res.intervals.pPeak - pre, ref = res.intervals.pProm, w = Math.round(0.03 * fs), W = Math.round(0.1 * fs);
    const nIdx = beats.map((b, i) => (b.type === 'N' ? i : -1)).filter(i => i >= 0);
    const useIdx = nIdx.length >= 3 ? nIdx : segs.map((_, i) => i);
    let present = 0;
    for (const bi of useIdx) {
      let s = segs[bi];
      if (res.intervals.tSub && beats[bi].rrPrev) s = subtractPrevT(s, res.intervals.tModel, Math.round(beats[bi].rrPrev * fs), res.intervals.qrsOn);
      const sg = Math.sign(ref);
      let best = -Infinity;
      for (let k = -w; k <= w; k++) {
        const c = pre + off + k;
        let lMin = Infinity, rMin = Infinity;
        for (let j = c - W; j <= c; j++) lMin = Math.min(lMin, sg * (s[j] ?? 0));
        for (let j = c; j <= Math.min(pre - 5, c + W); j++) rMin = Math.min(rMin, sg * (s[j] ?? 0));
        const cut = P_OPT.leftCut && res.intervals.pA != null && c - W < res.intervals.pA;
        best = Math.max(best, sg * s[c] - (cut ? rMin : Math.max(lMin, rMin)));
      }
      if (best > 0.4 * Math.abs(ref)) present++;
    }
    res.pRatio = present / useIdx.length;
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
