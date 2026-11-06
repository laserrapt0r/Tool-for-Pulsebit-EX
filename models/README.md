# ECGFounder 1-lead (ONNX)

`ecgfounder-1lead.onnx` is a conversion of the single-lead checkpoint of
**ECGFounder** (Li et al., *NEJM AI* 2025) – https://github.com/PKUDigitalHealth/ECGFounder ·
weights: https://huggingface.co/PKUDigitalHealth/ECGFounder (MIT License, © PKUDigitalHealth).

Converted with `tools/ecgfounder/convert.py` (weights stored as fp16, computation in fp32;
max. deviation vs. PyTorch ≈ 0.035 in probability). Input: 1×1×5000 (10 s @ 500 Hz, lead I,
preprocessing as in the original repo), output: 150 logits (labels: `js/ai/labels.json`).
