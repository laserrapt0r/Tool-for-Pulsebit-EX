// Befundung: Messwerte + Schlagklassifikation + KI + Gerätebefund → verständliche Befunde (mehrsprachig via t()).
// Stufen: ok · hinweis (meist harmlos) · auffaellig (beobachten/ansprechen) · abklaeren (ärztlich abklären) · info
// Sicherheit: measured · probable · possible · uncertain · device · info
import { t, nf } from './i18n.js';

const f1 = v => nf(v, 1);
const pct = v => Math.round(v * 100);

function F(id, title, level, certainty, text, extra = {}) {
  return { id, title, level, certainty, text, meaning: '', advice: '', evidence: [], ...extra };
}

/** Sucht Muster in der Schlagfolge (N/S/V/U). */
function patterns(types) {
  const s = types.join('');
  const out = {};
  const run = (ch, n) => new RegExp(`${ch}{${n},}`, 'g');
  out.vCouplets = (s.match(/(?<!V)VV(?!V)/g) || []).length;
  out.vRuns = (s.match(run('V', 3)) || []).map(r => r.length);
  out.sRuns = (s.match(run('S', 3)) || []).map(r => r.length);
  out.sCouplets = (s.match(/(?<!S)SS(?!S)/g) || []).length;
  const longest = re => Math.max(0, ...[...s.matchAll(re)].map(m => m[0].length));
  out.vBigeminy = longest(/(?:NV){3,}/g) / 2; // Anzahl Zyklen
  out.sBigeminy = longest(/(?:NS){3,}/g) / 2;
  out.vTrigeminy = longest(/(?:NNV){3,}/g) / 3;
  out.sTrigeminy = longest(/(?:NNS){3,}/g) / 3;
  return out;
}

/** Ruhe-Herzfrequenz-Normbereich nach Alter (Jahre). Erwachsene: 60–100/min. */
export function hrNorm(age) {
  if (age == null || age >= 18) return { lo: 60, hi: 100, mark: 50, adult: true };
  if (age < 1) return { lo: 100, hi: 160, mark: 90 };
  if (age < 3) return { lo: 90, hi: 150, mark: 80 };
  if (age < 6) return { lo: 80, hi: 140, mark: 70 };
  if (age < 12) return { lo: 70, hi: 120, mark: 60 };
  return { lo: 60, hi: 100, mark: 50 };
}

/**
 * @param {object} a Ergebnis von analyze()
 * @param {object} opts { sex: 'm'|'w'|'', age, ai: {labels, thresholds}, device }
 */
export function interpret(a, { sex = '', age = null, ai = null, device = null } = {}) {
  const out = [];
  const add = f => (out.push(f), f);
  const q = a.quality || { score: 0, label: 'none', reasons: [] };
  const reasons = (q.reasons || []).map(r => (typeof r === 'string' ? t(r) : t(r.k, r)));

  if (!a.beats?.length || q.score < 25) {
    add(F('quality', t('f.quality.none.t'), 'hinweis', 'measured', t('f.quality.none.x'), { advice: t('f.quality.none.a'), evidence: reasons }));
    return summarize(out, a, ai);
  }
  const unsure = q.score < 60;
  if (q.score < 80) {
    add(F('quality', t('f.quality.t', { label: t('q.l.' + q.label), score: q.score }), unsure ? 'hinweis' : 'info', 'measured', t('f.quality.x'),
      { evidence: reasons, advice: unsure ? t('f.quality.a') : '' }));
  }

  const iv = a.intervals || {};
  const beats = a.beats;
  const types = beats.map(b => b.type);
  const nS = types.filter(x => x === 'S').length, nV = types.filter(x => x === 'V').length;
  const dur = a.duration;
  const hrv = a.hrv, hrvAll = a.hrvAll;
  const p = ai?.labels || {};
  const thr = ai?.thresholds || {};
  const aiSays = label => Number.isFinite(p[label]) && thr[label] != null && p[label] >= thr[label];
  const aiTxt = label => (Number.isFinite(p[label]) ? t('ev.aiProb', { p: pct(p[label]), t: pct(thr[label] ?? 0.5) }) : null);
  const pR = pct(a.pRatio || 0);

  // ---------- Vorhofflimmern ----------
  const irrAll = hrvAll && hrvAll.nrmssd > 0.1 && hrvAll.entropy > 0.7 && hrvAll.tpr > 0.45 && hrvAll.tpr < 0.85;
  const irrNN = hrv && hrv.nrmssd > 0.08;
  const fewP = a.pRatio < 0.5 || !iv.pPresent;
  const afRule = irrAll && irrNN && beats.length >= 12;
  const afAI = aiSays('ATRIAL FIBRILLATION');
  const pAF = p['ATRIAL FIBRILLATION'];
  const hasAI = pAF != null;
  // Kalibriert auf PhysioNet/CinC 2017: (Unregelmäßigkeit & KI ≥ 0,7) oder KI ≥ 0,9 → Sens. 87 %, Spez. 96 %
  let isAF = false;
  const afFlag = hasAI ? (irrAll && pAF >= 0.7) || pAF >= 0.9 : afRule;
  const afEvidence = [
    hrvAll ? t('ev.nrmssd', { v: f1(hrvAll.nrmssd * 100) }) : null, hrvAll ? t('ev.entropy', { v: f1(hrvAll.entropy) }) : null,
    t('ev.pRatioVis', { p: pR }), aiTxt('ATRIAL FIBRILLATION'),
  ].filter(Boolean);
  if (afFlag) {
    isAF = true;
    let cert = afRule && afAI && q.score >= 60 ? 'probable' : 'possible';
    if (q.score < 60) cert = 'uncertain';
    add(F('af', cert === 'probable' ? t('f.af.t.prob') : t('f.af.t'), 'abklaeren', cert,
      [fewP ? t('f.af.x1p') : t('f.af.x1'), t('f.af.x2'), cert === 'uncertain' ? t('f.af.x3') : ''].filter(Boolean).join(' '),
      { meaning: t('f.af.m'), advice: t('f.af.a') + (cert === 'uncertain' ? ' ' + t('f.af.a2') : ''), evidence: afEvidence }));
  } else if (afRule && hasAI) {
    add(F('irregular', t('f.irr.t'), pAF >= 0.3 ? 'auffaellig' : 'hinweis', 'possible', t('f.irr.x'), { meaning: t('f.irr.m'), advice: t('f.irr.a'), evidence: afEvidence }));
  }

  // ---------- Grundrhythmus & Frequenz ----------
  const hr = a.hrNN || a.hr;
  const regularRhythm = hrv && hrv.nrmssd < 0.06;
  // P-Welle in Ableitung I oft winzig: regelmäßiger Rhythmus + KI (kein Vorhofflimmern, Sinus hoch) bestätigt den Sinusrhythmus.
  // Geprüft an CinC 2017: diese Kombination tritt bei keiner Vorhofflimmern-Aufnahme auf.
  const sinusByAI = !isAF && !(iv.pPresent && a.pRatio >= 0.7) && regularRhythm && Number.isFinite(pAF) && pAF < 0.3 && (p['SINUS RHYTHM'] ?? 0) >= 0.9;
  const sinus = !isAF && ((iv.pPresent && a.pRatio >= 0.7) || sinusByAI);
  const norm = hrNorm(age);
  const rate = t(hr < norm.mark ? 'rate.markedSlow' : hr < norm.lo ? 'rate.slow' : hr > norm.hi ? 'rate.fast' : 'rate.normal');
  if (sinus) {
    let title = t('f.sinus.t'), level = 'ok', id = 'sinus', meaning = t('f.sinus.m');
    let text = sinusByAI ? t('f.sinus.xAI', { hr, rate, p: pct(p['SINUS RHYTHM']) }) : norm.adult ? t('f.sinus.x', { hr, rate }) : t('f.sinus.xAge', { hr, rate, lo: norm.lo, hi: norm.hi });
    if (hr < norm.mark) { title = t('f.sinus.tBradyMarked'); id = 'sinus_brady'; level = hr < norm.mark - 10 ? 'auffaellig' : 'hinweis'; meaning = t('f.sinus.mBradyMarked'); }
    else if (hr < norm.lo) { title = t('f.sinus.tBrady'); id = 'sinus_brady'; level = 'ok'; meaning = t('f.sinus.mBrady'); }
    else if (hr > norm.hi) { title = t('f.sinus.tTachy'); id = 'sinus_tachy'; level = hr > norm.hi + 20 ? 'auffaellig' : 'hinweis'; meaning = t('f.sinus.mTachy'); }
    const sa = hrv && hrv.maxRR - hrv.minRR > 0.12 && hrv.nrmssd <= 0.08;
    let headTitle = title;
    if (sa) {
      title = t('f.sinus.tSA', { title });
      text += ' ' + t('f.sinus.xSA', { min: Math.round(hrv.minRR * 1000), max: Math.round(hrv.maxRR * 1000) });
      meaning += ' ' + t('f.sinus.mSA');
    }
    const aiSR = p['SINUS RHYTHM'];
    add(F(id, title, level, sinusByAI ? 'probable' : 'measured', text, {
      headTitle, meaning, advice: level === 'auffaellig' ? t('f.sinus.a') : '',
      evidence: [t('ev.hrMean', { hr, n: beats.length }), t('ev.pBefore', { p: pR }), iv.pr ? t('ev.pr', { v: iv.pr }) : null, aiSR != null ? t('ev.aiSR', { p: pct(aiSR) }) : null].filter(Boolean),
    }));
  } else if (!isAF) {
    const regular = regularRhythm;
    const wide = iv.qrs >= 120;
    if (regular && hr > norm.hi) {
      add(F('tachy_nop', wide ? t('f.tachy.tWide') : t('f.tachy.t'), 'abklaeren', 'possible',
        t('f.tachy.x', { hr }) + (wide ? ' ' + t('f.tachy.xWide') : ''),
        {
          meaning: wide ? t('f.tachy.mWide') : t('f.tachy.m'), advice: wide ? t('f.tachy.aWide') : t('f.tachy.a'),
          evidence: [t('ev.hr', { hr }), t('ev.pRatio', { p: pR }), t('ev.qrs', { v: iv.qrs }), aiTxt('SUPRAVENTRICULAR TACHYCARDIA'), aiTxt('ATRIAL FLUTTER'), aiTxt('VENTRICULAR TACHYCARDIA')].filter(Boolean),
        }));
    } else if (regular && hr < norm.lo) {
      add(F('brady_nop', t('f.bradynop.t'), hr < 45 ? 'auffaellig' : 'hinweis', 'possible', t('f.bradynop.x', { hr }),
        { meaning: t('f.bradynop.m'), advice: t('f.bradynop.a'), evidence: [t('ev.hr', { hr }), t('ev.pRatio', { p: pR }), aiTxt('JUNCTIONAL RHYTHM')].filter(Boolean) }));
    } else {
      add(F('rhythm_unclear', t('f.unclear.t', { hr }), 'hinweis', 'uncertain', regular ? t('f.unclear.xReg') : t('f.unclear.xIrr'),
        { meaning: t('f.unclear.m'), advice: t('f.unclear.a'), evidence: [t('ev.pRatio', { p: pR }), p['SINUS RHYTHM'] != null ? t('ev.aiSR', { p: pct(p['SINUS RHYTHM']) }) : null].filter(Boolean) }));
    }
  }

  // ---------- Extrasystolen ----------
  const pat = patterns(types);
  const perMin = n => f1(n / dur * 60);
  if (nS && !isAF) {
    const big = pat.sBigeminy >= 3, tri = pat.sTrigeminy >= 3, runs = pat.sRuns;
    const aiS = Math.max(p['PREMATURE ATRIAL COMPLEXES'] ?? 0, p['PREMATURE SUPRAVENTRICULAR COMPLEXES'] ?? 0);
    const many = runs.length || nS / dur * 60 > 6;
    const single = nS === 1 && !pat.sCouplets && q.score >= 80;
    add(F('sves', t(big ? 'f.sves.tBig' : tri ? 'f.sves.tTri' : 'f.sves.t', { n: nS }), many ? 'auffaellig' : single ? 'info' : 'hinweis',
      aiSays('PREMATURE ATRIAL COMPLEXES') || aiSays('PREMATURE SUPRAVENTRICULAR COMPLEXES') ? 'probable' : 'measured',
      [t('f.sves.x', { n: nS, perMin: perMin(nS) }), pat.sCouplets ? t('f.sves.xCouplet', { n: pat.sCouplets }) : '',
        runs.length ? t('f.sves.xRuns', { n: runs.length, len: runs.join(', ') }) : '', big ? t('f.sves.xBig') : tri ? t('f.sves.xTri') : ''].filter(Boolean).join(' '),
      { meaning: t('f.sves.m'), advice: many ? t('f.sves.aMany') : t('f.sves.a'), evidence: [t('f.sves.e1'), t('f.sves.e2'), aiS ? t('f.sves.eAI', { p: pct(aiS) }) : null].filter(Boolean) }));
  }
  if (nV) {
    const big = pat.vBigeminy >= 3, tri = pat.vTrigeminy >= 3, runs = pat.vRuns;
    const comp = beats.filter(b => b.type === 'V' && b.compensatory).length;
    const title = runs.length ? t('f.ves.tRun', { len: Math.max(...runs) }) : t(big ? 'f.ves.tBig' : tri ? 'f.ves.tTri' : 'f.ves.t', { n: nV });
    const wideV = beats.some(b => b.type === 'V' && b.width >= 0.12);
    const singleV = nV === 1 && !pat.vCouplets && q.score >= 80;
    add(F('ves', title, runs.length ? 'abklaeren' : pat.vCouplets || big || nV / dur * 60 > 6 ? 'auffaellig' : singleV ? 'info' : 'hinweis', aiSays('PREMATURE VENTRICULAR COMPLEXES') ? 'probable' : 'possible',
      [t(wideV ? 'f.ves.xWide' : 'f.ves.x', { n: nV, perMin: perMin(nV) }), comp ? t('f.ves.xComp', { n: comp }) : '', pat.vCouplets ? t('f.ves.xCouplet', { n: pat.vCouplets }) : '',
        runs.length ? t('f.ves.xRuns', { n: runs.length }) : '', big ? t('f.ves.xBig') : ''].filter(Boolean).join(' '),
      { meaning: t('f.ves.m'), advice: runs.length ? t('f.ves.aRun') : t('f.ves.a'), evidence: [t('f.ves.e1'), aiTxt('PREMATURE VENTRICULAR COMPLEXES'), t('f.ves.e2')].filter(Boolean) }));
  }

  // ---------- Pausen ----------
  // Pausen, die eine Signallücke (Elektrodenkontakt verloren) überspannen, sind keine Herzpausen
  const inGap = (t0, t1) => (a.gaps || []).some(([g0, g1]) => t0 < g1 && t1 > g0);
  const pauses = a.rr.map((r, i) => ({ r, t: a.beats[i].t })).filter(x => x.r >= 2.0 && !inGap(x.t, x.t + x.r));
  const refRR = a.hrv?.meanRR || 1;
  if (pauses.length) {
    const mx = Math.max(...pauses.map(x => x.r));
    const doubled = pauses.every(x => x.r / refRR > 1.7 && x.r / refRR < 2.3); // ≈ 2 × RR: eher ein nicht erkannter Schlag als eine echte Pause
    if (doubled || unsure) {
      add(F('pause', t('f.pause.tMaybe', { s: f1(mx) }), 'hinweis', 'uncertain', t('f.pause.xMaybe', { n: pauses.length, s: f1(mx), at: f1(pauses[0].t) }),
        { meaning: t('f.pause.mMaybe'), advice: t('f.pause.aMaybe'), evidence: pauses.map(x => t('f.pause.e', { s: f1(x.r), at: f1(x.t) })) }));
    } else
    add(F('pause', t('f.pause.t', { s: f1(mx) }), mx >= 3 ? 'abklaeren' : 'auffaellig', 'measured',
      t('f.pause.x', { n: pauses.length, s: f1(mx), at: f1(pauses[0].t) }),
      { meaning: t('f.pause.m'), advice: mx >= 3 ? t('f.pause.aLong') : t('f.pause.a'), evidence: pauses.map(x => t('f.pause.e', { s: f1(x.r), at: f1(x.t) })) }));
  }

  // ---------- Überleitung & Kammererregung ----------
  if (sinus && iv.pr != null) {
    const prReliable = (iv.pProm ? Math.abs(iv.pProm) : 0) >= 8 * (iv.pNoise || 0) && q.score >= 80 && !sinusByAI;
    // PR-Messgenauigkeit ±14 ms: erst ab 211 ms und nur bei deutlich erkennbarer P-Welle melden
    if (iv.pr > 210 && prReliable) {
      const border = iv.pr <= (a.source === 'pdf' ? 230 : 220);
      add(F('avb1', border ? t('f.avb1.tBorder') : t('f.avb1.t'), border ? 'hinweis' : 'auffaellig', border ? 'uncertain' : 'measured', t('f.avb1.x', { v: iv.pr }),
        { meaning: t('f.avb1.m'), advice: t('f.avb1.a'), evidence: [t('f.avb1.e', { v: iv.pr, acc: a.source === 'pdf' ? 20 : 10 })] }));
    } else if (iv.pr < 110 && q.score >= 80 && Math.abs(iv.pProm || 0) >= 0.08) { // kleine P-Welle: Beginn zu unsicher für „kurze PR-Zeit“
      add(F('shortpr', t('f.shortpr.t'), 'hinweis', iv.pr < 100 && a.source !== 'pdf' ? 'measured' : 'uncertain', t('f.shortpr.x', { v: iv.pr }),
        { meaning: t('f.shortpr.m'), advice: t('f.shortpr.a'), evidence: [t('ev.pr', { v: iv.pr })] }));
    }
  }
  if (iv.qrs != null) {
    if (iv.qrs >= 130 && q.score >= 70) {
      add(F('wideqrs', t('f.wideqrs.t'), 'auffaellig', unsure ? 'possible' : 'measured', t('f.wideqrs.x', { v: iv.qrs }),
        { meaning: t('f.wideqrs.m'), advice: t('f.wideqrs.a'), evidence: [t('ev.qrs', { v: iv.qrs })] }));
    } else if (iv.qrs >= 120) {
      add(F('qrsborder', t('f.qrsborder.t'), 'hinweis', 'uncertain', t('f.qrsborder.x', { v: iv.qrs }), { evidence: [t('ev.qrs', { v: iv.qrs })], meaning: t('f.qrsborder.m') }));
    }
  }

  // ---------- Repolarisation ----------
  if (iv.qtcB != null && !isAF) {
    // Fridericia ist über den Herzfrequenzbereich stabiler (Bazett überkorrigiert > 60/min); beide werden angezeigt
    const qtc = iv.qtcF, method = 'Fridericia';
    const lim = sex === 'w' ? 460 : sex === 'm' ? 450 : 455;
    const ev = [`QT ${iv.qt} ms`, `QTc Fridericia ${iv.qtcF} ms`, `QTc Bazett ${iv.qtcB} ms`];
    const reliable = iv.qtReliable && q.score >= 80 && hr >= 45 && hr <= 110;
    if (qtc >= 500 && reliable) {
      add(F('qtlong', t('f.qt.tMarked'), 'abklaeren', 'measured', t('f.qt.xMarked', { qtc, method, qt: iv.qt }),
        { meaning: t('f.qt.mMarked'), advice: t('f.qt.aMarked'), evidence: [...ev, t('f.qt.eTend')] }));
    } else if (qtc >= 480 && !reliable) {
      add(F('qtunsure', t('f.qt.tUnsure'), 'hinweis', 'uncertain', t('f.qt.xUnsure', { qtc, method }),
        { meaning: t('f.qt.mUnsure'), advice: t('f.qt.aUnsure'), evidence: [...ev, t('f.qt.eTend')] }));
    } else if (qtc >= 470 && reliable) {
      add(F('qtlong', t('f.qt.t'), 'auffaellig', 'uncertain', t(sex ? 'f.qt.x' : 'f.qt.xNoSex', { qtc, method, lim }),
        { meaning: t('f.qt.m'), advice: t('f.qt.a'), evidence: ev }));
    } else if (qtc > lim && reliable) {
      add(F('qtlong', t('f.qt.t'), 'hinweis', 'uncertain', t(sex ? 'f.qt.x' : 'f.qt.xNoSex', { qtc, method, lim }),
        { meaning: t('f.qt.m'), advice: t('f.qt.a'), evidence: ev }));
    } else if (qtc < 340 && reliable && iv.qtcB < 340) {
      add(F('qtshort', t('f.qt.tShort'), 'hinweis', 'uncertain', t('f.qt.xShort', { qtc, method }), { meaning: t('f.qt.mShort'), evidence: [`QT ${iv.qt} ms`] }));
    }
  }
  if (iv.st != null && Math.abs(iv.st) >= 0.15 && q.score >= 80 && Math.abs(iv.rAmp) >= 0.4 && Math.abs(iv.rAmp) < 4 && (iv.qrs ?? 0) < 120) {
    add(F('st', iv.st > 0 ? t('f.st.tUp') : t('f.st.tDown'), 'hinweis', 'uncertain', t(iv.st > 0 ? 'f.st.xUp' : 'f.st.xDown', { v: f1(Math.abs(iv.st)) }),
      { meaning: t('f.st.m'), advice: t('f.st.a'), evidence: [`ST ${iv.st > 0 ? '+' : ''}${f1(iv.st)} mV`] }));
  }
  if (iv.tAmp <= -0.1 && iv.rAmp >= 0.4 && q.score >= 80 && Math.abs(iv.tAmp) > 6 * (iv.tNoise || 0)) {
    add(F('tneg', t('f.tneg.t'), 'hinweis', 'uncertain', t('f.tneg.x'), { meaning: t('f.tneg.m'), evidence: [t('f.tneg.e', { v: f1(iv.tAmp) })] }));
  }
  if (a.polarity < 0) {
    add(F('polarity', t('f.pol.t'), 'info', 'possible', t('f.pol.x'), { meaning: t('f.pol.m'), advice: t('f.pol.a') }));
  }

  // ---------- KI-Hinweise ohne Bestätigung durch die Messung ----------
  if (ai?.labels) {
    if (!isAF && afAI && !afRule) add(F('ai_af', t('f.aiaf.t'), 'hinweis', 'possible', t('f.aiaf.x'), { advice: t('f.aiaf.a'), evidence: [aiTxt('ATRIAL FIBRILLATION')] }));
    if (aiSays('ATRIAL FLUTTER') && !isAF) add(F('ai_afl', t('f.aiafl.t'), 'hinweis', 'possible', t('f.aiafl.x'), { meaning: t('f.aiafl.m'), advice: t('f.aiafl.a'), evidence: [aiTxt('ATRIAL FLUTTER')] }));
    if (!nV && aiSays('PREMATURE VENTRICULAR COMPLEXES')) add(F('ai_pvc', t('f.aipvc.t'), 'hinweis', 'uncertain', t('f.aipvc.x'), { evidence: [aiTxt('PREMATURE VENTRICULAR COMPLEXES'), nS ? t('f.aipvc.e', { n: nS }) : null].filter(Boolean) }));
  }

  // ---------- Gerätebefund zum Vergleich ----------
  if (device?.results?.length) {
    add(F('device', t('f.device.t', { r: device.results.map(k => t(k)).join(', ') }), 'info', 'device', t('f.device.x'),
      { evidence: [device.hr ? `${device.hr}/min` : null, device.qrs ? `QRS ${device.qrs} ms` : null, device.qtc ? `QTc ${device.qtc} ms` : null, device.st != null ? `ST ${device.st} mV` : null, device.lead ? t(device.lead, { m: device.leadMode }) : null].filter(Boolean) }));
  }
  if (age != null && age < 18) {
    add(F('minor', t('f.minor.t'), 'info', 'info', t('f.minor.x', { age, lo: norm.lo, hi: norm.hi }), { advice: t('f.minor.a') }));
  }
  return summarize(out, a, ai);
}

const ORDER = { abklaeren: 0, auffaellig: 1, hinweis: 2, ok: 3, info: 4 };
const RHYTHM_IDS = ['af', 'irregular', 'sinus', 'sinus_brady', 'sinus_tachy', 'tachy_nop', 'brady_nop', 'rhythm_unclear'];
const SHORT = ['sves', 'ves', 'pause', 'avb1', 'wideqrs', 'qtlong', 'st'];
const acc = a => t(a.source === 'pdf' ? 'r.accPdf' : 'r.accRaw');
const RELIABILITY = {
  af: (f, a, ai) => (!ai?.labels ? t('r.afNoAI') : f.certainty === 'probable' ? t('r.afProb') : t('r.af') + (f.certainty === 'uncertain' ? ' ' + t('r.afNoisy') : '')),
  irregular: () => t('r.irregular'), sinus: () => t('r.sinus'), sinus_brady: () => t('r.hr'), sinus_tachy: () => t('r.hr'),
  rhythm_unclear: () => t('r.unclear'), tachy_nop: () => t('r.tachy'), brady_nop: () => t('r.bradynop'),
  sves: f => t('r.sves') + (f.certainty === 'probable' ? ' ' + t('r.svesAI') : ''), ves: () => t('r.ves'), pause: f => (f.certainty === 'uncertain' ? t('r.pauseMaybe') : t('r.pause')),
  avb1: (f, a) => t('r.pr', { acc: acc(a) }), shortpr: (f, a) => t('r.pr', { acc: acc(a) }),
  wideqrs: (f, a) => t('r.qrs', { acc: acc(a) }), qrsborder: (f, a) => t('r.qrsBorder', { acc: acc(a) }),
  qtlong: () => t('r.qt'), qtshort: () => t('r.qt'), qtunsure: () => t('r.qt'), st: () => t('r.st'), tneg: () => t('r.tneg'),
  ai_af: () => t('r.aiaf'), ai_afl: () => t('r.aiafl'), ai_pvc: () => t('r.aipvc'), device: () => t('r.device'),
};

function summarize(findings, a, ai = null) {
  for (const f of findings) { const r = RELIABILITY[f.id]; if (r) f.reliability = r(f, a, ai); }
  findings.sort((x, y) => ORDER[x.level] - ORDER[y.level]);
  const rhythm = findings.find(f => RHYTHM_IDS.includes(f.id));
  const worst = findings.find(f => f.level !== 'info')?.level || 'ok';
  const extra = findings.filter(f => SHORT.includes(f.id) && ['auffaellig', 'abklaeren'].includes(f.level)).map(f => t('short.' + f.id));
  let headline = rhythm ? rhythm.headTitle || rhythm.title : findings[0]?.title || t('hl.none');
  if (extra.length) headline = t('hl.with', { a: headline, b: extra.join(', ') });
  if (rhythm) { findings.splice(findings.indexOf(rhythm), 1); findings.unshift(rhythm); }
  return { findings, overall: worst, headline, isAF: findings.some(f => f.id === 'af') };
}

export const levelText = l => t('level.' + l);
export const certText = c => t('cert.' + c);
