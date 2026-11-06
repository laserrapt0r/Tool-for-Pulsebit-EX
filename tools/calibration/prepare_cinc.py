"""Wählt eine Teilmenge aus PhysioNet/CinC 2017 und schreibt Signale (mV, 300 Hz) als Binärdatei + Index."""
import csv, json, random, sys
from pathlib import Path
import numpy as np
from scipy.io import loadmat
src, out = Path(sys.argv[1]), Path(sys.argv[2])
ref = list(csv.reader(open(src / 'REFERENCE-v3.csv')))
random.seed(42)
by = {}
for rec, lab in ref: by.setdefault(lab, []).append(rec)
take = {'A': 758, '~': 279, 'N': 1500, 'O': 1000}
sel = [(r, l) for l, n in take.items() for r in random.sample(by[l], min(n, len(by[l])))]
index, off = [], 0
with open(out.with_suffix('.f32'), 'wb') as f:
    for rec, lab in sel:
        x = loadmat(src / 'training2017' / f'{rec}.mat')['val'][0].astype(np.float32) / 1000.0
        f.write(x.tobytes()); index.append({'rec': rec, 'label': lab, 'off': off, 'n': len(x)}); off += len(x)
out.with_suffix('.json').write_text(json.dumps({'fs': 300, 'records': index}))
print(len(sel), 'Aufnahmen, Samples', off)
