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

/** Experimentell: Rahmen werden auf HID-Berichte aufgeteilt (Berichtsgröße aus dem Gerätedeskriptor). */
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
  return {
    name: dev.productName || 'USB', kind: 'USB', reportSize: size, reportId,
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
