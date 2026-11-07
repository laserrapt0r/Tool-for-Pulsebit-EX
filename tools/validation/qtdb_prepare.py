"""QT Database (PhysioNet, 105 Aufnahmen, 250 Hz) → JSON mit erster Ableitung und kardiologischen Referenz-Intervallen.

Aufruf: python qtdb_prepare.py <qtdb-ordner> <ausgabe.json>
Je Aufnahme wurden ~30 Schläge von Hand markiert (Annotator q1c). Referenz = Median über diese Schläge:
  PR = QRS-Beginn − P-Beginn,  QRS = QRS-Ende − QRS-Beginn,  QT = T-Ende − QRS-Beginn
Gespeichert wird der Signalabschnitt vom ersten bis zum letzten markierten Schlag (± 3 s).
"""
import json, sys
from collections import Counter
from pathlib import Path
import numpy as np, wfdb

src, out = Path(sys.argv[1]), Path(sys.argv[2])
BEATS = set('NLRAaJSVFejE/fQ')
recs, symhist = [], Counter()
for rid in (src / 'RECORDS').read_text().split():
    try:
        ann = wfdb.rdann(str(src / rid), 'q1c')
    except Exception as e:  # noqa: BLE001
        print(rid, 'keine q1c-Annotation:', e); continue
    rec = wfdb.rdrecord(str(src / rid))
    fs = rec.fs
    sym, smp = ann.symbol, ann.sample
    symhist.update(sym)
    waves = []
    for k, s in enumerate(sym):
        if s in ('p', 't', 'u') or s in BEATS:
            on = int(smp[k - 1]) if k > 0 and sym[k - 1] == '(' else None
            off = int(smp[k + 1]) if k + 1 < len(sym) and sym[k + 1] == ')' else None
            waves.append((s, on, int(smp[k]), off))
    pr, qrs, qt, qon, nbeats, npw, types = [], [], [], [], 0, 0, Counter()
    for i, (s, on, pk, off) in enumerate(waves):
        if s not in BEATS or on is None or off is None: continue
        nbeats += 1; types[s] += 1; qon.append(on)
        qrs.append((off - on) / fs * 1000)
        prev = [w for w in waves[:i] if w[0] == 'p' and w[1] is not None and on - w[1] < 0.5 * fs]
        if prev and not any(w[0] in BEATS for w in waves[waves.index(prev[-1]):i]):
            pr.append((on - prev[-1][1]) / fs * 1000); npw += 1
        nxt = [w for w in waves[i + 1:i + 3] if w[0] == 't' and w[3] is not None]
        if nxt and (nxt[0][3] - on) / fs < 0.8: qt.append((nxt[0][3] - on) / fs * 1000)
    if nbeats < 5: print(rid, 'zu wenige markierte Schläge', nbeats); continue
    a, b = max(0, min(qon) - 3 * fs), min(len(rec.p_signal), max(qon) + 3 * fs)
    sig = rec.p_signal[a:b, 0]
    sig = np.nan_to_num(sig)
    rr = np.diff(sorted(qon)) / fs
    rr = rr[(rr > 0.25) & (rr < 2.5)]
    recs.append({
        'id': rid, 'fs': int(fs), 'lead': rec.sig_name[0], 'start': int(a), 'signal': [round(float(v), 4) for v in sig],
        'ref': {'pr': float(np.median(pr)) if len(pr) >= 3 else None, 'qrs': float(np.median(qrs)), 'qt': float(np.median(qt)) if len(qt) >= 3 else None,
                'hr': float(60 / np.median(rr)) if len(rr) else None, 'beats': nbeats, 'pFraction': npw / nbeats, 'types': dict(types), 'nQt': len(qt), 'nPr': len(pr)},
    })
out.write_text(json.dumps(recs))
print(len(recs), 'Aufnahmen →', out)
print('Annotationssymbole:', dict(symhist))
hrs = [r['ref']['hr'] for r in recs if r['ref']['hr']]
print('HF-Verteilung:', {k: sum(1 for h in hrs if lo <= h < hi) for k, (lo, hi) in {'<60': (0, 60), '60-80': (60, 80), '80-100': (80, 100), '≥100': (100, 999)}.items()})
print('QT-Referenz vorhanden:', sum(1 for r in recs if r['ref']['qt']), 'PR:', sum(1 for r in recs if r['ref']['pr']))
