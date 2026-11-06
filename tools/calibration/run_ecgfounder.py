"""ECGFounder-1-Kanal über die CinC-Teilmenge laufen lassen (3 Fenster à 10 s, Wahrscheinlichkeiten je Fenster)."""
import json, sys
from pathlib import Path
import numpy as np, onnxruntime as ort
sys.path.insert(0, str(Path(__file__).parent.parent / 'ecgfounder'))
from convert import preprocess
base, model = Path(sys.argv[1]), sys.argv[2]
meta = json.loads(base.with_suffix('.json').read_text()); data = np.fromfile(base.with_suffix('.f32'), dtype=np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 12
sess = ort.InferenceSession(model, so)
res = []
for k, r in enumerate(meta['records']):
    x = data[r['off']:r['off'] + r['n']].astype(np.float64)
    x500 = np.interp(np.arange(int(len(x) / 300 * 500)) / 500, np.arange(len(x)) / 300, x)
    L = len(x500); starts = sorted(set([0, max(0, (L - 5000) // 2), max(0, L - 5000)]))
    wins = []
    for s in starts:
        w = x500[s:s + 5000]
        if len(w) < 5000: w = np.pad(w, (0, 5000 - len(w)))
        wins.append(preprocess(w).astype(np.float32))
    logits = sess.run(None, {'ecg': np.stack(wins)[:, None, :]})[0]
    res.append({'rec': r['rec'], 'label': r['label'], 'probs': (1 / (1 + np.exp(-logits))).round(4).tolist()})
    if k % 200 == 0: print(k, flush=True)
base.with_suffix('.ecgfounder.json').write_text(json.dumps(res))
print('fertig', len(res))
