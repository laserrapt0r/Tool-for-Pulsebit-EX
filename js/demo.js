// Synthetische 1-Kanal-EKGs (Ableitung I) für Demo und Tests. Keine echten Patientendaten.
// Jeder Schlag = Summe von Gauß-Wellen (P, Q, R, S, T), angelehnt an McSharry et al. (ECGSYN).

function rng(seed) { // reproduzierbarer Zufall (mulberry32)
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (t, mu, sd, amp) => amp * Math.exp(-0.5 * ((t - mu) / sd) ** 2);

// Wellenformen relativ zur R-Zacke (Sekunden, mV)
const NORMAL = [[-0.17, 0.025, 0.12], [-0.03, 0.009, -0.08], [0, 0.011, 1.1], [0.032, 0.01, -0.22], [0.28, 0.045, 0.3]];
const NO_P = NORMAL.slice(1);
const WIDE = [[-0.04, 0.03, -0.15], [0, 0.03, 1.3], [0.07, 0.035, -0.6], [0.3, 0.06, -0.35]]; // VES: breit, diskordantes T

/**
 * @param {'normal'|'pac'|'af'|'pvc'|'brady'|'tachy'|'noisy'} kind
 * @returns {{signal: Float32Array, fs: number, kind: string, truth: string}}
 */
export function synthEcg(kind = 'normal', { seconds = 30, fs = 250, seed = 1 } = {}) {
  const r = rng(seed), n = seconds * fs, x = new Float32Array(n);
  const beats = []; // [zeit, wellen]
  let t = 0.4, i = 0;
  const base = { normal: 0.88, pac: 0.86, af: 0.72, pvc: 0.9, brady: 1.25, tachy: 0.52, noisy: 0.85 }[kind] ?? 0.88;
  let prevPremature = false;
  while (t < seconds - 0.3) {
    // Wellen dieses Schlags (vorzeitige Schläge erhalten ihre Form hier, der kurze Abstand liegt davor)
    const isPAC = kind === 'pac' && i % 7 === 4, isPVC = kind === 'pvc' && i % 2 === 1;
    let w = kind === 'af' ? NO_P : isPVC ? WIDE : isPAC ? [[-0.12, 0.02, 0.07], ...NORMAL.slice(1)] : NORMAL;
    beats.push([t, w]);
    // Abstand zum nächsten Schlag
    let rr = base * (1 + 0.04 * Math.sin(2 * Math.PI * t / 4.5)) + (r() - 0.5) * 0.02;
    if (kind === 'af') rr = base * (0.6 + r() * 0.85);
    const nextPAC = kind === 'pac' && (i + 1) % 7 === 4, nextPVC = kind === 'pvc' && (i + 1) % 2 === 1;
    if (nextPAC) rr = base * 0.62;
    if (nextPVC) rr = base * 0.68;
    if (isPVC) rr = 2 * base - base * 0.68; // volle kompensatorische Pause
    if (isPAC) rr = base * 0.95;            // nicht kompensatorisch
    t += rr; i++; prevPremature = nextPAC || nextPVC;
  }
  for (const [bt, w] of beats) {
    const s0 = Math.max(0, Math.floor((bt - 0.5) * fs)), s1 = Math.min(n, Math.ceil((bt + 0.7) * fs));
    const qtScale = Math.sqrt(Math.min(1.3, Math.max(0.45, base)) / 0.88); // T-Welle rückt bei hoher Frequenz näher
    for (let k = s0; k < s1; k++) { const tt = k / fs - bt; for (const [mu, sd, amp] of w) x[k] += gauss(tt, mu > 0.15 ? mu * qtScale : mu, sd, amp); }
  }
  for (let k = 0; k < n; k++) {
    const tt = k / fs;
    x[k] += 0.08 * Math.sin(2 * Math.PI * 0.25 * tt + 0.3) + (r() - 0.5) * 0.02; // Atmung + Rauschen
    if (kind === 'af') x[k] += 0.04 * Math.sin(2 * Math.PI * 6.3 * tt) * (0.6 + 0.4 * Math.sin(tt)); // Flimmerwellen
    if (kind === 'noisy') x[k] += (r() - 0.5) * 0.35 + 0.15 * Math.sin(2 * Math.PI * 1.7 * tt);
  }
  const truth = { normal: 'sinus', pac: 'sinus+sves', af: 'af', pvc: 'sinus+ves-bigeminy', brady: 'sinus-brady', tachy: 'sinus-tachy', noisy: 'noise' }[kind];
  return { signal: x, fs, kind, truth };
}

export const DEMO_KINDS = ['normal', 'pac', 'af', 'pvc'];
