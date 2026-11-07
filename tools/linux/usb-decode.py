#!/usr/bin/env python3
"""Macht einen Mitschnitt aus usb-capture.py lesbar: Zeit, Richtung, Endpunkt, Länge, Hex + ASCII.

Aufruf: python3 tools/linux/usb-decode.py pulsebit-usb.pcap [--all]
Ohne --all werden leere Abschluss-Meldungen und Steuerpakete ohne Daten ausgeblendet.
"""
import struct, sys

TYPES = {0: 'ISO', 1: 'INT', 2: 'CTL', 3: 'BULK'}
HDR = struct.Struct('<QBBBBHccqiiII8s')


def records(path):
    with open(path, 'rb') as f:
        magic, _, _, _, _, _, link = struct.unpack('<IHHiIII', f.read(24))
        assert magic == 0xA1B2C3D4 and link == 189, 'keine usbmon-pcap-Datei'
        while (h := f.read(16)) and len(h) == 16:
            _, _, incl, _ = struct.unpack('<IIII', h)
            yield f.read(incl)


def main():
    path, show_all = sys.argv[1], '--all' in sys.argv
    t0 = None
    for rec in records(path):
        (_id, typ, xfer, ep, dev, bus, fs, fd, sec, usec, status, length, cap, setup) = HDR.unpack_from(rec)
        data, t = rec[48:48 + cap], sec + usec / 1e6
        t0 = t if t0 is None else t0
        typ = chr(typ); d_in = bool(ep & 0x80)
        # Daten stehen bei OUT im Submit (S), bei IN im Complete (C)
        if not show_all and not data and not (xfer == 2 and typ == 'S'):
            continue
        arrow = 'Gerät→PC' if d_in else 'PC→Gerät'
        extra = ''
        if xfer == 2 and typ == 'S' and fs == b'\x00':
            bm, br, val, idx, ln = struct.unpack('<BBHHH', setup)
            extra = f' SETUP bmRequestType={bm:02x} bRequest={br:02x} wValue={val:04x} wIndex={idx:04x} wLength={ln}'
        st = f' status={status}' if status not in (0, -115) else ''
        print(f'{t - t0:9.3f}s Nr.{dev:<3} {TYPES.get(xfer, xfer)} ep{ep & 0x7f} {typ} {arrow} {length:5d} B{st}{extra}')
        for i in range(0, len(data), 16):
            chunk = data[i:i + 16]
            print(f'           {i:04x}  {chunk.hex(" "):<48} {"".join(chr(c) if 32 <= c < 127 else "." for c in chunk)}')


if __name__ == '__main__':
    main()
