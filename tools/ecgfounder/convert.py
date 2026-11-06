#!/usr/bin/env python3
"""Konvertiert das ECGFounder-1-Kanal-Modell nach ONNX (Gewichte in fp16, Rechnung in fp32).

Aufruf (benötigt torch, onnx, onnxruntime, numpy, scipy):
    python convert.py 1_lead_ECGFounder.pth ../../models/ecgfounder-1lead.onnx [referenz-signal.json]

Quelle der Gewichte: https://huggingface.co/PKUDigitalHealth/ECGFounder (MIT)
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnx
import torch
from onnx import helper, numpy_helper, TensorProto

sys.path.insert(0, str(Path(__file__).parent))
from net1d import Net1D  # noqa: E402


def build_model():
    return Net1D(in_channels=1, base_filters=64, ratio=1,
                 filter_list=[64, 160, 160, 400, 400, 1024, 1024],
                 m_blocks_list=[2, 2, 2, 3, 3, 4, 4], kernel_size=16, stride=2,
                 groups_width=16, verbose=False, use_bn=False, use_do=False, n_classes=150)


def load_checkpoint(path):
    # weights_only=True: kein beliebiger Pickle-Code; numpy-Skalar (val_auroc) explizit erlauben
    safe = [np.core.multiarray.scalar, np.dtype]
    try:
        safe.append(type(np.dtype(np.float64)))
    except Exception:
        pass
    torch.serialization.add_safe_globals(safe)
    ck = torch.load(path, map_location='cpu', weights_only=True)
    return ck['state_dict'] if 'state_dict' in ck else ck


def weights_to_fp16(model_path_in, model_path_out):
    m = onnx.load(model_path_in)
    g = m.graph
    casts, new_inits = [], []
    for init in list(g.initializer):
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) > 16:
            arr = numpy_helper.to_array(init).astype(np.float16)
            h = numpy_helper.from_array(arr, init.name + '__fp16')
            new_inits.append(h)
            casts.append(helper.make_node('Cast', [h.name], [init.name], to=TensorProto.FLOAT))
            g.initializer.remove(init)
    g.initializer.extend(new_inits)
    nodes = casts + list(g.node)
    del g.node[:]
    g.node.extend(nodes)
    onnx.checker.check_model(m)
    onnx.save(m, model_path_out)


def preprocess(x, fs=500):
    """Exakt wie ECGFounder util.filter_bandpass + z-score."""
    from scipy.signal import iirnotch, filtfilt, butter, medfilt
    b, a = iirnotch(50, 30, fs)
    y = filtfilt(b, a, x)
    b, a = butter(N=4, Wn=[0.67, 40], btype='bandpass', fs=fs)
    y = filtfilt(b, a, y)
    k = int(0.4 * fs) + 1
    if k % 2 == 0:
        k += 1
    y = y - medfilt(y, kernel_size=k)
    return (y - y.mean()) / (y.std() + 1e-8)


def main():
    pth, out = Path(sys.argv[1]), Path(sys.argv[2])
    ref = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    model = build_model()
    missing = model.load_state_dict(load_checkpoint(pth), strict=True)
    print('state_dict geladen:', missing)
    model.eval()
    tmp = out.with_suffix('.fp32.onnx')
    torch.onnx.export(model, torch.randn(1, 1, 5000), str(tmp), input_names=['ecg'], output_names=['logits'],
                      opset_version=17, dynamic_axes={'ecg': {0: 'batch'}, 'logits': {0: 'batch'}})
    weights_to_fp16(str(tmp), str(out))
    tmp.unlink()
    print('ONNX geschrieben:', out, round(out.stat().st_size / 1e6, 1), 'MB')

    import onnxruntime as ort
    sess = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
    x = torch.randn(2, 1, 5000)
    with torch.no_grad():
        pt = model(x).numpy()
    ox = sess.run(None, {'ecg': x.numpy()})[0]
    print('max. Abweichung PyTorch vs. ONNX(fp16-Gewichte), Logits:', float(np.abs(pt - ox).max()),
          'Sigmoid:', float(np.abs(1 / (1 + np.exp(-pt)) - 1 / (1 + np.exp(-ox))).max()))

    if ref:
        # Referenz für den JS-Test: erste 10 s des Signals, auf 500 Hz gebracht
        d = json.loads(ref.read_text())
        sig, fs = np.asarray(d['signal'], dtype=np.float64), d['fs']
        t = np.arange(5000) / 500.0
        x500 = np.interp(t, np.arange(len(sig)) / fs, sig)
        pre = preprocess(x500).astype(np.float32)
        logits = sess.run(None, {'ecg': pre[None, None, :]})[0][0]
        probs = 1 / (1 + np.exp(-logits))
        labels = (Path(__file__).parent / 'tasks.txt').read_text().strip().split('\n')
        top = np.argsort(-probs)[:10]
        print('Top-10 für Referenz:', [(labels[i], round(float(probs[i]), 3)) for i in top])
        refout = ref.with_suffix('.ecgfounder-ref.json')
        refout.write_text(json.dumps({'input500': x500.tolist(), 'preprocessed': pre.tolist(), 'probs': probs.tolist()}))
        print('Referenz geschrieben:', refout)


if __name__ == '__main__':
    main()
