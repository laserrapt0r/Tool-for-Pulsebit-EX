#!/usr/bin/env bash
# Schneidet den USB-Verkehr zwischen einer PC-Software (z. B. Chrome mit dieser App) und dem Pulsebit/Checkme mit – nur lesend.
# Ablauf: Gerät anstecken, am Gerät „Zum PC“ wählen, dann:  sudo tools/linux/usb-capture.sh
#         Dann in der PC-Software verbinden.
#         Danach hier Strg+C drücken. Ergebnis: pulsebit-usb.pcap + pulsebit-usb.events.txt
# Lesbar machen: python3 tools/linux/usb-decode.py pulsebit-usb.pcap
exec python3 "$(dirname "$0")/usb-capture.py" "$@"
