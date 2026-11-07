// Simuliert den Pulsebit EX am USB (sdumper2, Verhalten aus dem Mitschnitt) und testet SdumperClient + Parser.
import { SdumperClient, buildSdFrame, helloFrame, SD, REQ_LEN, RESP_LEN } from '../js/device/sdumper-protocol.js';
import { crc8 } from '../js/device/viatom-protocol.js';
import { parseRecordList, parseEcgFile } from '../js/import/pulsebit-file.js';
import { analyze } from '../js/dsp/analysis.js';
import { synthEcg } from '../js/demo.js';

let fail = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? 'ok  ' : 'FEHL'} ${name}${info ? ' – ' + info : ''}`); if (!cond) fail++; };

// Rahmen müssen exakt denen von Checkme Browser entsprechen (Mitschnitt: Info-Befehl endet auf CRC 0x7b)
const info = buildSdFrame(SD.INFO);
check('Info-Rahmen wie Checkme Browser', info.length === 1152 && info[0] === 0xac && info[1] === 0x21 && info[1151] === 0x7b);
check('Begrüßung = 640 × 0x43', helloFrame().length === 640 && helloFrame().every(v => v === 0x43));

// Testdateien wie im Bluetooth-Test
const { fs, signal } = synthEcg('pac');
const n = 30 * 250, wave = new Int16Array(n);
for (let i = 0; i < n; i++) wave[i] = Math.round(signal[Math.min(signal.length - 1, Math.floor(i / 250 * fs))] / (4033 / (32767 * 12 * 8)));
const hdr = new Uint8Array(44), dv = new DataView(hdr.buffer);
dv.setUint16(0, 60, true); dv.setUint32(2, n * 2, true); dv.setUint16(6, 72, true); dv.setInt16(8, 3, true); dv.setUint16(10, 96, true);
dv.setUint16(14, 412, true); dv.setUint32(16, 0x4, true); hdr[20] = 1; dv.setUint16(22, 380, true);
const hrs = new Uint8Array(60); for (let i = 0; i < 30; i++) hrs[i * 2] = 72;
const ecgFile = new Uint8Array([...hdr, ...hrs, ...new Uint8Array(wave.buffer)]);
const list = new Uint8Array(17 * 2);
const rec = (o, y, mo, d, h, mi, s, hr) => { const v = new DataView(list.buffer); v.setUint16(o, y, true); list.set([mo, d, h, mi, s], o + 2); v.setUint16(o + 7, hr, true); };
rec(0, 2025, 1, 2, 3, 4, 5, 72); rec(17, 2025, 1, 2, 8, 0, 0, 65);
const files = { '1dlc.dat': list, '20250102030405': ecgFile };

function fakeUsbDevice({ session } = {}) {
  let cb, rx = new Uint8Array(0), greetings = 0, cur = null, pos = 0, broken = false;
  const stats = { frames: [] };
  const respond = (status, payload = new Uint8Array(0)) => {
    const r = new Uint8Array(RESP_LEN).fill(0x43);
    r[0] = 0xca; r[1] = status; r[2] = 0; r[3] = 0; r.set(payload.subarray(0, RESP_LEN - 5), 4);
    r[RESP_LEN - 1] = crc8(r, RESP_LEN - 1);
    for (let i = 0; i < RESP_LEN; i += 64) { const part = r.slice(i, i + 64); setTimeout(() => cb(part), 0); }
  };
  const handle = f => {
    if (f.length === RESP_LEN && f.every(v => v === 0x43)) {
      stats.frames.push('hello');
      if (++greetings > 1) { broken = true; return; } // echtes Gerät: keine Antwort, danach Blockade
      const p = new Uint8Array(30); p.set(new TextEncoder().encode('2611700031'), 5); return respond(0, p);
    }
    if (f[0] !== 0xac || crc8(f, REQ_LEN - 1) !== f[REQ_LEN - 1]) throw new Error('ungültiger Rahmen');
    if (!greetings) { broken = true; stats.frames.push('blockiert'); return; } // echtes Gerät: erste Nachricht muss die Begrüßung sein
    const cmd = f[1], name = new TextDecoder().decode(f.subarray(15, 200)).replace(/\0[\s\S]*$/, '');
    stats.frames.push(cmd.toString(16));
    if (cmd === 0x21) return respond(0, new TextEncoder().encode('{"BranchCode:":"15080001", "SN:":"2611700031","HW:":"CC"}\0'));
    if (cmd === 0x0b) { cur = files[name]; pos = 0; if (!cur) return respond(1); const s = new Uint8Array(4); new DataView(s.buffer).setUint32(0, cur.length, true); return respond(0, s); }
    if (cmd === 0x0c) { if (!cur || files[name] !== cur) return respond(2); const blk = cur.subarray(pos, pos + 635); pos += 635; return respond(0, blk); }
    if (cmd === 0x0d) { cur = null; return respond(0); }
    if (cmd === 0x1b) { const s = new Uint8Array(4); new DataView(s.buffer).setUint32(0, Object.keys(files).length, true); return respond(0, s); }
    throw new Error('unerwarteter Befehl 0x' + cmd.toString(16));
  };
  return {
    stats, kind: 'USB', name: 'Checkme Lite', session,
    replug() { broken = false; greetings = 0; rx = new Uint8Array(0); },
    onData: f => (cb = f),
    async write(bytes) {
      if (broken) { await Promise.resolve(); throw new Error('Broken pipe'); }
      // wie WebHID: 64-Byte-Berichte; Rahmen erst nach vollständigem Empfang auswerten
      for (let i = 0; i < bytes.length; i += 64) {
        const n = new Uint8Array(rx.length + 64); n.set(rx); n.set(bytes.subarray(i, i + 64), rx.length); rx = n;
        const need = rx[0] === 0x43 ? RESP_LEN : REQ_LEN;
        if (rx.length >= need) { const f = rx.slice(0, need); rx = rx.slice(need); handle(f); }
      }
    },
    close() {},
  };
}

// Sitzungsmerker wie in transports.js (je Steckvorgang)
const mkSession = () => ({ greeted: false, markGreeted() { this.greeted = true; }, reset() { this.greeted = false; } });
const sess = mkSession();
const dev = fakeUsbDevice({ session: sess });
let c = new SdumperClient(dev, { timeoutMs: 300 });
const inf = await c.getInfo();
check('frisches Gerät: Begrüßung zuerst, Geräteinfo', inf.SN === '2611700031' && inf.BranchCode === '15080001' && dev.stats.frames[0] === 'hello', JSON.stringify(inf));
// Neuer Verbindungsaufbau (zweiter Klick / Seite neu geladen) bei gestecktem Gerät: keine zweite Begrüßung
const c1 = new SdumperClient(dev, { timeoutMs: 300 });
await c1.getInfo();
check('erneutes Verbinden ohne zweite Begrüßung', dev.stats.frames.filter(x => x === 'hello').length === 1, dev.stats.frames.join(','));
c = c1; // das Gerät liefert seine Antworten an die zuletzt verbundene Instanz
// Merker falsch (Gerät wurde bei geschlossener Seite neu eingesteckt): klare Meldung, Merker gelöscht, nach Neueinstecken klappt es
const dev2 = fakeUsbDevice({ session: Object.assign(mkSession(), { greeted: true }) });
const c2 = new SdumperClient(dev2, { timeoutMs: 300 });
let msg = '';
try { await c2.getInfo(); } catch (e) { msg = e.message; }
check('veralteter Merker → Hinweis „neu einstecken“', msg === 'dev.usbReplug' || /abziehen|unplug/i.test(msg), msg);
check('  … Merker zurückgesetzt', dev2.session.greeted === false);
dev2.replug();
const inf2 = await new SdumperClient(dev2, { timeoutMs: 300 }).getInfo();
check('  … nach Neueinstecken wieder verbunden', inf2.SN === '2611700031');
const l = parseRecordList(await c.readFile('1dlc.dat'));
check('Aufnahmeliste', l.length === 2 && l[0].fileName === '20250102030405', l.map(r => r.fileName).join(','));
check('fehlende Datei → null', (await c.readFile('20250102080000')) === null);
let last = 0;
const bytes = await c.readFile(l[0].fileName, (g, s) => (last = g / s));
check('EKG-Datei über mehrere Blöcke vollständig', bytes.length === ecgFile.length && bytes.every((v, i) => v === ecgFile[i]) && last === 1, `${bytes.length} B, ${Math.ceil(ecgFile.length / 635)} Blöcke`);
const e = parseEcgFile(bytes, l[0].fileName);
const a = analyze(e.signal, e.fs);
check('Analyse der übertragenen Aufnahme', a.hrNN > 60 && a.hrNN < 85 && a.beats.some(b => b.type === 'S'), `HF ${a.hrNN}`);
check('Dateianzahl (Diagnose)', (await c.fileCount()) === 2);
check('Uhr stellen über USB nicht angeboten', (await c.setTime()) === false);
if (fail) { console.log(`${fail} Prüfung(en) fehlgeschlagen`); process.exit(1); } else console.log('alle Prüfungen bestanden');
