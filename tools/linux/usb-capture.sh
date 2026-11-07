#!/usr/bin/env bash
# Schneidet den USB-Verkehr zwischen PC-Software (z. B. Checkme Browser unter Wine) und dem Pulsebit/Checkme mit – nur lesend.
# Ablauf: Gerät anstecken, am Gerät „Zum PC“ wählen, dann:  sudo tools/linux/usb-capture.sh
#         Im zweiten Terminal tools/linux/checkme-browser.sh starten und „Verbinden“ klicken.
#         Danach hier Strg+C drücken. Ergebnis: pulsebit-usb.pcap + pulsebit-usb.events.txt
# Lesbar machen: python3 tools/linux/usb-decode.py pulsebit-usb.pcap
exec python3 "$(dirname "$0")/usb-capture.py" "$@"
