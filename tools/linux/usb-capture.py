#!/usr/bin/env python3
"""Schneidet den USB-Verkehr eines Viatom-Geräts (Pulsebit EX / Checkme) vollständig mit – nur lesend.

Liest die binäre usbmon-Schnittstelle (/dev/usbmonN, volle Paketlänge, nicht nur 32 Bytes wie die Textschnittstelle)
und schreibt eine pcap-Datei (Wireshark-kompatibel, LINKTYPE_USB_LINUX). Es werden NUR Pakete von Geräten mit den
Viatom-Kennungen gespeichert; Tastatur, Maus usw. am selben Bus werden verworfen. Meldet sich das Gerät neu an
(neue Gerätenummer), wird es automatisch weiter verfolgt. Zusätzlich landen An-/Abmeldungen in einer Textdatei.

Aufruf (braucht root, weil nur root usbmon lesen darf):
    sudo python3 tools/linux/usb-capture.py [ausgabe-ohne-endung]
Beenden mit Strg+C.
"""
import glob, os, select, signal, struct, sys, time

VIDPID = {('c25a', '330e'), ('4444', '5555'), ('c257', '330b')}  # Checkme Lite, Pulsebit-Kennung, Update-Modus
HDR = struct.Struct('<QBBBBHccqiiII8s')  # struct usbmon_packet (48 Bytes)
assert HDR.size == 48


def viatom_devices():
    """{(bus, devnum): 'vid:pid Produkt'} aller angeschlossenen Viatom-Geräte laut sysfs."""
    out = {}
    for d in glob.glob('/sys/bus/usb/devices/*'):
        try:
            vid, pid = open(d + '/idVendor').read().strip(), open(d + '/idProduct').read().strip()
            if (vid, pid) in VIDPID:
                bus, dev = int(open(d + '/busnum').read()), int(open(d + '/devnum').read())
                prod = open(d + '/product').read().strip() if os.path.exists(d + '/product') else ''
                out[(bus, dev)] = f'{vid}:{pid} {prod}'
        except OSError:
            pass
    return out


def main():
    if os.geteuid() != 0:
        sys.exit('Bitte mit sudo starten: sudo python3 tools/linux/usb-capture.py')
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), 'pulsebit-usb')
    os.system('modprobe usbmon')
    devs = viatom_devices()
    if not devs:
        sys.exit('Kein Viatom-Gerät gefunden. Gerät anstecken und am Gerät „Zum PC“ wählen.')
    buses = sorted({b for b, _ in devs})
    if len(buses) > 1:
        print('Mehrere Busse, verfolge nur', buses[0])
    bus = buses[0]
    fd = os.open(f'/dev/usbmon{bus}', os.O_RDONLY)
    pcap, events = open(base + '.pcap', 'wb'), open(base + '.events.txt', 'w')
    pcap.write(struct.pack('<IHHiIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, 189))  # LINKTYPE_USB_LINUX
    known, last_scan, n_pkt = dict(devs), 0.0, 0
    log = lambda s: (events.write(f'{time.strftime("%H:%M:%S")} {s}\n'), events.flush(), print(s))
    for (b, d), name in devs.items():
        log(f'Gerät da: Bus {b} Nr. {d} {name}')
    stop = False
    def handler(*_):
        nonlocal stop; stop = True
    signal.signal(signal.SIGINT, handler); signal.signal(signal.SIGTERM, handler)
    print(f'Mitschnitt läuft (Bus {bus}) → {base}.pcap   Beenden mit Strg+C')
    while not stop:
        if not select.select([fd], [], [], 0.5)[0]:
            if time.time() - last_scan > 1.0:  # auch ohne Verkehr An-/Abmeldungen erfassen
                cur = viatom_devices(); last_scan = time.time()
                for k in set(cur) - set(known): log(f'angemeldet: Bus {k[0]} Nr. {k[1]} {cur[k]}')
                for k in set(known) - set(cur): log(f'abgemeldet: Bus {k[0]} Nr. {k[1]} {known[k]}')
                known = cur
            continue  # nichts los – regelmäßig auf Strg+C prüfen
        try:
            buf = os.read(fd, 1 << 20)
        except InterruptedError:
            continue
        except OSError:
            if stop: break
            raise
        if len(buf) < 48:
            continue
        (_id, typ, xfer, ep, devnum, busnum, fsetup, fdata, ts_sec, ts_usec, status, length, len_cap, setup) = HDR.unpack_from(buf)
        now = time.time()
        if (busnum, devnum) not in known or now - last_scan > 1.0:
            cur = viatom_devices(); last_scan = now
            for k in set(cur) - set(known): log(f'angemeldet: Bus {k[0]} Nr. {k[1]} {cur[k]}')
            for k in set(known) - set(cur): log(f'abgemeldet: Bus {k[0]} Nr. {k[1]} {known[k]}')
            known = cur
        if (busnum, devnum) not in known:
            continue  # anderes Gerät (Tastatur, Maus …) – wird nicht gespeichert
        rec = buf[:48 + len_cap]
        pcap.write(struct.pack('<IIII', ts_sec & 0xFFFFFFFF, ts_usec, len(rec), len(rec)) + rec)
        n_pkt += 1
        if n_pkt % 50 == 0:
            pcap.flush()
    pcap.close()
    log(f'Ende: {n_pkt} Pakete gespeichert')
    try:
        uid = int(os.environ.get('SUDO_UID', '0')); gid = int(os.environ.get('SUDO_GID', '0'))
        if uid:
            for f in (base + '.pcap', base + '.events.txt'): os.chown(f, uid, gid)
    except OSError:
        pass


if __name__ == '__main__':
    main()
