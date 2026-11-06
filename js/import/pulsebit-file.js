// Dateiformate des Viatom Pulsebit EX (Quelle: Lepu-SDK PulsebitBleResponse.kt, ExEcgDiagnosis.java).

/** Liste der Aufnahmen „1dlc.dat“: 17-Byte-Datensätze. */
export function parseRecordList(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes.buffer ? bytes.buffer : bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let o = 0; o + 17 <= bytes.length; o += 17) {
    const y = dv.getUint16(o, true), mo = bytes[o + 2], d = bytes[o + 3], h = bytes[o + 4], mi = bytes[o + 5], s = bytes[o + 6];
    const p = v => String(v).padStart(2, '0');
    out.push({
      fileName: `${y}${p(mo)}${p(d)}${p(h)}${p(mi)}${p(s)}`,
      date: new Date(y, mo - 1, d, h, mi, s),
      hr: dv.getUint16(o + 7, true),
      user: bytes[o + 15], // 0 = Einzelmodus, 1/2 = Benutzer A/B
      raw: Array.from(bytes.subarray(o, o + 17)),
    });
  }
  return out;
}

// Ergebnisse als Sprachschlüssel (Übersetzung in js/locales/*.js)
export const DEVICE_RESULT_BITS = [
  [0x1, 'dr.fast'], [0x2, 'dr.slow'], [0x4, 'dr.irregular'], [0x8, 'dr.pvc'], [0x10, 'dr.pause'], [0x20, 'dr.af'],
  [0x40, 'dr.wideQrs'], [0x80, 'dr.qtcLong'], [0x100, 'dr.qtcShort'], [0x200, 'dr.stUp'], [0x400, 'dr.stDown'],
];

export function decodeDeviceResult(code) {
  if (code === 0) return ['dr.regular'];
  if (code === 0xffffffff) return ['dr.unable'];
  return DEVICE_RESULT_BITS.filter(([b]) => code & b).map(([, t]) => t);
}

const LEAD = { 1: 'lead.1', 3: 'lead.3', 2: 'lead.2', 4: 'lead.4', 5: 'lead.5', 6: 'lead.6' };
const MV_PER_LSB = 4033 / (32767 * 12 * 8);

/**
 * EKG-Datei (Name = yyyyMMddHHmmss, ohne Endung).
 * Kopf 44 Byte, danach Herzfrequenz je Sekunde (uint16), danach Kurve (int16, unkomprimiert).
 */
export function parseEcgFile(bytes, fileName = '') {
  if (bytes.length < 44) throw new Error('imp.tooShort');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hrsSize = dv.getUint16(0, true), waveSize = dv.getUint32(2, true);
  if (44 + hrsSize + waveSize > bytes.length || waveSize < 200 || hrsSize < 2) throw new Error('imp.badFormat');
  const duration = hrsSize / 2; // Sekunden
  const nSamples = Math.floor(waveSize / 2);
  // Abtastrate aus Probenzahl und Dauer ableiten (erwartet 250 Hz; SDK zeigt hochgetastet 500 Hz)
  let fs = duration > 0 ? nSamples / duration : 250;
  for (const cand of [125, 150, 200, 250, 300, 360, 500]) if (Math.abs(fs - cand) / cand < 0.04) { fs = cand; break; }
  if (!(fs >= 100 && fs <= 1000)) throw new Error('imp.badFormat');
  const hrs = [];
  for (let i = 0; i < hrsSize / 2; i++) hrs.push(dv.getUint16(44 + i * 2, true));
  const off = 44 + hrsSize, signal = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) signal[i] = dv.getInt16(off + i * 2, true) * MV_PER_LSB;
  const resultCode = dv.getUint32(16, true);
  const mode = bytes[20];
  let date = null;
  const m = /(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(fileName);
  if (m) date = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return {
    source: 'pulsebit', fileName, date, fs, signal, duration: nSamples / fs,
    device: {
      hr: dv.getUint16(6, true), st: dv.getInt16(8, true) / 100, qrs: dv.getUint16(10, true), pvcs: dv.getUint16(12, true),
      qtc: dv.getUint16(14, true), qt: dv.getUint16(22, true), resultCode, results: decodeDeviceResult(resultCode),
      lead: LEAD[mode] || 'lead.other', leadMode: mode, filterMode: bytes[21] === 1 ? 'breit' : 'normal', hrPerSecond: hrs,
    },
  };
}
