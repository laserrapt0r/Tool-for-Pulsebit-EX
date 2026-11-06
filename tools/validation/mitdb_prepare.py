"""MIT-BIH Arrhythmia Database → 30-s-Abschnitte (Kanal MLII) mit Schlag-Annotationen nach AAMI (N/S/V/F/Q).

Aufruf: python mitdb_prepare.py <mitdb-ordner> <ausgabe-basis>
Schreibt <basis>.f32 (Signale, mV) und <basis>.json (Index, Schläge, Rhythmus, DS1/DS2-Zuordnung nach de Chazal 2004).
Schrittmacher-Aufnahmen (102, 104, 107, 217) sind nach AAMI-Empfehlung ausgeschlossen.
"""
import json, sys
from pathlib import Path
import numpy as np, wfdb

src, base = Path(sys.argv[1]), Path(sys.argv[2])
DS1 = [101, 106, 108, 109, 112, 114, 115, 116, 118, 119, 122, 124, 201, 203, 205, 207, 208, 209, 215, 220, 223, 230]
DS2 = [100, 103, 105, 111, 113, 117, 121, 123, 200, 202, 210, 212, 213, 214, 219, 221, 222, 228, 231, 232, 233, 234]
AAMI = {**{c: 'N' for c in 'NLRej'}, **{c: 'S' for c in 'AaJS'}, **{c: 'V' for c in 'VE'}, 'F': 'F', **{c: 'Q' for c in '/fQ'}}
SEG = 30
index, off = [], 0
with open(base.with_suffix('.f32'), 'wb') as fo:
    for rid in DS1 + DS2:
        rec = wfdb.rdrecord(str(src / str(rid)))
        ch = rec.sig_name.index('MLII') if 'MLII' in rec.sig_name else 0
        x, fs = rec.p_signal[:, ch].astype(np.float32), rec.fs
        ann = wfdb.rdann(str(src / str(rid)), 'atr')
        beats = [(int(s), AAMI[c]) for s, c in zip(ann.sample, ann.symbol) if c in AAMI]
        rhythm_marks = [(int(s), a.strip('\x00')) for s, a, c in zip(ann.sample, ann.aux_note, ann.symbol) if c == '+' and a]
        n = int(SEG * fs)
        for k in range(len(x) // n):
            a, b = k * n, (k + 1) * n
            seg = x[a:b]
            cur = [r for s, r in rhythm_marks if s <= a]
            rh = {r for s, r in rhythm_marks if a < s < b} | ({cur[-1]} if cur else set())
            bt = [[s - a, c] for s, c in beats if a <= s < b]
            fo.write(seg.tobytes())
            index.append({'rec': rid, 'set': 'DS1' if rid in DS1 else 'DS2', 'seg': k, 'off': off, 'n': n, 'fs': fs, 'beats': bt, 'rhythm': sorted(rh)})
            off += n
base.with_suffix('.json').write_text(json.dumps(index))
from collections import Counter
c = Counter(b[1] for s in index for b in s['beats'])
print(len(index), 'Abschnitte', dict(c))
