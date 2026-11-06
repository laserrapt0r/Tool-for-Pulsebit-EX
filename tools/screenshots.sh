#!/usr/bin/env bash
# Erzeugt die README-Screenshots aus synthetischen Demo-EKGs (keine echten Daten).
# Voraussetzung: App läuft lokal, z. B.  python3 -m http.server 8765 --bind 127.0.0.1
# Aufruf: tools/screenshots.sh [http://127.0.0.1:8765]
set -euo pipefail
cd "$(dirname "$0")/.."
URL="${1:-http://127.0.0.1:8765}"
OUT=docs/screenshots
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
mkdir -p "$OUT"
cdp() { python3 test/cdp.py "$@" --profile "$PROFILE"; }
# Toasts, Installieren-Knopf und Update-Leiste für saubere Bilder ausblenden
CLEAN="document.head.insertAdjacentHTML('beforeend','<style>#toast,#install,#update{display:none!important}</style>');"

# Sprache setzen, Demo-Daten + zwei erfundene Personen anlegen
SETUP='(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms)),q=x=>document.querySelector(x);
 q("#disclaimer").open&&q("#disclaimer").close();
 const L=q("#lang");L.value=window.__LANG;L.dispatchEvent(new Event("change"));await s(800);
 location.hash="#/";await s(500);q("#demo").click();await s(2500);
 const st=await import("./js/storage.js");
 await st.savePerson({id:"demoA",name:"Alex Beispiel",sex:"m",birthDate:"1980-05-01",deviceUser:"1"});
 await st.savePerson({id:"demoB",name:"Sam Muster",sex:"w",birthDate:"1992-09-15",deviceUser:"2"});
 const recs=await st.listRecords();
 for(const [i,r] of recs.entries()){r.personId=i%2?"demoB":"demoA";delete r.summary.lang;await st.saveRecord(r);}
 return "ok"})()'
WAITAI="document.querySelector('.ai-table')"
for LANG in de en; do
  cdp "$URL/#/" --wait "document.querySelector('#demo')" --eval "window.__LANG='$LANG';$SETUP" >/dev/null
  cdp "$URL/#/" --wait "document.querySelectorAll('.rec').length>=4" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),'ok'" \
      --shot "$OUT/list-$LANG.png" --width 1100 --height 760 >/dev/null
  for KIND in af pac; do
    ID=$(cdp "$URL/#/" --wait "document.querySelectorAll('.rec').length>=4" \
      --eval "(async()=>{const st=await import('./js/storage.js');return (await st.listRecords()).find(r=>r.fileName==='$KIND').id})()" | tail -1)
    ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$ID")
    cdp "$URL/#/r/$ENC" --wait "$WAITAI" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),window.scrollTo(0,0),'ok'" \
        --shot "$OUT/detail-$KIND-$LANG.png" --width 1280 --height 1000 >/dev/null
    cdp "$URL/#/r/$ENC" --wait "$WAITAI" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),document.querySelectorAll('.finding').forEach((d,i)=>d.open=i<2),document.querySelector('#findings').scrollIntoView(),'ok'" \
        --shot "$OUT/findings-$KIND-$LANG.png" --width 1280 --height 1000 >/dev/null
  done
  cdp "$URL/#/r/$ENC" --wait "$WAITAI" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),document.querySelector('#ai').scrollIntoView(),'ok'" \
      --shot "$OUT/ai-$LANG.png" --width 1280 --height 900 >/dev/null
  cdp "$URL/#/r/$ENC" --wait "$WAITAI" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),'ok'" \
      --shot "$OUT/mobile-$LANG.png" --width 390 --height 844 --mobile >/dev/null
  cdp "$URL/#/personen" --wait "document.querySelector('#add')" --eval "$CLEAN document.querySelector('#disclaimer').open&&document.querySelector('#disclaimer').close(),'ok'" \
      --shot "$OUT/persons-$LANG.png" --width 1100 --height 700 >/dev/null
  rm -rf "$PROFILE"; mkdir -p "$PROFILE"
done
# verkleinern/optimieren
python3 -I - "$OUT" <<'EOF'
import sys, pathlib
from PIL import Image
for p in pathlib.Path(sys.argv[1]).glob('*.png'):
    im = Image.open(p).convert('RGB')
    if im.width > 1280: im = im.resize((1280, round(im.height * 1280 / im.width)), Image.LANCZOS)
    im.save(p, optimize=True)
EOF
ls -la "$OUT"
