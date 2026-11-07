# EKG-Auswertung · ECG Analysis

**[Deutsch](#deutsch) · [English](#english)** · **▶ App: [https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/](https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/)**

Browser-App (PWA) zur **lokalen** Auswertung von 1-Kanal-EKGs des Viatom **Pulsebit EX** (CheckMe / Lookee) –
Messwerte, Schlaganalyse und KI-Zweitmeinung, ohne Cloud. ·
Progressive web app for **on-device** analysis of single-lead ECGs from the Viatom **Pulsebit EX** (CheckMe / Lookee) –
measurements, beat analysis and an AI second opinion, no cloud.

> ⚠️ **Kein Medizinprodukt – keine ärztliche Diagnose.** Bei Brustschmerz, Atemnot, Lähmungen oder Ohnmacht: **112**.
> ⚠️ **Not a medical device – no medical diagnosis.** In case of chest pain, shortness of breath, paralysis or fainting call your local emergency number (**112 / 911**).

---

## Deutsch

### Funktionen
| Bereich | Umsetzung |
|---|---|
| Daten vom Gerät | **Bluetooth** (Web Bluetooth) direkt vom Pulsebit EX · **USB** (WebHID, experimentell) · Rohdatei · CSV |
| ViHealth-PDF | Rekonstruiert die EKG-Kurve aus dem PDF-Bericht der Hersteller-App (±20 ms / ±0,05 mV) |
| Vermessung | Filter 0,5–40 Hz + 50-Hz-Kerbe, R-Zacken, Medianschlag, P, PR, QRS, QT, QTc (Bazett/Fridericia), ST, T, HRV, Signalqualität |
| Schlaganalyse | Jeder Schlag: normal / SVES / VES / unklar · Bigeminus, Trigeminus, Couplets, Salven, Pausen |
| Rhythmus | Sinusrhythmus, Brady-/Tachykardie (altersgerecht), Sinusarrhythmie, Vorhofflimmern, Tachykardie ohne P-Wellen u. a. |
| KI | **ECGFounder** 1-Kanal (MIT, 150 Labels), lokal per ONNX Runtime Web (WebGPU/WASM); nur Rhythmus-Labels werden gezeigt |
| Befunde | Erklärung, Bedeutung, Empfehlung, Belege, Sicherheitsstufe und **„Wie verlässlich?“** je Befund |
| Datenverwaltung | Sicherung/Wiederherstellung; Löschen einzeln, je Person oder alles (Einstellungen) |
| Personen | Mehrere Personen (Name; optional Geschlecht und Geburtsdatum), Zuordnung, Filter, Pulsebit-Benutzer A/B |
| Sprachen | Deutsch, English, Français, Español, Italiano, Nederlands, Polski, Türkçe |
| PWA | Installierbar, offline nutzbar, Update-Hinweis bei neuer Version |
| Datenschutz | Alle Daten bleiben im Browser (IndexedDB). Keine Server, kein Tracking |

### Screenshots
<p align="center">
  <img src="docs/screenshots/detail-af-de.png" alt="Detailansicht Vorhofflimmern" width="49%">
  <img src="docs/screenshots/findings-pac-de.png" alt="Befunde mit Verlässlichkeit" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/list-de.png" alt="Aufnahmen" width="49%">
  <img src="docs/screenshots/ai-de.png" alt="KI-Zweitmeinung" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/mobile-de.png" alt="Smartphone" width="24%">
  <img src="docs/screenshots/persons-de.png" alt="Personen" width="60%">
</p>

<sub>Alle Screenshots zeigen synthetische Demo-EKGs und erfundene Personen – keine echten Daten.</sub>

### Validierung (gegen ärztlich beurteilte Daten)
Alle Prüfungen sind mit den Skripten in `tools/validation/`, `tools/calibration/` und `test/validate-*.mjs` reproduzierbar. Schwellen wurden jeweils nur auf einem Teil der Daten gewählt und auf einem **unberührten** Teil gemessen.

**Vorhofflimmern** – PhysioNet/CinC 2017, 3.537 Handgerät-EKGs, 20 zufällige Aufteilungen in Kalibrier-/Testhälfte:

| Verfahren | Sensitivität | Spezifität |
|---|---|---|
| Messung allein | 79 % | 91 % |
| **Messung + KI (App)** | **90 %** (88–92) | **95 %** (94–96) |
| Stufe „wahrscheinlich“ | 72 % | 98 % – Meldung richtig in ~92 % |

**Messwerte** – LUDB, 188 EKGs, Ableitung I, Markierungen durch Kardiologen:

| Messung | innerhalb ±20 ms | mittlere Abweichung | Hinweis |
|---|---|---|---|
| QRS-Dauer | 89 % | 11 ms | breiter QRS (≥ 120 ms) in 10/14 erkannt, 5× fälschlich |
| PR-Zeit | 78 % | 16 ms (im Mittel 2 ms zu kurz) | AV-Block I° in 6/8 erkannt |
| QT-Zeit | 74 % (±40 ms: 94 %) | 19 ms | nur „verlässliche“ Messungen lösen Befunde aus |
| P-Welle bei Sinusrhythmus gefunden | 169/170 | | |

**QT-Zeit nach Herzfrequenz** – PhysioNet QT Database, 104 Aufnahmen (viele mit ST-/T-Veränderungen, Schenkelblock), erste Ableitung, Kardiologen-Markierungen:

| Herzfrequenz | Aufnahmen | QT innerhalb ±40 ms | mittlere Abweichung | Bias |
|---|---|---|---|---|
| < 60/min | 34 | 72 % | 33 ms | −24 ms |
| 60–80/min | 43 | 79 % | 33 ms | −20 ms |
| 80–100/min | 20 | 74 % | 46 ms | −41 ms |
| ≥ 100/min | 7 | 71 % | 35 ms | +2 ms |

Die App misst das T-Ende nach der Tangentenmethode und damit systematisch etwa 20 ms früher als die Markierungen dieser Datenbank (LUDB: 9 ms). Von 30 Aufnahmen mit QTc ≥ 450 ms laut Kardiologe erkennt die App 8 verlässlich; 0 von 68 unauffälligen werden fälschlich gemeldet. Grenzwertige QTc-Zeiten (450–470 ms) werden also eher übersehen als zu viel gemeldet.

**Extrasystolen** – MIT-BIH Arrhythmia, 30-s-Abschnitte, Testhälfte DS2 (22 Patienten, nicht zum Anpassen benutzt):

| | gesamt | nur Sinusrhythmus |
|---|---|---|
| Herzschläge gefunden | 97,6 % | 99,4 % |
| VES-Meldungen korrekt | 98 % | 98 % |
| Abschnitte mit VES erkannt / Fehlalarm | 67 % / 2 % | 66 % / 1 % |
| Abschnitte mit SVES erkannt / Fehlalarm | 25 % / 7 % | 70 % / 8 % |

**Falsch-Positiv-Audit** – Gesamtstufe der App bei EKGs, die Ärzte als unauffällig beurteilt haben:

| Datensatz | unauffällig | Hinweis | auffällig | ärztlich abklären |
|---|---|---|---|---|
| CinC 2017 „normal“, 1.500 Handgerät-EKGs – **mit KI (wie in der App)** | 62 % | 27 % | 9 % | 2 % |
| CinC 2017 „normal“ – ohne KI | 64 % | 25 % | 6 % | 5 % (Vorhofflimmern-Verdacht) |
| LUDB Sinusrhythmus ohne Extrasystolen/Block, 90 Klinik-EKGs | 88 % | 10 % | 2 % | 0 % |
| MIT-BIH Sinusrhythmus, nur Normalschläge, 615 Abschnitte¹ | 59 % | 21 % | 13 % | 7 % |

¹ enthält Patienten mit echtem Schenkelblock/AV-Block (AAMI zählt diese Schläge als „normal“). Eine einzelne Extrasystole in 30 s gilt als Normalbefund (Stufe „Info“); Nutzungshinweise (Polarität, mäßige Signalqualität) ändern die Gesamtstufe nicht. Alarmstufen („auffällig“, „abklären“) werden nur vergeben, wenn die zugrunde liegende Messung als verlässlich gilt (Signalqualität, T-Wellen-Plausibilität, Messstreuung).

**Bekannte Grenzen:** Vorhoftachykardien werden schlecht erkannt. Bei Sinustachykardie ab etwa 130/min liegt die P-Welle auf der T-Welle des Vorschlags; die App zieht dann ein Modell der T-Welle ab und sucht die P-Welle im Rest (synthetisch bis 170/min geprüft, an echten Aufnahmen mangels Daten nicht). Ein so gefundener Sinusrhythmus gilt nur als „wahrscheinlich“, denn Vorhofflattern mit 2:1-Überleitung sieht in einer Ableitung genauso aus – die PR-Zeit löst dann keine Befunde aus. Ohne KI kann eine ausgeprägte Sinusarrhythmie als Vorhofflimmern gelten. Bei Bigeminus wird die QTc-Zeit mit dem Abstand vor dem Normalschlag berechnet. KI-Labels für Schenkelblock, Hypertrophie, Lagetyp und AV-Block werden nicht angezeigt.

### Nutzen
- **Online:** [https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/](https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/) öffnen (Chrome/Edge; iPhone: Safari für Import, Bluetooth nur mit der App „Bluefy“).
- **Installieren:** Menü „App installieren“ bzw. iPhone: Teilen → „Zum Home-Bildschirm“.
- **Lokal:** `python3 -m http.server 8765` im Projektordner, dann `http://localhost:8765`.

| Plattform | Bluetooth | USB | Import, Auswertung, KI |
|---|---|---|---|
| Linux / Windows / macOS – Chrome, Edge | ✔ | ✔ (experimentell) | ✔ |
| Android – Chrome | ✔ | – | ✔ |
| iPhone/iPad – Safari | – | – | ✔ |
| iPhone/iPad – Bluefy | ✔ | – | ✔ |

**USB unter Linux:** Chrome darf das Gerät erst nach Installation der udev-Regel öffnen (sonst „Failed to open the device“):
`sudo cp tools/linux/70-viatom-pulsebit.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger`, danach Gerät neu einstecken.
Hinweis zu USB: Der Pulsebit spricht über USB ein eigenes Protokoll („sdumper2“), das aus einem Mitschnitt (`tools/linux/usb-capture.sh`) und Checkme Browser Pro ermittelt und am Gerät geprüft wurde. Das Gerät verträgt nach dem Einstecken genau eine Begrüßung als allererste Nachricht. Danach blockiert es bis zum Neueinstecken, deshalb Checkme Browser nicht parallel öffnen. Reagiert das Gerät nicht mehr: Kabel kurz abziehen, wieder anstecken, „Zum PC“ wählen und neu verbinden. Die Uhr des Geräts lässt sich nur über Bluetooth stellen.

### Veröffentlichen & Updates
1. Repository auf GitHub anlegen, pushen, unter *Settings → Pages* „Deploy from branch“ (`main`, `/`) wählen.
2. Für eine neue Version: `node tools/release.mjs patch` (setzt Version, erneuert die Dateiliste des Service Workers), committen, pushen.
   Installierte Apps erkennen die neue Version beim nächsten Start bzw. stündlich und bieten „Jetzt aktualisieren“ an.

### Entwicklung
- Kein Build-Schritt: reine ES-Module. Tests: `node test/run.mjs`, Browser-Test: `python3 test/cdp.py http://localhost:8765/test/e2e.html --profile /tmp/p --wait "/FERTIG/.test(document.body.innerText)" --eval "document.body.innerText"`.
- Übersetzungen: `js/locales/<sprache>.js` (Vorlage `de.js`, gleiche Schlüssel, Platzhalter `{…}` beibehalten).
- KI-Modell neu erzeugen: `python tools/ecgfounder/convert.py 1_lead_ECGFounder.pth models/ecgfounder-1lead.onnx`.
- Kalibrierung: `tools/calibration/` (PhysioNet/CinC 2017).
- Screenshots neu erzeugen (synthetische Daten): `tools/screenshots.sh`.

---

## English

### Features
| Area | Implementation |
|---|---|
| Device data | **Bluetooth** (Web Bluetooth) directly from the Pulsebit EX · **USB** (WebHID, experimental) · raw file · CSV |
| ViHealth PDF | Reconstructs the ECG trace from the vendor app's PDF report (±20 ms / ±0.05 mV) |
| Measurements | 0.5–40 Hz filter + 50 Hz notch, R peaks, median beat, P, PR, QRS, QT, QTc (Bazett/Fridericia), ST, T, HRV, signal quality |
| Beat analysis | Every beat: normal / PAC / PVC / unclear · bigeminy, trigeminy, couplets, runs, pauses |
| Rhythm | Sinus rhythm, brady-/tachycardia (age-adjusted), sinus arrhythmia, atrial fibrillation, tachycardia without P waves, … |
| AI | **ECGFounder** single-lead (MIT, 150 labels), on-device via ONNX Runtime Web (WebGPU/WASM); only rhythm labels are shown |
| Findings | Explanation, meaning, recommendation, evidence, certainty level and **"How reliable?"** for every finding |
| Data management | Backup/restore; delete single recordings, per person or everything (Settings) |
| People | Multiple people (name; optional sex and date of birth), assignment, filter, Pulsebit users A/B |
| Languages | Deutsch, English, Français, Español, Italiano, Nederlands, Polski, Türkçe |
| PWA | Installable, works offline, update prompt when a new version is published |
| Privacy | All data stays in the browser (IndexedDB). No servers, no tracking |

### Screenshots
<p align="center">
  <img src="docs/screenshots/detail-af-en.png" alt="Detail view atrial fibrillation" width="49%">
  <img src="docs/screenshots/findings-pac-en.png" alt="Findings with reliability" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/list-en.png" alt="Recordings" width="49%">
  <img src="docs/screenshots/ai-en.png" alt="AI second opinion" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/mobile-en.png" alt="Smartphone" width="24%">
  <img src="docs/screenshots/persons-en.png" alt="People" width="60%">
</p>

<sub>All screenshots show synthetic demo ECGs and fictitious people – no real data.</sub>

### Validation (against physician-reviewed data)
All evaluations are reproducible with the scripts in `tools/validation/`, `tools/calibration/` and `test/validate-*.mjs`. Thresholds were always chosen on one part of the data and measured on an **untouched** part.

**Atrial fibrillation** – PhysioNet/CinC 2017, 3,537 handheld ECGs, 20 random calibration/test splits:

| Method | Sensitivity | Specificity |
|---|---|---|
| Measurements only | 79 % | 91 % |
| **Measurements + AI (app)** | **90 %** (88–92) | **95 %** (94–96) |
| "Probable" level | 72 % | 98 % – correct in ~92 % |

**Measurements** – LUDB, 188 ECGs, lead I, annotated by cardiologists:

| Measurement | within ±20 ms | mean abs. error | Note |
|---|---|---|---|
| QRS duration | 89 % | 11 ms | wide QRS (≥ 120 ms) detected in 10/14, 5 false |
| PR interval | 78 % | 16 ms (on average 2 ms too short) | first-degree AV block detected in 6/8 |
| QT interval | 74 % (±40 ms: 94 %) | 19 ms | only “reliable” measurements trigger findings |
| P wave found in sinus rhythm | 169/170 | | |

**QT interval by heart rate** – PhysioNet QT Database, 104 recordings (many with ST/T changes or bundle branch block), first lead, cardiologist annotations:

| Heart rate | Recordings | QT within ±40 ms | mean abs. error | Bias |
|---|---|---|---|---|
| < 60/min | 34 | 72 % | 33 ms | −24 ms |
| 60–80/min | 43 | 79 % | 33 ms | −20 ms |
| 80–100/min | 20 | 74 % | 46 ms | −41 ms |
| ≥ 100/min | 7 | 71 % | 35 ms | +2 ms |

The app measures the T end with the tangent method and therefore systematically about 20 ms earlier than this database's annotations (LUDB: 9 ms). Of 30 recordings with cardiologist QTc ≥ 450 ms the app reliably flags 8; 0 of 68 unremarkable ones are flagged falsely. Borderline QTc values (450–470 ms) are thus more likely to be missed than over-reported.

**Premature beats** – MIT-BIH Arrhythmia, 30-s segments, test half DS2 (22 patients, not used for tuning):

| | overall | sinus rhythm only |
|---|---|---|
| Beats detected | 97.6 % | 99.4 % |
| Reported PVCs correct | 98 % | 98 % |
| Segments with PVCs detected / false alarm | 67 % / 2 % | 66 % / 1 % |
| Segments with PACs detected / false alarm | 25 % / 7 % | 70 % / 8 % |

**False-positive audit** – overall level reported by the app for ECGs that physicians judged unremarkable:

| Dataset | normal | note | notable | see a doctor |
|---|---|---|---|---|
| CinC 2017 "normal", 1,500 handheld ECGs – **with AI (as in the app)** | 62 % | 27 % | 9 % | 2 % |
| CinC 2017 "normal" – without AI | 64 % | 25 % | 6 % | 5 % (suspected AF) |
| LUDB sinus rhythm without ectopy/block, 90 clinical ECGs | 88 % | 10 % | 2 % | 0 % |
| MIT-BIH sinus rhythm, normal beats only, 615 segments¹ | 59 % | 21 % | 13 % | 7 % |

¹ includes patients with genuine bundle branch block / AV block (AAMI counts those beats as "normal"). A single premature beat in 30 s counts as a normal finding ("info" level); usage hints (polarity, moderate signal quality) do not change the overall level. Alert levels ("notable", "see a doctor") are only assigned when the underlying measurement is considered reliable (signal quality, T-wave plausibility, measurement scatter).

**Known limitations:** atrial tachycardias are poorly detected. In sinus tachycardia from about 130/min the P wave sits on the preceding T wave; the app then subtracts a model of the T wave and searches the residual for the P wave (verified synthetically up to 170/min, not on real recordings for lack of data). A sinus rhythm found this way is only rated "probable", because atrial flutter with 2:1 conduction looks identical in a single lead – the PR interval then triggers no findings. Without AI, pronounced sinus arrhythmia can be mistaken for atrial fibrillation. In bigeminy, QTc uses the interval preceding the normal beat. AI labels for bundle branch block, hypertrophy, axis and AV block are not shown.

### Usage
- **Online:** open [https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/](https://laserrapt0r.github.io/Tool-for-Pulsebit-EX/) (Chrome/Edge; iPhone: Safari for import, Bluetooth only with the "Bluefy" app).
- **Install:** browser menu "Install app", or on iPhone: Share → "Add to Home Screen".
- **Locally:** `python3 -m http.server 8765` in the project folder, then `http://localhost:8765`.

| Platform | Bluetooth | USB | Import, analysis, AI |
|---|---|---|---|
| Linux / Windows / macOS – Chrome, Edge | ✔ | ✔ (experimental) | ✔ |
| Android – Chrome | ✔ | – | ✔ |
| iPhone/iPad – Safari | – | – | ✔ |
| iPhone/iPad – Bluefy | ✔ | – | ✔ |

**USB on Linux:** Chrome can only open the device after installing the udev rule (otherwise "Failed to open the device"):
`sudo cp tools/linux/70-viatom-pulsebit.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger`, then replug the device.
USB note: over USB the Pulsebit speaks its own protocol ("sdumper2"), reconstructed from a capture (`tools/linux/usb-capture.sh`) and Checkme Browser Pro and verified on the device. After being plugged in, the device accepts exactly one greeting as the very first message. After that it blocks until replugged, so do not open Checkme Browser at the same time. If the device stops responding: briefly unplug the cable, plug it back in, select "To PC" and connect again. The device clock can only be set via Bluetooth.

### Publishing & updates
1. Create a GitHub repository, push, and enable *Settings → Pages* "Deploy from branch" (`main`, `/`).
2. For a new version: `node tools/release.mjs patch` (sets the version and refreshes the service-worker file list), commit, push.
   Installed apps detect the new version on next start (and hourly) and offer "Update now".

### Device protocol (short)
- BLE service `14839ac4-7d7e-415c-9a42-167340cf2339`, write `8b00ace7-…`, notify `0734594a-…`
- Request `AA cmd ~cmd seq(2) len(2) payload crc8`, response `55 status ~status seq(2) len(2) data crc8` (CRC-8, poly 0x07)
- Commands: `0x14` info (JSON), `0x16` set time, `0x03/0x04/0x05` read file (start/chunk/end)
- `1dlc.dat`: record list (17 bytes each); recordings `yyyyMMddHHmmss`: 44-byte header, HR per second, int16 waveform (250 Hz, ×0.001282 mV)
- Source: the public Lepu/Viatom SDK. See [js/device/viatom-protocol.js](js/device/viatom-protocol.js), [js/import/pulsebit-file.js](js/import/pulsebit-file.js)

### Project structure
```
index.html, styles.css, sw.js, manifest.webmanifest
js/app.js              UI                      js/i18n.js, js/locales/   translations
js/dsp/                filters, analysis       js/findings.js            findings & reliability
js/ai/                 ECGFounder (worker)     js/device/                protocol, BLE/USB
js/import/             PDF, Pulsebit, CSV      js/demo.js                synthetic ECGs
tools/                 model conversion, calibration, validation, udev rule, USB capture, release
test/                  node tests, browser test (CDP)
```

### Licenses & sources
- This project: MIT (see [LICENSE](LICENSE))
- ECGFounder model & code: MIT (PKUDigitalHealth) – [models/README.md](models/README.md)
- ONNX Runtime Web: MIT (Microsoft) · pdf.js: Apache-2.0 (Mozilla)
- QRS detection inspired by NeuroKit2 (MIT) · validation data (not included): PhysioNet/CinC Challenge 2017, LUDB, QT Database, MIT-BIH Arrhythmia Database (PhysioNet; see their licenses)

Not affiliated with Viatom, Lepu, CheckMe or ViHealth.
