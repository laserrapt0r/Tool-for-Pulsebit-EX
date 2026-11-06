#!/usr/bin/env bash
# Startet Checkme Browser Pro (Windows) unter Wine in einem eigenen Prefix.
# Erstinstallation:  ./checkme-browser.sh install ~/Downloads/Checkme+Browser+Pro+Setup+v2.5.3+-+signed.exe
# Start:             ./checkme-browser.sh
# USB-Diagnose:      ./checkme-browser.sh usb
set -euo pipefail
export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-checkme}"
export WINEDEBUG="${WINEDEBUG:--all}"
APP="$WINEPREFIX/drive_c/Program Files (x86)/Checkme Browser Pro/Checkme Browser Pro.exe"
# Wine bindet USB-HID-Geräte (hidraw) nur ein, wenn das SDL-Gamepad-Backend aus ist – nur in diesem Prefix
enable_hidraw() { wine reg add 'HKLM\System\CurrentControlSet\Services\winebus' /v "Enable SDL" /t REG_DWORD /d 0 /f >/dev/null 2>&1 || true; }
case "${1:-run}" in
  install)
    [ -f "${2:-}" ] || { echo "Installer-Pfad angeben"; exit 1; }
    wineboot -i >/dev/null 2>&1 || true
    wine "$2" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
    enable_hidraw ;;
  usb)
    echo "== USB-Geräte (Pulsebit/Viatom: 4444:5555 oder c25a:330e)"; lsusb | grep -i -E '4444:5555|c25a:330e' || echo "kein bekanntes Viatom-Gerät gefunden – am Gerät 'Einstellungen > Zum PC' wählen"
    for h in /sys/class/hidraw/hidraw*; do
      d=$(readlink -f "$h/device"); id=$(grep -h HID_ID "$d/uevent" 2>/dev/null | cut -d= -f2)
      case "$id" in *4444:*5555*|*C25A:*330E*|*c25a:*330e*) echo "$(basename "$h") $id  Rechte: $(stat -c '%A %U:%G' /dev/$(basename "$h"))";; esac
    done ;;
  log)
    # Protokolliert HID-Verkehr (für Fehlersuche) nach ./checkme-hid.log
    enable_hidraw; cd "$(dirname "$APP")"; WINEDEBUG=+hid,+hidp,+winebus wine "$APP" 2> "$OLDPWD/checkme-hid.log" ;;
  run|*)
    enable_hidraw; cd "$(dirname "$APP")"; exec wine "$APP" ;;
esac
