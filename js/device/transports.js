// Transportschichten: Web Bluetooth (BLE) und WebHID (USB).

import { t } from '../i18n.js';

export const VIATOM_SERVICE = '14839ac4-7d7e-415c-9a42-167340cf2339';
const WRITE_CHAR = '8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3';
const NOTIFY_CHAR = '0734594a-a8e7-4b1a-a6b1-cd5243059a57';

// USB-Kennungen aus Checkme Browser Pro v2.5.3 (hid_enumerate / hid_open)
export const VIATOM_HID_FILTERS = [{ vendorId: 0x4444, productId: 0x5555 }, { vendorId: 0xc25a, productId: 0x330e }];

export const support = {
  ble: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  hid: typeof navigator !== 'undefined' && !!navigator.hid,
};

export async function connectBle() {
  if (!support.ble) throw new Error(t('dev.needChrome'));
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'Pulsebit' }, { namePrefix: 'Checkme' }, { namePrefix: 'HHM4' }, { services: [VIATOM_SERVICE] }],
    optionalServices: [VIATOM_SERVICE],
  });
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(VIATOM_SERVICE);
  const wr = await svc.getCharacteristic(WRITE_CHAR);
  const nt = await svc.getCharacteristic(NOTIFY_CHAR);
  let cb = () => {};
  nt.addEventListener('characteristicvaluechanged', e => {
    const v = e.target.value;
    cb(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  });
  await nt.startNotifications();
  const mtu = 20; // ohne MTU-Aushandlung sicher
  return {
    name: device.name || 'Pulsebit',
    kind: 'Bluetooth',
    onData: f => { cb = f; },
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += mtu) {
        const part = bytes.slice(i, i + mtu);
        if (wr.writeValueWithoutResponse && !wr.properties.write) await wr.writeValueWithoutResponse(part);
        else await wr.writeValue(part);
      }
    },
    close() { try { device.gatt.disconnect(); } catch { /* egal */ } },
  };
}

// Der Pulsebit verträgt die USB-Begrüßung nur einmal je Steckvorgang (siehe sdumper-protocol.js). Gemerkt wird sie
// im Speicher je HIDDevice und in localStorage (übersteht Neuladen der Seite); beim Abziehen wird sie vergessen.
const GREET_KEY = 'pulsebit-usb-greeted', greetedDevs = new WeakSet();
const lsGet = () => { try { return +localStorage.getItem(GREET_KEY) || 0; } catch { return 0; } };
const lsSet = v => { try { v ? localStorage.setItem(GREET_KEY, String(v)) : localStorage.removeItem(GREET_KEY); } catch { /* egal */ } };
if (support.hid) navigator.hid.addEventListener('disconnect', e => { greetedDevs.delete(e.device); lsSet(0); });

/** Rahmen werden auf HID-Berichte aufgeteilt (Berichtsgröße aus dem Gerätedeskriptor). */
export async function connectHid({ any = false } = {}) {
  if (!support.hid) throw new Error(t('dev.needHid'));
  const [dev] = await navigator.hid.requestDevice({ filters: any ? [] : VIATOM_HID_FILTERS });
  if (!dev) throw Object.assign(new Error(t('dev.noneSelected')), { name: 'NotFoundError' });
  if (!dev.opened) await dev.open();
  const col = dev.collections.find(c => c.outputReports?.length) || dev.collections[0];
  const out = col?.outputReports?.[0];
  const reportId = out?.reportId ?? 0;
  const size = out ? out.items.reduce((s, it) => s + (it.reportSize * it.reportCount) / 8, 0) : 64;
  let cb = () => {};
  dev.addEventListener('inputreport', e => {
    const v = e.data;
    cb(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  });
  const session = {
    // nach Neuladen der Seite: Merker höchstens 12 h gültig
    greeted: greetedDevs.has(dev) || Date.now() - lsGet() < 12 * 3600e3,
    markGreeted() { this.greeted = true; greetedDevs.add(dev); lsSet(Date.now()); },
    reset() { this.greeted = false; greetedDevs.delete(dev); lsSet(0); },
  };
  return {
    name: dev.productName || 'USB', kind: 'USB', reportSize: size, reportId, session,
    onData: f => { cb = f; },
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += size) {
        const rep = new Uint8Array(size);
        rep.set(bytes.subarray(i, i + size));
        await dev.sendReport(reportId, rep);
      }
    },
    close() { try { dev.close(); } catch { /* egal */ } },
  };
}
