// USB-Protokoll des Pulsebit EX / Checkme Lite (in Checkme Browser Pro intern „sdumper2“).
// Ermittelt aus einem USB-Mitschnitt (tools/linux/usb-capture.py) und der Disassemblierung von Checkme Browser Pro 2.5.3.
//
// Transport: USB-HID, 64-Byte-Berichte (Report-ID 0), Ausgabe per SET_REPORT, Eingabe per Interrupt-Endpunkt.
// Anfrage:  1152 Byte  AC cmd 00 00 … Dateiname ab Byte 15 (nullterminiert) … crc8 (Byte 1151)
// Antwort:   640 Byte  CA status … Nutzdaten ab Byte 4 … crc8 (Byte 639)        status 0 = OK
// Begrüßung: 640 × 0x43 (ohne Prüfsumme) → Antwort mit Seriennummer. Am Gerät geprüft: Sie muss nach dem Einstecken
//            die ALLERERSTE Nachricht sein und darf nur EINMAL kommen. Erst ein anderer Befehl oder eine zweite
//            Begrüßung → das Gerät blockiert jede Anfrage (Broken pipe), bis es neu eingesteckt wird.
//            Ob schon begrüßt wurde, merkt sich die Transportschicht (transports.js) je Steckvorgang.
// CRC-8: Polynom 0x07, Startwert 0 (wie beim Bluetooth-Protokoll).
//
// Verwendet werden nur lesende Befehle: 0x21 Geräteinfo (JSON), 0x1B Dateianzahl, 0x0B Dateigröße,
// 0x0C nächster Datenblock (bis 635 Byte, das Gerät führt die Position selbst), 0x0D Lesen beenden.

import { crc8 } from './viatom-protocol.js';
import { t } from '../i18n.js';

export const SD = { INFO: 0x21, FILE_COUNT: 0x1b, FILE_SIZE: 0x0b, FILE_DATA: 0x0c, FILE_END: 0x0d };
export const REQ_LEN = 0x480, RESP_LEN = 0x280, NAME_OFF = 15, DATA_OFF = 4, DATA_MAX = RESP_LEN - DATA_OFF - 1;

const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Befehlsrahmen (1152 Byte) mit optionalem Dateinamen. */
export function buildSdFrame(cmd, name = '') {
  const f = new Uint8Array(REQ_LEN);
  f[0] = 0xac; f[1] = cmd;
  const nb = enc.encode(name);
  if (nb.length > REQ_LEN - NAME_OFF - 2) throw new Error('Dateiname zu lang');
  f.set(nb, NAME_OFF);
  f[REQ_LEN - 1] = crc8(f, REQ_LEN - 1);
  return f;
}

export const helloFrame = () => new Uint8Array(RESP_LEN).fill(0x43);

/** Prüft eine 640-Byte-Antwort. */
export function parseSdResponse(b) {
  const valid = b.length >= RESP_LEN && b[0] === 0xca && crc8(b, RESP_LEN - 1) === b[RESP_LEN - 1];
  return { valid, status: b[1], data: b.subarray(DATA_OFF, RESP_LEN - 1), u32: b.length >= 8 ? new DataView(b.buffer, b.byteOffset).getUint32(DATA_OFF, true) : 0 };
}

/** Gleiche Schnittstelle wie ViatomClient (getInfo, setTime, readFile) – für die USB-Verbindung. */
export class SdumperClient {
  constructor(transport, { log = () => {}, timeoutMs = 4000 } = {}) {
    this.t = transport; this.log = log; this.timeoutMs = timeoutMs;
    this.buf = new Uint8Array(0); this.pending = null;
    this.session = transport.session || { greeted: false, markGreeted() { this.greeted = true; }, reset() { this.greeted = false; } };
    transport.onData(bytes => {
      const n = new Uint8Array(this.buf.length + bytes.length);
      n.set(this.buf); n.set(bytes, this.buf.length); this.buf = n;
      if (this.pending && this.buf.length >= RESP_LEN) {
        const p = this.pending; this.pending = null; clearTimeout(p.timer);
        const r = this.buf.slice(0, RESP_LEN); this.buf = this.buf.slice(RESP_LEN);
        this.log('RX', r.subarray(0, 48));
        p.resolve(r);
      }
    });
  }

  /** Sendet einen Rahmen und wartet auf genau eine 640-Byte-Antwort. */
  async exchange(frame, label, timeoutMs = this.timeoutMs) {
    if (this.pending) throw new Error(t('dev.busy'));
    this.buf = new Uint8Array(0); // Reste einer abgebrochenen Antwort verwerfen
    const res = new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => { this.pending = null; reject(new Error(t('dev.noAnswer', { cmd: label }))); }, timeoutMs) };
    });
    this.log('TX', `${label} (${frame.length} B) ${Array.from(frame.subarray(0, 4), x => x.toString(16).padStart(2, '0')).join(' ')}`);
    await this.t.write(frame);
    return parseSdResponse(await res);
  }

  async command(cmd, name = '', timeoutMs) {
    return this.exchange(buildSdFrame(cmd, name), `0x${cmd.toString(16)}${name ? ' ' + name : ''}`, timeoutMs);
  }

  /** Begrüßung (genau einmal je Steckvorgang, als erste Nachricht): liefert die Seriennummer. */
  async hello() {
    const r = await this.exchange(helloFrame(), 'hello');
    this.session.markGreeted();
    await sleep(30);
    if (!r.valid || r.status !== 0) throw new Error(t('dev.readErr', { name: 'hello', s: r.status }));
    return { SN: dec.decode(r.data.subarray(5, 15)).replace(/\0.*$/, '') };
  }

  async getInfo() {
    try {
      const h = this.session.greeted ? null : await this.hello();
      const r = await this.command(SD.INFO);
      if (!r.valid || r.status !== 0) throw new Error(t('dev.readErr', { name: 'info', s: r.status }));
      return this.infoFrom(r, h);
    } catch (e) {
      // Gerät blockiert (falsche Reihenfolge, Checkme Browser parallel, …): nur Neueinstecken hilft
      this.session.reset();
      this.log('ERROR', e.message);
      throw new Error(t('dev.usbReplug'));
    }
  }

  infoFrom(r, h) {
    const txt = dec.decode(r.data).replace(/\0[\s\S]*$/, '');
    let j = {};
    try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    // Das Gerät liefert Schlüssel mit Doppelpunkt („SN:“) – vereinheitlichen
    const info = Object.fromEntries(Object.entries(j).map(([k, v]) => [k.replace(/:$/, ''), v]));
    return { Model: 'Pulsebit EX / Checkme (USB)', SoftwareVer: info.HW ? `HW ${info.HW}` : '?', ...h, ...info };
  }

  /** Über USB ist kein Befehl zum Stellen der Uhr bekannt. */
  async setTime() { return false; }

  /** Anzahl Dateien laut Gerät (nur zur Diagnose; das Gerät braucht dafür bis zu 15 s). */
  async fileCount() {
    const r = await this.command(SD.FILE_COUNT, '', 15000);
    return r.valid && r.status === 0 ? r.u32 : null;
  }

  /** Liest eine Datei vollständig. onProgress(empfangen, gesamt). null, wenn die Datei nicht existiert. */
  async readFile(name, onProgress = () => {}) {
    const start = await this.command(SD.FILE_SIZE, name, 15000);
    if (!start.valid || start.status !== 0) { this.log('INFO', `${name}: Status ${start.status}`); return null; }
    const size = start.u32;
    if (size > 64 * 1024 * 1024) throw new Error(t('dev.readErr', { name, s: 'size ' + size }));
    const out = new Uint8Array(size);
    let got = 0;
    try {
      while (got < size) {
        const r = await this.command(SD.FILE_DATA, name);
        if (!r.valid || r.status !== 0) throw new Error(t('dev.readErr', { name, s: r.status }));
        const n = Math.min(size - got, DATA_MAX);
        out.set(r.data.subarray(0, n), got);
        got += n;
        onProgress(got, size);
      }
    } finally {
      try { await this.command(SD.FILE_END); } catch { /* Ende ist optional */ }
    }
    return out;
  }
}
