// Automatisch erzeugt von tools/calibration/calibrate.py – nicht von Hand ändern.
// Vorhofflimmern: Schwelle bei 95 % Spezifität; übrige: 97,5-%-Quantil bei Normal-EKGs.
export const THRESHOLDS = {
  "ATRIAL FIBRILLATION": 0.812,
  "ATRIAL FLUTTER": 0.391,
  "PREMATURE ATRIAL COMPLEXES": 0.485,
  "PREMATURE SUPRAVENTRICULAR COMPLEXES": 0.553,
  "PREMATURE VENTRICULAR COMPLEXES": 0.971,
  "IN A PATTERN OF BIGEMINY": 0.765,
  "WITH 1ST DEGREE AV BLOCK": 0.3,
  "SUPRAVENTRICULAR TACHYCARDIA": 0.3,
  "VENTRICULAR TACHYCARDIA": 0.3,
  "JUNCTIONAL RHYTHM": 0.3,
  "SINUS BRADYCARDIA": 0.942,
  "SINUS TACHYCARDIA": 0.77,
  "WITH SINUS ARRHYTHMIA": 0.337,
  "SINUS RHYTHM": 0.5
};
export const CALIBRATION = {
  "dataset": "PhysioNet/CinC Challenge 2017 (AliveCor, 1 Kanal, 300 Hz)",
  "n": {
    "N": 1500,
    "A": 758,
    "O": 1000,
    "~": 279
  },
  "af": {
    "auc": 0.9742,
    "f1_best": 0.868,
    "thr_f1": 0.84,
    "thr_spec95": 0.812,
    "sens_at_spec95": 0.88,
    "thr_spec98": 0.916,
    "sens_at_spec98": 0.756,
    "spec_at_f1": 0.961,
    "sens_at_f1": 0.864
  },
  "other": {
    "SINUS RHYTHM": {
      "median_N": 0.993,
      "q975_N": 0.998,
      "mean_A": 0.821,
      "mean_O": 0.916,
      "mean_noise": 0.892
    },
    "ATRIAL FLUTTER": {
      "median_N": 0.103,
      "q975_N": 0.391,
      "mean_A": 0.344,
      "mean_O": 0.185,
      "mean_noise": 0.162
    },
    "PREMATURE ATRIAL COMPLEXES": {
      "median_N": 0.105,
      "q975_N": 0.485,
      "mean_A": 0.199,
      "mean_O": 0.336,
      "mean_noise": 0.172
    },
    "PREMATURE SUPRAVENTRICULAR COMPLEXES": {
      "median_N": 0.156,
      "q975_N": 0.553,
      "mean_A": 0.141,
      "mean_O": 0.267,
      "mean_noise": 0.242
    },
    "PREMATURE VENTRICULAR COMPLEXES": {
      "median_N": 0.628,
      "q975_N": 0.971,
      "mean_A": 0.351,
      "mean_O": 0.613,
      "mean_noise": 0.72
    },
    "IN A PATTERN OF BIGEMINY": {
      "median_N": 0.046,
      "q975_N": 0.765,
      "mean_A": 0.015,
      "mean_O": 0.093,
      "mean_noise": 0.083
    },
    "WITH 1ST DEGREE AV BLOCK": {
      "median_N": 0.0,
      "q975_N": 0.0,
      "mean_A": 0.0,
      "mean_O": 0.0,
      "mean_noise": 0.0
    },
    "SUPRAVENTRICULAR TACHYCARDIA": {
      "median_N": 0.039,
      "q975_N": 0.102,
      "mean_A": 0.087,
      "mean_O": 0.077,
      "mean_noise": 0.075
    },
    "VENTRICULAR TACHYCARDIA": {
      "median_N": 0.06,
      "q975_N": 0.163,
      "mean_A": 0.105,
      "mean_O": 0.105,
      "mean_noise": 0.133
    },
    "JUNCTIONAL RHYTHM": {
      "median_N": 0.068,
      "q975_N": 0.212,
      "mean_A": 0.058,
      "mean_O": 0.077,
      "mean_noise": 0.09
    },
    "SINUS BRADYCARDIA": {
      "median_N": 0.07,
      "q975_N": 0.942,
      "mean_A": 0.139,
      "mean_O": 0.245,
      "mean_noise": 0.162
    },
    "SINUS TACHYCARDIA": {
      "median_N": 0.22,
      "q975_N": 0.77,
      "mean_A": 0.359,
      "mean_O": 0.334,
      "mean_noise": 0.413
    },
    "WITH SINUS ARRHYTHMIA": {
      "median_N": 0.032,
      "q975_N": 0.337,
      "mean_A": 0.051,
      "mean_O": 0.045,
      "mean_noise": 0.043
    }
  },
  "af_auc_vs_noise": 0.9
};
