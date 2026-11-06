"""Kalibriert ECGFounder-Schwellen auf PhysioNet/CinC 2017 (1-Kanal-Handgerät, AliveCor) und schreibt js/ai/thresholds.js."""
import json, sys
from pathlib import Path
import numpy as np
res = json.loads(Path(sys.argv[1]).read_text()); out = Path(sys.argv[2])
labels = json.loads((Path(__file__).parents[2] / 'js/ai/labels.json').read_text())
EPISODIC = {'PREMATURE ATRIAL COMPLEXES','PREMATURE SUPRAVENTRICULAR COMPLEXES','PREMATURE VENTRICULAR COMPLEXES','IN A PATTERN OF BIGEMINY','VENTRICULAR TACHYCARDIA','SUPRAVENTRICULAR TACHYCARDIA'}
def agg(r, name):
    v = np.array(r['probs'])[:, labels.index(name)]
    return v.max() if name in EPISODIC else v.mean()
y = np.array([r['label'] for r in res])
def score(name): return np.array([agg(r, name) for r in res])
def auc(pos, neg):
    s = np.concatenate([pos, neg]); rk = s.argsort().argsort() + 1
    return (rk[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))
cal = {'dataset': 'PhysioNet/CinC Challenge 2017 (AliveCor, 1 Kanal, 300 Hz)', 'n': {k: int((y == k).sum()) for k in ['N','A','O','~']}}
th = {}
# Vorhofflimmern: A gegen N+O (Rauschen ausgeschlossen)
af = score('ATRIAL FIBRILLATION'); pos, neg = af[y == 'A'], af[(y == 'N') | (y == 'O')]
a = auc(pos, neg)
best = max(((t, 2 * (pos >= t).sum() / ((pos >= t).sum() + (neg >= t).sum() + len(pos))) for t in np.linspace(0.05, 0.99, 189)), key=lambda x: x[1])
t95 = float(np.quantile(neg, 0.95)); t98 = float(np.quantile(neg, 0.98))
cal['af'] = {'auc': round(float(a), 4), 'f1_best': round(float(best[1]), 3), 'thr_f1': round(float(best[0]), 3),
             'thr_spec95': round(t95, 3), 'sens_at_spec95': round(float((pos >= t95).mean()), 3),
             'thr_spec98': round(t98, 3), 'sens_at_spec98': round(float((pos >= t98).mean()), 3),
             'spec_at_f1': round(float((neg < best[0]).mean()), 3), 'sens_at_f1': round(float((pos >= best[0]).mean()), 3)}
th['ATRIAL FIBRILLATION'] = round(t95, 3)
# Übrige Labels: 97,5-%-Quantil bei normalen Aufnahmen (≤ 2,5 % Fehlalarme bei Normal-EKG)
cal['other'] = {}
for name in ['SINUS RHYTHM','ATRIAL FLUTTER','PREMATURE ATRIAL COMPLEXES','PREMATURE SUPRAVENTRICULAR COMPLEXES','PREMATURE VENTRICULAR COMPLEXES','IN A PATTERN OF BIGEMINY','WITH 1ST DEGREE AV BLOCK','SUPRAVENTRICULAR TACHYCARDIA','VENTRICULAR TACHYCARDIA','JUNCTIONAL RHYTHM','SINUS BRADYCARDIA','SINUS TACHYCARDIA','WITH SINUS ARRHYTHMIA']:
    s = score(name); n = s[y == 'N']
    q = float(np.quantile(n, 0.975))
    cal['other'][name] = {'median_N': round(float(np.median(n)), 3), 'q975_N': round(q, 3), 'mean_A': round(float(s[y == 'A'].mean()), 3), 'mean_O': round(float(s[y == 'O'].mean()), 3), 'mean_noise': round(float(s[y == '~'].mean()), 3)}
    if name != 'SINUS RHYTHM': th[name] = round(max(0.3, q), 3)
th['SINUS RHYTHM'] = 0.5
cal['af_auc_vs_noise'] = round(float(auc(pos, af[y == '~'])), 3)
out.write_text('// Automatisch erzeugt von tools/calibration/calibrate.py – nicht von Hand ändern.\n'
               '// Vorhofflimmern: Schwelle bei 95 % Spezifität; übrige: 97,5-%-Quantil bei Normal-EKGs.\n'
               f'export const THRESHOLDS = {json.dumps(th, indent=2)};\nexport const CALIBRATION = {json.dumps(cal, indent=2)};\n')
print(json.dumps(cal, indent=1))
