#!/usr/bin/env bash
# Schneidet den USB-Verkehr zwischen Checkme Browser Pro (Wine) und dem Pulsebit/Checkme mit (nur lesend).
# Ergebnis: ./pulsebit-usb.log – hilft, das USB-Protokoll für die Web-App nachzubauen.
# Ablauf: Gerät anstecken und „Einstellungen → Zum PC“ wählen, dann:  sudo tools/linux/usb-capture.sh
#         In Checkme Browser „Verbinden“ klicken und EINE Aufnahme herunterladen, danach Checkme Browser schließen
#         und hier Enter drücken.
set -euo pipefail
LINE=$(lsusb | grep -i -E 'c25a:330e|4444:5555' | head -1) || { echo "Kein Viatom-Gerät gefunden."; exit 1; }
BUS=$((10#$(echo "$LINE" | awk '{print $2}'))); DEV=$((10#$(echo "$LINE" | awk '{print $4}' | tr -d :)))
echo "Gerät: $LINE  (Bus $BUS, Gerät $DEV)"
modprobe usbmon
mountpoint -q /sys/kernel/debug || mount -t debugfs none /sys/kernel/debug
OUT="$(pwd)/pulsebit-usb.log"
# Spalte 4 der usbmon-Textausgabe: Typ:Bus:Gerät:Endpunkt
( cat /sys/kernel/debug/usb/usbmon/${BUS}u | awk -v b="$BUS" -v d="$DEV" '{split($4,a,":"); if (a[2]+0==b && a[3]+0==d) print}' > "$OUT" ) &
PID=$!
echo "Mitschnitt läuft → $OUT"
echo "Jetzt Checkme Browser starten (tools/linux/checkme-browser.sh), verbinden, eine Aufnahme laden, schließen – dann Enter."
read -r _
kill $PID 2>/dev/null || true; sleep 0.3
chown "${SUDO_USER:-root}" "$OUT" 2>/dev/null || true
echo "Fertig: $(wc -l < "$OUT") Zeilen in $OUT"
