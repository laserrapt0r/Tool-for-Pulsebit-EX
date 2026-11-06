// Simuliert ein Pulsebit EX (Antwortformat laut Lepu-SDK) und testet Client + Parser.
import { ViatomClient, crc8, buildFrame } from '../js/device/viatom-protocol.js';
import { parseRecordList, parseEcgFile } from '../js/import/pulsebit-file.js';
import { analyze } from '../js/dsp/analysis.js';
import { synthEcg } from '../js/demo.js';

// CRC-Prüfung gegen Tabellenwerte des SDK (Table_CRC8[1]=0x07, [2]=0x0E, [3]=0x09)
console.assert(crc8([1]) === 0x07 && crc8([2]) === 0x0e && crc8([3]) === 0x09, 'CRC-Tabelle');
console.log('GET_INFO-Rahmen:', Buffer.from(buildFrame(0x14)).toString('hex'));

// Testdatei bauen: 30 s, 250 Hz, synthetisches EKG mit SVES
const { fs, signal } = synthEcg('pac');
const n = 30 * 250, wave = new Int16Array(n);
for (let i = 0; i < n; i++) { const t = i / 250 * fs; wave[i] = Math.round(signal[Math.min(signal.length - 1, Math.floor(t))] / (4033 / (32767 * 12 * 8))); }
const hdr = new Uint8Array(44), dv = new DataView(hdr.buffer);
dv.setUint16(0, 60, true); dv.setUint32(2, n * 2, true); dv.setUint16(6, 72, true); dv.setInt16(8, 3, true); dv.setUint16(10, 96, true);
dv.setUint16(14, 412, true); dv.setUint32(16, 0x4, true); hdr[20] = 1; dv.setUint16(22, 380, true);
const hrs = new Uint8Array(60); for (let i = 0; i < 30; i++) hrs[i * 2] = 72;
const ecgFile = new Uint8Array([...hdr, ...hrs, ...new Uint8Array(wave.buffer)]);
const list = new Uint8Array(17 * 2);
const rec = (o, y, mo, d, h, mi, s, hr) => { const v = new DataView(list.buffer); v.setUint16(o, y, true); list.set([mo, d, h, mi, s], o + 2); v.setUint16(o + 7, hr, true); };
rec(0, 2025, 1, 2, 3, 4, 5, 72); rec(17, 2025, 1, 2, 8, 0, 0, 65);
const files = { '1dlc.dat': list, '20250102030405': ecgFile };

function fakeDevice() {
  let cb, cur = null;
  const resp = (status, seq, content = new Uint8Array(0)) => {
    const f = new Uint8Array(8 + content.length);
    f[0] = 0x55; f[1] = status; f[2] = ~status & 0xff; f[3] = seq & 0xff; f[4] = seq >> 8; f[5] = content.length & 0xff; f[6] = content.length >> 8;
    f.set(content, 7); f[f.length - 1] = crc8(f, f.length - 1);
    // in kleinen Stücken wie BLE-Notifications (20 Byte)
    for (let i = 0; i < f.length; i += 20) { const part = f.slice(i, i + 20); setTimeout(() => cb(part), 0); }
  };
  return {
    onData: f => (cb = f),
    async write(b) {
      if (b[0] !== 0xaa || b[2] !== (~b[1] & 0xff) || crc8(b, b.length - 1) !== b[b.length - 1]) throw new Error('ungültiger Rahmen');
      const cmd = b[1], seq = b[3] | (b[4] << 8), len = b[5] | (b[6] << 8), pl = b.slice(7, 7 + len);
      if (cmd === 0x14) resp(0, 0, new TextEncoder().encode('{"Model":"PB20","SN":"0000","SoftwareVer":"1.2.0"}'));
      else if (cmd === 0x16) resp(0, 0);
      else if (cmd === 0x03) { const name = new TextDecoder().decode(pl).replace(/\0.*$/, ''); cur = files[name]; if (!cur) return resp(1, 0); const c = new Uint8Array(4); new DataView(c.buffer).setUint32(0, cur.length, true); resp(0, 0, c); }
      else if (cmd === 0x04) resp(0, seq, cur.slice(seq * 512, seq * 512 + 512));
      else if (cmd === 0x05) { cur = null; resp(0, 0); }
    },
  };
}

const c = new ViatomClient(fakeDevice());
console.log('Info:', await c.getInfo());
console.log('Zeit gesetzt:', await c.setTime(new Date(2025, 0, 2, 20, 0, 0)));
const l = parseRecordList(await c.readFile('1dlc.dat'));
console.log('Liste:', l.map(r => `${r.fileName} HF ${r.hr}`));
console.log('Fehlende Datei →', await c.readFile('20250102080000'));
let last = 0;
const bytes = await c.readFile(l[0].fileName, (g, s) => (last = g / s));
const e = parseEcgFile(bytes, l[0].fileName);
console.log('EKG-Datei:', e.fs, 'Hz', e.duration, 's', 'Gerät:', e.device.results, e.device.lead, 'Fortschritt', last);
const a = analyze(e.signal, e.fs);
console.log('Analyse: HF', a.hrNN, 'Typen', a.beats.map(b => b.type).join(''));
