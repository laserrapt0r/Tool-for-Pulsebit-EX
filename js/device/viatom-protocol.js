// Viatom/Lepu-Geräteprotokoll (Pulsebit EX, HHM4 u. a.), transportunabhängig (BLE oder USB-HID).
// Quelle: Lepu-SDK (github.com/viatomEcho/LepuBle: PulsebitBleCmd.java, PulsebitBleInterface.kt, BleCRC.java)
//
// Anfrage: AA cmd ~cmd seqLo seqHi lenLo lenHi payload… crc8
// Antwort: 55 status ~status seqLo seqHi lenLo lenHi content… crc8   (status 0 = OK)

import { t } from '../i18n.js';

export const CMD = { GET_INFO: 0x14, SET_TIME: 0x16, READ_FILE_START: 0x03, READ_FILE_DATA: 0x04, READ_FILE_END: 0x05 };

export function crc8(bytes, len = bytes.length) {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export function buildFrame(cmd, seq = 0, payload = new Uint8Array(0)) {
  const f = new Uint8Array(8 + payload.length);
  f[0] = 0xaa; f[1] = cmd; f[2] = ~cmd & 0xff;
  f[3] = seq & 0xff; f[4] = (seq >> 8) & 0xff;
  f[5] = payload.length & 0xff; f[6] = (payload.length >> 8) & 0xff;
  f.set(payload, 7);
  f[f.length - 1] = crc8(f, f.length - 1);
  return f;
}

/** Sammelt eingehende Bytes und liefert vollständige, CRC-geprüfte Antworten. */
export class FrameParser {
  constructor() { this.buf = new Uint8Array(0); }
  /** Position des nächsten vollständigen, CRC-gültigen Rahmens ab 'from' (oder -1). */
  validAt(b, from) {
    for (let j = from; j + 8 <= b.length; j++) {
      if (b[j] !== 0x55 || b[j + 2] !== (~b[j + 1] & 0xff)) continue;
      const l = b[j + 5] | (b[j + 6] << 8);
      if (l > 2048 || j + 8 + l > b.length) continue;
      if (crc8(b.subarray(j, j + 8 + l), 7 + l) === b[j + 7 + l]) return j;
    }
    return -1;
  }
  push(chunk) {
    const n = new Uint8Array(this.buf.length + chunk.length);
    n.set(this.buf); n.set(chunk, this.buf.length);
    this.buf = n;
    const frames = [];
    let i = 0;
    while (i + 8 <= this.buf.length) {
      const b = this.buf;
      if (b[i] !== 0x55 || b[i + 2] !== (~b[i + 1] & 0xff)) { i++; continue; }
      const len = b[i + 5] | (b[i + 6] << 8);
      if (len > 2048) { i++; continue; } // unplausibel: Scheinkopf im Datenstrom überspringen
      if (i + 8 + len > b.length) {
        // unvollständig – außer es folgt bereits ein vollständiger, gültiger Rahmen (dann war das ein Scheinkopf)
        if (this.validAt(b, i + 1) >= 0) { i = this.validAt(b, i + 1); continue; }
        break;
      }
      const frame = b.subarray(i, i + 8 + len);
      if (crc8(frame, frame.length - 1) !== frame[frame.length - 1]) { i++; continue; }
      frames.push({ status: frame[1], seq: frame[3] | (frame[4] << 8), content: frame.slice(7, 7 + len) });
      i += 8 + len;
    }
    this.buf = this.buf.slice(i);
    return frames;
  }
}

const enc = new TextEncoder(), dec = new TextDecoder();
const pad2 = v => String(v).padStart(2, '0');

/**
 * Protokoll-Client. transport: { write(Uint8Array): Promise, onData(cb), close() }
 * log: optionale Funktion für Mitschnitte (Fehlersuche).
 */
export class ViatomClient {
  constructor(transport, { log = () => {}, timeoutMs = 5000 } = {}) {
    this.t = transport; this.log = log; this.timeoutMs = timeoutMs;
    this.parser = new FrameParser();
    this.pending = null;
    transport.onData(bytes => {
      this.log('RX', bytes);
      for (const f of this.parser.push(bytes)) {
        if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve(f); }
      }
    });
  }

  /** Sendet einen Befehl und wartet auf genau eine Antwort (das Gerät bearbeitet nur einen Befehl gleichzeitig). */
  async request(cmd, seq = 0, payload) {
    if (this.pending) throw new Error(t('dev.busy'));
    const frame = buildFrame(cmd, seq, payload);
    const res = new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => { this.pending = null; reject(new Error(t('dev.noAnswer', { cmd: '0x' + cmd.toString(16) }))); }, this.timeoutMs) };
    });
    this.log('TX', frame);
    await this.t.write(frame);
    return res;
  }

  async getInfo() {
    const r = await this.request(CMD.GET_INFO);
    const txt = dec.decode(r.content).replace(/\0+$/, '');
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  }

  async setTime(d = new Date()) {
    const s = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())},${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const r = await this.request(CMD.SET_TIME, 0, enc.encode(JSON.stringify({ SetTIME: s })));
    return r.status === 0;
  }

  /** Liest eine Datei vollständig. onProgress(empfangen, gesamt). Gibt null zurück, wenn die Datei nicht existiert. */
  async readFile(name, onProgress = () => {}) {
    const nameBytes = enc.encode(name);
    const p = new Uint8Array(nameBytes.length + 1); p.set(nameBytes);
    const start = await this.request(CMD.READ_FILE_START, 0, p);
    if (start.status !== 0 || start.content.length < 4) return null;
    const size = new DataView(start.content.buffer, start.content.byteOffset).getUint32(0, true);
    const out = new Uint8Array(size);
    let got = 0, seq = 0;
    try {
      while (got < size) {
        const r = await this.request(CMD.READ_FILE_DATA, seq++);
        if (r.status !== 0) throw new Error(t('dev.readErr', { name, s: r.status }));
        if (!r.content.length) throw new Error(t('dev.emptyBlock', { name }));
        out.set(r.content.subarray(0, size - got), got);
        got += r.content.length;
        onProgress(Math.min(got, size), size);
      }
    } finally {
      try { await this.request(CMD.READ_FILE_END); } catch { /* Ende ist optional */ }
    }
    return out;
  }
}
