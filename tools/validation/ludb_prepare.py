"""LUDB (Lobachevsky University ECG Database, PhysioNet) → JSON mit Ableitung I und ärztlichen Referenz-Intervallen.

Aufruf: python ludb_prepare.py <ludb-ordner (mit data/)> <ausgabe.json>
Referenz je Aufnahme = Median über alle annotierten Schläge in Ableitung I:
  PR = QRS-Beginn − P-Beginn,  QRS = QRS-Ende − QRS-Beginn,  QT = T-Ende − QRS-Beginn
"""
import json, sys
from pathlib import Path
import numpy as np, wfdb

src, out = Path(sys.argv[1]), Path(sys.argv[2])
recs = []
for hea in sorted((src / 'data').glob('*.hea'), key=lambda p: int(p.stem)):
    rid = hea.stem
    rec = wfdb.rdrecord(str(src / 'data' / rid), channel_names=['i'])
    ann = wfdb.rdann(str(src / 'data' / rid), 'i')
    sym, smp = ann.symbol, ann.sample
    fs = rec.fs
    # Wellen als (Beginn, Spitze, Ende) aus Folgen '(' x ')'
    waves = []
    for k, s in enumerate(sym):
        if s in ('p', 'N', 't'):
            on = smp[k - 1] if k > 0 and sym[k - 1] == '(' else None
            off = smp[k + 1] if k + 1 < len(sym) and sym[k + 1] == ')' else None
            waves.append((s, on, smp[k], off))
    pr, qrs, qt, nbeats, npw = [], [], [], 0, 0
    for i, (s, on, pk, off) in enumerate(waves):
        if s != 'N' or on is None or off is None: continue
        nbeats += 1
        qrs.append((off - on) / fs * 1000)
        prev = [w for w in waves[:i] if w[0] == 'p' and w[1] is not None and on - w[1] < 0.5 * fs]
        if prev and not any(w[0] == 'N' for w in waves[waves.index(prev[-1]):i]):
            pr.append((on - prev[-1][1]) / fs * 1000); npw += 1
        nxt = [w for w in waves[i + 1:i + 3] if w[0] == 't' and w[3] is not None]
        if nxt: qt.append((nxt[0][3] - on) / fs * 1000)
    comments = ' '.join(rec.comments)
    rhythm = next((c.split(':', 1)[1].strip() for c in rec.comments if c.startswith('Rhythm')), '')
    recs.append({
        'id': rid, 'fs': fs, 'signal': [round(float(v), 4) for v in rec.p_signal[:, 0]],
        'rhythm': rhythm, 'paced': 'pacing' in comments.lower() or 'pacemaker' in comments.lower(),
        'sex': next((c.split(':')[1].strip() for c in rec.comments if c.startswith('<sex>')), ''),
        'ref': {'pr': float(np.median(pr)) if pr else None, 'qrs': float(np.median(qrs)) if qrs else None,
                'qt': float(np.median(qt)) if qt else None, 'pFraction': npw / max(1, nbeats), 'beats': nbeats},
        'diagnoses': comments[:400],
    })
out.write_text(json.dumps(recs))
print(len(recs), 'Aufnahmen →', out)
