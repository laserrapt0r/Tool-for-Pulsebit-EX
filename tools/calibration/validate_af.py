#!/usr/bin/env python3
"""Ehrliche Validierung der Vorhofflimmern-Erkennung (Messung + KI) auf PhysioNet/CinC 2017.

Schwellen werden NUR auf einer Kalibrierhälfte gewählt und auf der anderen Hälfte gemessen
(stratifiziert, 20 zufällige Aufteilungen, 95-%-Intervalle über die Aufteilungen + Bootstrap).

Aufruf: python validate_af.py <cinc-subset.rules.json> <cinc-subset.ecgfounder.json> <labels.json>
  rules.json      – Ausgabe von test/cinc-eval.mjs (regelbasierte Analyse je Aufnahme)
  ecgfounder.json – Ausgabe von tools/calibration/run_ecgfounder.py (KI-Wahrscheinlichkeiten)
"""
import json, sys
import numpy as np

rules = json.load(open(sys.argv[1]))
ai = {r['rec']: r for r in json.load(open(sys.argv[2]))}
labels = json.load(open(sys.argv[3]))
iaf = labels.index('ATRIAL FIBRILLATION')

y = np.array([r['label'] for r in rules])
p = np.array([np.mean(np.array(ai[r['rec']]['probs'])[:, iaf]) for r in rules])
g = lambda r, k: (r.get('h') or {}).get(k, 0)
nr = np.array([g(r, 'nrmssd') for r in rules]); ent = np.array([g(r, 'entropy') for r in rules]); tpr = np.array([g(r, 'tpr') for r in rules])
q = np.array([r.get('q') or 0 for r in rules])
irr = (nr > 0.1) & (ent > 0.7) & (tpr > 0.45) & (tpr < 0.85)
rule = np.array(['af' in r['ids'] for r in rules])
pos_all, neg_all = y == 'A', (y == 'N') | (y == 'O')

def fusion(t1, t2, idx): return ((irr & (p >= t1)) | (p >= t2))[idx]

def choose(cal):
    """Wählt (t1, t2) mit maximaler Sensitivität bei Spezifität ≥ 95 % auf der Kalibrierhälfte."""
    pos, neg = cal & pos_all, cal & neg_all
    best = None
    for t1 in np.arange(0.4, 0.95, 0.05):
        for t2 in np.arange(0.8, 0.995, 0.01):
            if t2 < t1: continue
            f = (irr & (p >= t1)) | (p >= t2)
            sp, se = 1 - f[neg].mean(), f[pos].mean()
            if sp >= 0.95 and (best is None or se > best[0]): best = (se, t1, t2)
    t95 = np.quantile(p[neg], 0.95)
    return best[1], best[2], t95

rng = np.random.default_rng(0)
res = {k: [] for k in ['rule_se', 'rule_sp', 'fus_se', 'fus_sp', 'prob_se', 'prob_sp', 'prob_ppv', 'ai_se', 'ai_sp', 'noise_fa']}
chosen = []
for split in range(20):
    cal = np.zeros(len(y), bool)
    for lab in ['N', 'A', 'O', '~']:
        idx = np.where(y == lab)[0]; rng.shuffle(idx); cal[idx[: len(idx) // 2]] = True
    test = ~cal
    t1, t2, t95 = choose(cal); chosen.append((t1, t2, t95))
    pos, neg = test & pos_all, test & neg_all
    f = (irr & (p >= t1)) | (p >= t2)
    hi = f & rule & (p >= t95) & (q >= 60)
    res['rule_se'].append(rule[pos].mean()); res['rule_sp'].append(1 - rule[neg].mean())
    res['fus_se'].append(f[pos].mean()); res['fus_sp'].append(1 - f[neg].mean())
    res['prob_se'].append(hi[pos].mean()); res['prob_sp'].append(1 - hi[neg].mean())
    res['prob_ppv'].append(hi[pos].sum() / max(1, hi[pos].sum() + hi[neg].sum()))
    res['ai_se'].append((p >= t95)[pos].mean()); res['ai_sp'].append(1 - (p >= t95)[neg].mean())
    res['noise_fa'].append(f[test & (y == '~')].mean())

out = {k: {'mean': round(float(np.mean(v)), 3), 'lo': round(float(np.percentile(v, 2.5)), 3), 'hi': round(float(np.percentile(v, 97.5)), 3)} for k, v in res.items()}
out['chosen_thresholds_median'] = {'t1': float(np.median([c[0] for c in chosen])), 't2': float(np.median([c[1] for c in chosen])), 't95': round(float(np.median([c[2] for c in chosen])), 3)}
out['n'] = {k: int((y == k).sum()) for k in ['N', 'A', 'O', '~']}
print(json.dumps(out, indent=1))
