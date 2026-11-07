// EKG-Auswertung – Oberfläche (ohne Framework, ohne Build-Schritt).
import { analyze } from './dsp/analysis.js';
import { interpret, levelText, certText, hrNorm } from './findings.js';
import { drawStrip, drawTemplate, drawRR } from './ecg-view.js';
import { saveRecord, getRecord, deleteRecord, listRecords, getSetting, setSetting, recordId, exportAll, importBackup, listPersons, savePerson, deletePerson, newPersonId, clearRecords, clearAll } from './storage.js';
import { importFile } from './import/importers.js';
import { ViatomClient } from './device/viatom-protocol.js';
import { connectBle, connectHid, support } from './device/transports.js';
import { parseRecordList, parseEcgFile } from './import/pulsebit-file.js';
import { SHOWN } from './ai/ecgfounder.js';
import { CALIBRATION } from './ai/thresholds.js';
import { synthEcg, DEMO_KINDS } from './demo.js';
import { t, setLang, lang, detectLang, LANGS, nf, fmtDate, fmtDay, applyStatic } from './i18n.js';
import { VERSION } from './version.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 3500) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), ms);
}

const settings = { autoAI: true, personFilter: 'all', lang: '' };
let persons = [];
async function loadSettings() {
  Object.assign(settings, await getSetting('app', {}));
  persons = await listPersons();
  // Übernahme des alten Einzelprofils (Version 1) als erste Person
  const old = await getSetting('profile', null);
  if (old && !persons.length && (old.name || old.sex || old.birthYear)) {
    await savePerson({ id: newPersonId(), name: old.name || t('p.legacyName'), sex: old.sex || '', birthDate: old.birthYear ? `${old.birthYear}-07-01` : '', deviceUser: '' });
    if (old.autoAI != null) settings.autoAI = old.autoAI;
    await setSetting('profile', null);
    persons = await listPersons();
  }
}
const saveAppSettings = () => setSetting('app', { ...settings });
const personById = id => persons.find(p => p.id === id) || null;
const sexText = s => (s ? t('sex.' + s) : '');
function ageAt(p, date) {
  if (!p?.birthDate) return null;
  const b = new Date(p.birthDate), d = date ? new Date(date) : new Date();
  let y = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) y--;
  return y >= 0 ? y : null;
}
/** Zielperson für neue Importe: Gerätebenutzer A/B, sonst gefilterte Person, sonst die einzige Person. */
function importTarget(deviceUser) {
  if (deviceUser) { const p = persons.find(x => x.deviceUser && +x.deviceUser === deviceUser); if (p) return p.id; }
  if (settings.personFilter !== 'all' && settings.personFilter !== 'none') return settings.personFilter;
  return persons.length === 1 ? persons[0].id : null;
}
const personOptions = sel => `<option value="">${esc(t('rec.noPersonOpt'))}</option>` +
  persons.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

// ---------------------------------------------------------------- Routing
let resizeTimer = null;
const routes = [
  [/^#?\/?$/, () => viewList()],
  [/^#\/r\/(.+)$/, m => viewRecord(decodeURIComponent(m[1]))],
  [/^#\/geraet$/, () => viewDevice()],
  [/^#\/personen$/, () => viewPersons()],
  [/^#\/einstellungen$/, () => viewSettings()],
  [/^#\/info$/, () => viewInfo()],
];
async function route() {
  const h = location.hash || '#/';
  window.onresize = null; window.onbeforeprint = null; clearTimeout(resizeTimer);
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.getAttribute('href') === (h.startsWith('#/r/') ? '#/' : h)));
      try { await fn(m); } catch (e) { console.error(e); app.innerHTML = `<div class="card"><h2>${esc(t('common.error'))}</h2><p>${esc(e.message)}</p></div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- Analyse-Hilfen
function runAnalysis(rec) {
  const a = analyze(rec.signal, rec.fs);
  a.source = rec.source;
  const p = personById(rec.personId);
  const res = interpret(a, { sex: p?.sex || '', age: ageAt(p, rec.date), ai: rec.ai, device: rec.device });
  return { a, res };
}
function makeSummary(rec, a, res) {
  return { hr: a.hrNN || a.hr, headline: res.headline, overall: res.overall, quality: a.quality?.score, duration: a.duration, lang: lang(), v: VERSION };
}

async function storeImported(r, personId = importTarget()) {
  const id = recordId(r.source, r.date, r.source === 'pdf' || r.source === 'demo' ? r.fileName : '');
  const old = await getRecord(id);
  const rec = {
    id, personId: old?.personId ?? personId, date: r.date, source: r.source, fileName: r.fileName, deviceName: r.deviceName || '', fs: r.fs,
    signal: Float32Array.from(r.signal), device: r.device || null, note: old?.note || r.note || '', imported: new Date(), ai: old?.ai || null,
  };
  const { a, res } = runAnalysis(rec);
  rec.summary = makeSummary(rec, a, res);
  await saveRecord(rec);
  return rec;
}

function srcName(r) {
  if (r.source === 'demo') return t('demo.' + r.fileName) || t('src.demo');
  return { pdf: t('src.pdf'), pulsebit: r.deviceName || t('src.pulsebit'), text: t('src.text') }[r.source] || r.source;
}

// ---------------------------------------------------------------- Liste
async function viewList() {
  const all = await listRecords();
  if (settings.personFilter !== 'all' && settings.personFilter !== 'none' && !personById(settings.personFilter)) settings.personFilter = 'all';
  const recs = all.filter(r => settings.personFilter === 'all' || (settings.personFilter === 'none' ? !personById(r.personId) : r.personId === settings.personFilter));
  // Kurzfassungen nachziehen, wenn Sprache oder App-Version (= Auswertungsregeln) sich geändert haben
  for (const r of recs) {
    if (r.summary?.lang !== lang() || r.summary?.v !== VERSION) { const { a, res } = runAnalysis(r); r.summary = makeSummary(r, a, res); saveRecord(r); }
  }
  const target = personById(importTarget());
  app.innerHTML = `
    <h1>${esc(t('list.title'))}</h1>
    ${persons.length ? `<div class="row no-print" style="margin-bottom:12px"><label>${esc(t('list.person'))}
      <select id="pfilter"><option value="all">${esc(t('list.allPersons'))}</option>${persons.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="none">${esc(t('list.noPerson'))}</option></select></label>
      <a class="small" href="#/personen">${esc(t('list.managePersons'))}</a></div>` : `<div class="card small no-print">${t('list.tipPersons')}</div>`}
    <div class="card no-print">
      <div class="row">
        <a class="btn primary" href="#/geraet">${esc(t('list.fromDevice'))}</a>
        <label class="btn">${esc(t('list.importFile'))}<input id="file" type="file" multiple hidden accept=".pdf,.csv,.txt,.dat,.bin,application/pdf,application/octet-stream,*/*"></label>
        <button class="btn" id="demo">${esc(t('list.demo'))}</button>
      </div>
      <div id="drop" class="drop" style="margin-top:12px">${esc(t('list.drop'))}</div>
      <div id="impstatus" class="small muted" style="margin-top:6px">${persons.length ? (target ? t('list.target', { name: esc(target.name) }) : esc(t('list.targetNone'))) : ''}</div>
    </div>
    <div class="list">
      ${recs.length ? recs.map(r => `
        <a class="card rec" href="#/r/${encodeURIComponent(r.id)}">
          <div class="hr">${nf(r.summary?.hr)}<small>${esc(t('common.perMin'))}</small></div>
          <div>
            <div><b>${esc(fmtDate(r.date))}</b>${personById(r.personId) ? ` · <b>${esc(personById(r.personId).name)}</b>` : ''} <span class="small muted">· ${esc(srcName(r))}</span></div>
            <div class="small">${esc(r.summary?.headline || '')}</div>
            ${r.ai ? `<div class="small muted">${esc(t('list.withAI'))}</div>` : ''}
          </div>
          <span class="badge lv-${r.summary?.overall || 'info'}">${esc(levelText(r.summary?.overall || 'info'))}</span>
        </a>`).join('') : `<div class="card muted">${esc(t('list.empty'))}</div>`}
    </div>`;
  const handle = async files => {
    const st = $('#impstatus');
    let n = 0, last = null;
    for (const f of files) {
      try {
        const parsed = await importFile(f, { onStatus: x => (st.textContent = x), askFs: async () => +(prompt(t('list.askFs', { name: f.name }), '250') || 250) });
        for (const r of parsed) { last = await storeImported(r); n++; }
      } catch (e) { toast(`${f.name}: ${e.message}`, 8000); }
    }
    st.textContent = '';
    if (n === 1 && last) location.hash = `#/r/${encodeURIComponent(last.id)}`;
    else if (n > 0) { toast(t('list.imported', { n })); viewList(); }
  };
  $('#file').addEventListener('change', e => handle([...e.target.files]));
  const pf = $('#pfilter');
  if (pf) { pf.value = settings.personFilter; pf.addEventListener('change', async () => { settings.personFilter = pf.value; await saveAppSettings(); viewList(); }); }
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handle([...e.dataTransfer.files]); });
  $('#demo').addEventListener('click', async () => {
    const now = Date.now();
    for (const [i, k] of DEMO_KINDS.entries()) {
      const d = synthEcg(k, { seed: i + 1 });
      await storeImported({ source: 'demo', fileName: k, date: new Date(now - (i + 1) * 3600e3), fs: d.fs, signal: d.signal });
    }
    toast(t('list.demoCreated', { n: DEMO_KINDS.length }));
    viewList();
  });
}

// ---------------------------------------------------------------- Detailansicht
async function viewRecord(id) {
  const rec = await getRecord(id);
  if (!rec) { app.innerHTML = `<div class="card">${esc(t('rec.notFound'))}</div>`; return; }
  let { a, res } = runAnalysis(rec);
  const iv = a.intervals || {};
  const person = personById(rec.personId);
  const age = ageAt(person, rec.date);
  const lead = rec.device?.lead ? t(rec.device.lead, { m: rec.device.leadMode }) : t('rec.leadDefault');

  app.innerHTML = `
    <div class="row no-print" style="justify-content:space-between;margin-bottom:8px">
      <a class="btn" href="#/">${esc(t('common.back'))}</a>
      <div class="row">
        <button class="btn" id="print">${esc(t('rec.print'))}</button>
        <button class="btn" id="exp-csv">${esc(t('rec.csv'))}</button>
        <button class="btn" id="exp-json">${esc(t('rec.json'))}</button>
        <button class="btn danger" id="del">${esc(t('common.delete'))}</button>
      </div>
    </div>
    <div class="print-only"><h1>${esc(t('rec.reportTitle'))}</h1>
      <p>${[esc(person?.name || ''), esc(sexText(person?.sex)), age != null ? esc(t('common.years', { n: age })) : '', person?.birthDate ? esc(t('rec.born', { date: fmtDay(person.birthDate) })) : '', esc(t('rec.reportMeta', { date: fmtDate(new Date()) }))].filter(Boolean).join(' · ')}</p></div>
    <section class="card summary" id="summary"></section>
    <section class="card strip-card">
      <div class="row" style="justify-content:space-between"><h2>${esc(t('rec.strip'))}</h2>
        <div class="row no-print small">
          <label>${esc(t('rec.gain'))} <select id="gain"><option value="5">5 mm/mV</option><option value="10" selected>10 mm/mV</option><option value="20">20 mm/mV</option></select></label>
          <label>${esc(t('rec.raw'))} <input type="checkbox" id="raw"></label>
        </div></div>
      <div class="strip-wrap"><canvas id="strip"></canvas></div>
      <div class="legend"><span>25 mm/s · <span id="gaintxt">10</span> mm/mV · ${esc(lead)}</span><span><b style="color:#d97706">S</b> ${esc(t('rec.legendS'))}</span><span><b style="color:#dc2626">V</b> ${esc(t('rec.legendV'))}</span><span><b style="color:#6b7280">?</b> ${esc(t('rec.legendU'))}</span></div>
    </section>
    <section id="findings"></section>
    <div class="grid2">
      <section class="card"><h2>${esc(t('rec.values'))}</h2><table class="vals" id="vals"></table></section>
      <section class="card"><h2>${esc(t('rec.avgBeat'))}</h2>
        <div class="tpl-wrap"><canvas id="tpl"></canvas></div>
        <p class="small muted">${esc(t('rec.avgBeatNote', { n: a.template?.beatsUsed || a.beats.length }))}</p>
        <h3 style="margin-top:10px">${esc(t('rec.rrTitle'))}</h3>
        <canvas id="rr"></canvas>
      </section>
    </div>
    <section class="card" id="ai"></section>
    <section class="card no-print">
      <h2>${esc(t('rec.personNote'))}</h2>
      <label class="field">${esc(t('list.person'))} <select id="person">${personOptions(rec.personId)}</select></label>
      ${persons.length ? '' : `<p class="small muted">${t('rec.noPersons')}</p>`}
      <textarea id="note" rows="3" style="width:100%" placeholder="${esc(t('rec.notePh'))}">${esc(rec.note || '')}</textarea>
      <p class="small muted">${esc(t('rec.source', { src: srcName(rec) }))}${rec.fileName && rec.source !== 'demo' ? ' · ' + esc(rec.fileName) : ''} · ${nf(rec.fs)} Hz · ${nf(a.duration, 1)} s</p>
    </section>
    <div class="card print-only small">${esc(t('rec.printNote'))}</div>`;

  const shownBeats = () => (res.isAF ? a.beats.map(b => (b.type === 'S' ? { ...b, type: 'N' } : b)) : a.beats);
  const hrShown = a.hrNN || a.hr;
  const renderSummary = () => {
    const s = $('#summary');
    s.className = `card summary lv-${res.overall}`;
    s.innerHTML = `
      <div class="row" style="justify-content:space-between"><span class="muted">${esc(fmtDate(rec.date))} · ${esc(srcName(rec))}${person ? ` · <b>${esc(person.name)}</b>${age != null ? `, ${esc(t('common.yearsShort', { n: age }))}` : ''}` : ''}</span><span class="badge lv-${res.overall}">${esc(levelText(res.overall))}</span></div>
      <div class="headline">${esc(res.headline)}</div>
      <div class="kpis">
        <div class="kpi"><b>${nf(hrShown)}</b><span>${esc(t('rec.kpiHr'))}</span></div>
        <div class="kpi"><b>${a.beats.length}</b><span>${esc(t('rec.kpiBeats', { s: shownBeats().filter(b => b.type === 'S').length, v: shownBeats().filter(b => b.type === 'V').length }))}</span></div>
        <div class="kpi"><b>${nf(iv.pr)}</b><span>${esc(t('rec.kpiPr'))}</span></div>
        <div class="kpi"><b>${nf(iv.qrs)}</b><span>${esc(t('rec.kpiQrs'))}</span></div>
        <div class="kpi"><b>${nf(iv.qtcF)}</b><span>${esc(t('rec.kpiQtc'))}</span></div>
        <div class="kpi"><b>${a.quality?.score ?? '–'}</b><span>${esc(t('rec.kpiQ'))}</span></div>
      </div>
      ${res.overall === 'abklaeren' ? `<div class="emergency">${esc(t('rec.emergency'))}</div>` : ''}`;
  };
  const renderFindings = () => {
    $('#findings').innerHTML = `<div class="card"><h2>${esc(t('rec.findings'))}</h2>
      ${res.findings.map((f, i) => `
        <details class="finding" ${i < 3 && f.level !== 'ok' && f.level !== 'info' ? 'open' : ''}>
          <summary><span class="badge lv-${f.level}">${esc(levelText(f.level))}</span><span class="t">${esc(f.title)}</span><span class="cert" title="${esc(t('rec.certTitle'))}">${esc(certText(f.certainty))}</span></summary>
          <div class="body">
            <p>${esc(f.text)}</p>
            ${f.meaning ? `<p><b>${esc(t('rec.meaning'))}</b> ${esc(f.meaning)}</p>` : ''}
            ${f.advice ? `<p><b>${esc(t('rec.advice'))}</b> ${esc(f.advice)}</p>` : ''}
            ${f.evidence?.length ? `<ul class="ev">${f.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
            ${f.reliability ? `<p class="rel"><b>${esc(t('rec.reliability'))}</b> ${esc(f.reliability)}</p>` : ''}
          </div>
        </details>`).join('')}
      <p class="small muted">${t('rec.certLegend')}</p></div>`;
  };
  const renderVals = () => {
    const h = a.hrv || {};
    const n = hrNorm(age);
    const rows = [
      [t('v.hrNN'), `${nf(a.hrNN)} /min`, `${n.lo}–${n.hi}`],
      [t('v.hrAll'), `${nf(a.hr)} /min`, ''],
      [t('v.rrRange'), `${nf((a.hrvAll?.minRR || 0) * 1000)}–${nf((a.hrvAll?.maxRR || 0) * 1000)} ms`, ''],
      [t('v.pDur'), `${nf(iv.pDur)} ms`, '< 120'],
      [t('v.pAmp'), `${nf(iv.pAmp, 2)} mV`, iv.pPresent ? '' : t('v.pNotSure')],
      [t('v.pr'), `${nf(iv.pr)} ms`, '120–200'],
      [t('v.qrs'), `${nf(iv.qrs)} ms`, '< 110–120'],
      [t('v.rAmp'), `${nf(iv.rAmp, 2)} mV`, ''],
      [t('v.qt'), `${nf(iv.qt)} ms`, ''],
      [t('v.qtcB'), `${nf(iv.qtcB)} ms`, person?.sex === 'w' ? '≤ 460' : person?.sex === 'm' ? '≤ 450' : '≤ 450/460'],
      [t('v.qtcF'), `${nf(iv.qtcF)} ms`, t('v.qtcFNote')],
      [t('v.st'), `${nf(iv.st, 2)} mV`, `±${nf(0.1, 1)}`],
      [t('v.tAmp'), `${nf(iv.tAmp, 2)} mV`, ''],
      ['SDNN', `${nf((h.sdnn || 0) * 1000)} ms`, t('v.hrvNote')],
      ['RMSSD', `${nf((h.rmssd || 0) * 1000)} ms`, t('v.hrvNote')],
      ['pNN50', `${nf((h.pnn50 || 0) * 100)} %`, ''],
      [t('v.quality'), `${a.quality?.score ?? '–'}/100`, a.quality?.label ? t('q.l.' + a.quality.label) : ''],
    ];
    if (rec.device) rows.push([t('v.device'), `${nf(rec.device.hr)} / ${nf(rec.device.qrs)} / ${nf(rec.device.qtc)}`, t('v.deviceNote')]);
    $('#vals').innerHTML = rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('') +
      (rec.source === 'pdf' ? `<tr><td colspan="3" class="small muted">${esc(t('rec.pdfAcc'))}</td></tr>` : '');
  };
  const renderCharts = printW => {
    if (!$('.strip-wrap') || !$('#rr')) return; // Seite bereits verlassen
    const w = printW || Math.max(300, $('.strip-wrap').clientWidth);
    const gain = +$('#gain').value; $('#gaintxt').textContent = gain;
    let sig = a.signal, fs = a.fs, beats = shownBeats();
    if ($('#raw').checked) { sig = rec.signal; fs = rec.fs; beats = beats.map(b => ({ ...b, idx: Math.round(b.idx * rec.fs / a.fs) })); }
    drawStrip($('#strip'), { signal: sig, fs, beats, width: w, gain, rowSec: printW ? 10 : undefined, print: !!printW });
    if (a.template) drawTemplate($('#tpl'), { template: a.template, intervals: iv, width: Math.min(360, $('#tpl').parentElement.parentElement.clientWidth - 34), labels: { tEnd: t('ch.tEnd') } });
    drawRR($('#rr'), { beats: shownBeats(), duration: a.duration, width: Math.min(520, $('#rr').parentElement.clientWidth - 34) });
  };
  const renderAI = (status = '') => {
    const ai = rec.ai, el = $('#ai');
    const intro = `<p class="small muted">${t('ai.intro')}</p>`;
    if (!ai) {
      el.innerHTML = `<h2>${esc(t('ai.title'))}</h2>${intro}<div class="row no-print"><button class="btn primary" id="runai">${esc(t('ai.start'))}</button><span class="small muted" id="aistatus">${esc(status)}</span></div>`;
      $('#runai').addEventListener('click', () => doAI());
      return;
    }
    const rows = SHOWN.filter(k => ai.labels[k] != null).sort((x, y) => ai.labels[y] - ai.labels[x]);
    el.innerHTML = `<h2>${esc(t('ai.title'))}</h2>${intro}
      <table class="ai-table" style="width:100%">${rows.map(k => {
        const p = ai.labels[k], th = ai.thresholds?.[k];
        const hit = th != null && p >= th;
        return `<tr><td>${esc(t('lbl.' + k))}${k === 'PREMATURE VENTRICULAR COMPLEXES' ? ` <span class="small muted">${esc(t('ai.unreliable'))}</span>` : ''}</td><td style="text-align:right;width:52px"><b>${Math.round(p * 100)} %</b></td>
          <td><div class="bar" title="${th != null ? esc(t('ai.threshold', { p: Math.round(th * 100) })) : ''}"><i class="${hit ? (k === 'SINUS RHYTHM' ? 'hit-ok' : 'hit') : ''}" style="width:${(p * 100).toFixed(1)}%"></i>${th != null ? `<u style="left:${(th * 100).toFixed(1)}%"></u>` : ''}</div></td></tr>`;
      }).join('')}</table>
      <p class="small muted">${esc(t('ai.legend', { n: ai.windows, backend: ai.backend || '', date: fmtDate(ai.date) }))}</p>
      <div class="row no-print"><button class="btn" id="rerunai">${esc(t('ai.rerun'))}</button><span class="small muted" id="aistatus"></span></div>`;
    $('#rerunai').addEventListener('click', () => doAI());
  };
  const doAI = async () => {
    const st = x => { const s = $('#aistatus'); if (s) s.textContent = x; };
    try {
      document.querySelectorAll('#runai,#rerunai').forEach(b => (b.disabled = true));
      const { runAI } = await import('./ai/ecgfounder.js');
      const r = await runAI(rec.signal, rec.fs, st);
      rec.ai = { labels: r.labels, thresholds: r.thresholds, windows: r.windows, backend: r.backend, date: new Date() };
      ({ a, res } = runAnalysis(rec));
      rec.summary = makeSummary(rec, a, res);
      await saveRecord(rec);
      renderSummary(); renderFindings(); renderAI();
      toast(t('ai.done', { ms: r.ms }));
    } catch (e) {
      renderAI(); st(t('common.errorMsg', { msg: e.message }));
    }
  };

  renderSummary(); renderFindings(); renderVals(); renderAI(); renderCharts();
  $('#gain').addEventListener('change', () => renderCharts());
  $('#raw').addEventListener('change', () => renderCharts());
  window.onresize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderCharts(), 150); };
  window.onbeforeprint = () => document.querySelectorAll('.finding').forEach(d => (d.open = true));
  $('#person').addEventListener('change', async e => {
    rec.personId = e.target.value || null;
    persons = await listPersons();
    const r2 = runAnalysis(rec);
    rec.summary = makeSummary(rec, r2.a, r2.res);
    await saveRecord(rec);
    toast(t('rec.assigned'));
    viewRecord(rec.id);
  });
  $('#note').addEventListener('change', async e => { rec.note = e.target.value; await saveRecord(rec); toast(t('rec.noteSaved')); });
  $('#del').addEventListener('click', async () => { if (confirm(t('rec.deleteConfirm'))) { await deleteRecord(rec.id); location.hash = '#/'; } });
  $('#print').addEventListener('click', () => {
    document.querySelectorAll('.finding').forEach(d => (d.open = true));
    renderCharts(1000);
    const after = () => { renderCharts(); window.removeEventListener('afterprint', after); };
    window.addEventListener('afterprint', after);
    setTimeout(() => window.print(), 50);
  });
  const base = `ECG_${rec.date ? new Date(rec.date).toISOString().slice(0, 19).replace(/[-:T]/g, '') : 'export'}`;
  $('#exp-csv').addEventListener('click', () => {
    const lines = [`# ECG export, fs=${rec.fs} Hz, unit mV, ${new Date(rec.date).toISOString()}`, t('rec.csvHeader')];
    for (let i = 0; i < rec.signal.length; i++) lines.push(`${(i / rec.fs).toFixed(4)};${rec.signal[i].toFixed(4)}`);
    download(`${base}.csv`, lines.join('\n') + '\n', 'text/csv');
  });
  $('#exp-json').addEventListener('click', () => download(`${base}.json`, JSON.stringify({
    date: rec.date, fs: rec.fs, unit: 'mV', source: rec.source, device: rec.device ? { ...rec.device, hrPerSecond: undefined } : null,
    analysis: { hr: a.hr, hrNN: a.hrNN, intervals: { ...iv }, hrv: a.hrv, quality: a.quality, beats: a.beats.map(b => ({ t: +b.t.toFixed(3), type: b.type })) },
    findings: res.findings, ai: rec.ai, signal: Array.from(rec.signal, v => +v.toFixed(4)), app: { name: 'ekg-auswertung', version: VERSION, lang: lang() },
  }, null, 1), 'application/json'));

  if (!rec.ai && settings.autoAI && (await modelAvailable())) doAI();
}

let modelOk = null;
async function modelAvailable() {
  if (modelOk != null) return modelOk;
  const url = new URL('models/ecgfounder-1lead.onnx', location.href).href;
  try { for (const k of (await caches.keys()).filter(k => k.startsWith('ekg-big-'))) if (await (await caches.open(k)).match(url)) return (modelOk = true); } catch { /* kein Cache-API */ }
  try { const r = await fetch(url, { method: 'HEAD' }); modelOk = r.ok; } catch { modelOk = false; }
  return modelOk;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const el = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- Gerät
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');
async function viewDevice() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  app.innerHTML = `
    <h1>${esc(t('dev.title'))}</h1>
    <div class="card">
      <p>${t('dev.intro')}</p>
      <div class="row">
        <button class="btn primary" id="ble" ${support.ble ? '' : 'disabled'}>${esc(t('dev.ble'))}</button>
        <button class="btn" id="hid" ${support.hid ? '' : 'disabled'}>${esc(t('dev.hid'))}</button>
      </div>
      ${support.ble ? '' : `<p class="small muted">${esc(t('dev.noBle'))} ${ios ? t('dev.noBleIos') : t('dev.noBleOther')}</p>`}
      <div id="devinfo" class="small" style="margin-top:10px"></div>
      <div class="progress" style="margin-top:8px" hidden id="prog"><i></i></div>
      <div id="devstatus" class="small muted" style="margin-top:6px"></div>
    </div>
    <div class="card" id="devlist" hidden></div>
    <details class="card"><summary>${esc(t('dev.log'))}</summary>
      <p class="small muted">${esc(t('dev.logHint'))}</p>
      <button class="btn" id="copylog">${esc(t('dev.copyLog'))}</button>
      <pre class="log" id="log"></pre>
    </details>`;
  const logEl = $('#log'), lines = [];
  const log = (dir, bytes) => { lines.push(`${new Date().toISOString().slice(11, 23)} ${dir} ${typeof bytes === 'string' ? bytes : hex(bytes)}`); if (lines.length > 2000) lines.shift(); logEl.textContent = lines.slice(-300).join('\n'); };
  $('#copylog').addEventListener('click', () => navigator.clipboard.writeText(`app ${VERSION}\n${navigator.userAgent}\n` + lines.join('\n')).then(() => toast(t('dev.logCopied'))));
  const status = x => ($('#devstatus').textContent = x);
  const prog = v => { const p = $('#prog'); p.hidden = v == null; if (v != null) p.firstElementChild.style.width = `${Math.round(v * 100)}%`; };

  const go = async connect => {
    let tr;
    try {
      status(t('dev.connecting'));
      tr = await connect();
      log('INFO', `connected: ${tr.name} (${tr.kind}${tr.reportSize ? ', report size ' + tr.reportSize : ''})`);
      const c = new ViatomClient(tr, { log });
      const info = await c.getInfo().catch(e => ({ error: e.message }));
      $('#devinfo').innerHTML = info.error ? `<span class="badge lv-auffaellig">${esc(t('dev.noInfo'))}</span> ${esc(info.error)}` :
        t('dev.info', { name: esc(tr.name), model: esc(info.Model || '?'), sn: esc(info.SN || '?'), sw: esc(info.SoftwareVer || '?') });
      if (info.error) throw new Error(info.error);
      await c.setTime().catch(() => {});
      status(t('dev.readingList'));
      const listBytes = await c.readFile('1dlc.dat');
      const list = listBytes ? parseRecordList(listBytes) : [];
      const have = new Set((await listRecords()).filter(r => r.source === 'pulsebit').map(r => r.fileName));
      status(t('dev.count', { n: list.length }));
      const dl = $('#devlist'); dl.hidden = false;
      dl.innerHTML = `<h2>${esc(t('dev.listTitle'))}</h2>
        <div class="row" style="margin-bottom:8px"><button class="btn primary" id="getnew">${esc(t('dev.importNew', { n: list.filter(r => !have.has(r.fileName)).length }))}</button><button class="btn" id="getsel">${esc(t('dev.importSel'))}</button></div>
        <table class="vals">${list.map((r, i) => `<tr><td><label><input type="checkbox" data-i="${i}" ${have.has(r.fileName) ? '' : 'checked'}> ${esc(fmtDate(r.date))}</label></td><td>${r.hr || '–'} /min</td><td>${have.has(r.fileName) ? esc(t('dev.already')) : ''}${r.user ? ' · ' + esc(t('dev.user', { u: r.user === 1 ? 'A' : 'B' })) : ''} → ${esc(personById(importTarget(r.user))?.name || t('dev.noTarget'))}</td></tr>`).join('')}</table>`;
      const fetchSome = async items => {
        let n = 0;
        for (const [k, r] of items.entries()) {
          status(t('dev.loading', { i: k + 1, n: items.length, date: fmtDate(r.date) }));
          const bytes = await c.readFile(r.fileName, (g, s) => prog((k + g / s) / items.length));
          if (!bytes) { log('INFO', `file ${r.fileName} missing`); continue; }
          const parsed = parseEcgFile(bytes, r.fileName);
          await storeImported({ ...parsed, date: r.date, deviceName: tr.name }, importTarget(r.user));
          n++;
        }
        prog(null); status(t('dev.imported', { n })); toast(t('list.imported', { n }));
      };
      $('#getnew').addEventListener('click', () => fetchSome(list.filter(r => !have.has(r.fileName))));
      $('#getsel').addEventListener('click', () => fetchSome([...dl.querySelectorAll('input[data-i]:checked')].map(cb => list[+cb.dataset.i])));
    } catch (e) {
      if (e.name === 'NotFoundError') status(t('dev.cancelled'));
      else { status(t('common.errorMsg', { msg: e.message })); log('ERROR', e.message); }
      prog(null);
    }
  };
  $('#ble').addEventListener('click', () => go(connectBle));
  $('#hid').addEventListener('click', () => go(() => connectHid()));
}

// ---------------------------------------------------------------- Einstellungen
async function viewSettings() {
  app.innerHTML = `
    <h1>${esc(t('s.title'))}</h1>
    <div class="card">
      <h2>${esc(t('s.general'))}</h2>
      <label class="field">${esc(t('common.language'))}<select id="s-lang">${langOptions()}</select></label>
      <p class="small">${t('s.personsHint')}</p>
      <label><input type="checkbox" id="s-ai" ${settings.autoAI ? 'checked' : ''}> ${esc(t('s.autoAI'))}</label>
    </div>
    <div class="card">
      <h2>${esc(t('s.app'))}</h2>
      <p class="small muted">${esc(t('upd.version', { v: VERSION }))}</p>
      <div class="row"><button class="btn" id="chk">${esc(t('upd.check'))}</button><span class="small muted" id="chkstatus"></span></div>
      <h3 style="margin-top:14px">${esc(t('inst.title'))}</h3>
      <p class="small">${esc(t('inst.text'))}</p>
      <div id="instinfo" class="small"></div>
    </div>
    <div class="card">
      <h2>${esc(t('s.offline'))}</h2>
      <p>${esc(t('s.offlineText'))}</p>
      <button class="btn" id="preload">${esc(t('s.preload'))}</button> <span id="prestatus" class="small muted"></span>
    </div>
    <div class="card">
      <h2>${esc(t('s.backup'))}</h2>
      <p class="small muted">${esc(t('s.backupText'))}</p>
      <p class="small" id="storageinfo"></p>
      <div class="row"><button class="btn" id="backup">${esc(t('s.backupDl'))}</button><label class="btn">${esc(t('s.restore'))}<input id="restore" type="file" accept=".json" hidden></label></div>
    </div>
    <div class="card">
      <h2>${esc(t('s.delete'))}</h2>
      <p class="small muted">${esc(t('s.deleteText'))}</p>
      ${persons.length ? `<div class="row" style="margin-bottom:10px"><select id="delperson">${persons.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="">${esc(t('list.noPerson'))}</option></select><button class="btn danger" id="delpersonrecs">${esc(t('s.delPersonRecs'))}</button></div>` : ''}
      <div class="row"><button class="btn danger" id="delrecs">${esc(t('s.delRecs'))}</button><button class="btn danger" id="delall">${esc(t('s.delAll'))}</button></div>
    </div>`;
  $('#s-lang').value = lang();
  $('#s-lang').addEventListener('change', e => changeLang(e.target.value));
  $('#delrecs').addEventListener('click', async () => {
    const n = (await listRecords()).length;
    if (!n) { toast(t('s.deleted', { n: 0 })); return; }
    if (!confirm(t('s.delRecsConfirm', { n }))) return;
    toast(t('s.deleted', { n: await clearRecords() }));
    storageInfo().then(x => { const el = $('#storageinfo'); if (el) el.textContent = x; });
  });
  $('#delpersonrecs')?.addEventListener('click', async () => {
    const pid = $('#delperson').value || null;
    const recs = (await listRecords()).filter(r => (pid ? r.personId === pid : !personById(r.personId)));
    if (!recs.length) { toast(t('s.deleted', { n: 0 })); return; }
    const name = pid ? personById(pid)?.name : t('list.noPerson');
    if (!confirm(t('s.delPersonConfirm', { n: recs.length, name }))) return;
    for (const r of recs) await deleteRecord(r.id);
    toast(t('s.deleted', { n: recs.length }));
  });
  $('#delall').addEventListener('click', async () => {
    if (!confirm(t('s.delAllConfirm'))) return;
    await clearAll();
    persons = []; Object.assign(settings, { autoAI: true, personFilter: 'all', lang: settings.lang });
    await saveAppSettings(); await setSetting('disclaimerAccepted', true);
    toast(t('s.deletedAll'));
    location.hash = '#/';
  });
  $('#s-ai').addEventListener('change', async e => { settings.autoAI = e.target.checked; await saveAppSettings(); toast(t('common.saved')); });
  $('#chk').addEventListener('click', async () => {
    $('#chkstatus').textContent = t('upd.checking');
    const found = await checkForUpdate();
    $('#chkstatus').textContent = found ? t('upd.available') : found === null ? t('upd.failed') : t('upd.none');
  });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#instinfo').innerHTML = standalone ? esc(t('inst.done')) : deferredPrompt ? `<button class="btn primary" id="inst2">${esc(t('inst.button'))}</button>` : ios ? t('inst.ios') : esc(t('inst.other'));
  $('#inst2')?.addEventListener('click', doInstall);
  $('#preload').addEventListener('click', async () => {
    const { initAI } = await import('./ai/ecgfounder.js');
    try { const r = await initAI(x => ($('#prestatus').textContent = x)); $('#prestatus').textContent = t('ai.ready', { backend: r.backend }); }
    catch (e) { $('#prestatus').textContent = t('common.errorMsg', { msg: e.message }); }
  });
  storageInfo().then(x => { const el = $('#storageinfo'); if (el) el.textContent = x; });
  $('#backup').addEventListener('click', async () => download(`ecg-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(), 'application/json'));
  $('#restore').addEventListener('change', async e => {
    try { const n = await importBackup(await e.target.files[0].text()); persons = await listPersons(); toast(t('s.restored', { n })); }
    catch (err) { toast(err.message === 'Keine Sicherungsdatei dieser App' ? t('s.backupBad') : err.message); }
  });
}

// ---------------------------------------------------------------- Personen
async function viewPersons(editId = null) {
  persons = await listPersons();
  const recs = await listRecords();
  const count = id => recs.filter(r => r.personId === id).length;
  const ed = editId === 'new' ? { id: '', name: '', sex: '', birthDate: '', deviceUser: '' } : personById(editId);
  app.innerHTML = `
    <h1>${esc(t('p.title'))}</h1>
    <div class="card">
      <p class="small muted">${t('p.intro')}</p>
      ${persons.length ? `<table class="vals">${persons.map(p => `<tr>
        <td><b>${esc(p.name)}</b><br><span class="small muted">${esc([sexText(p.sex), p.birthDate ? t('common.years', { n: ageAt(p) }) : '', p.deviceUser ? t('dev.user', { u: p.deviceUser === '1' ? 'A' : 'B' }) : ''].filter(Boolean).join(' · ') || t('p.noDetails'))}</span></td>
        <td>${esc(t('p.records', { n: count(p.id) }))}</td>
        <td><button class="btn" data-edit="${esc(p.id)}">${esc(t('common.edit'))}</button></td></tr>`).join('')}</table>` : `<p>${esc(t('p.none'))}</p>`}
      <div style="margin-top:12px"><button class="btn primary" id="add">${esc(t('p.add'))}</button></div>
    </div>
    ${ed ? `<div class="card" id="form">
      <h2>${esc(ed.id ? t('p.edit') : t('p.new'))}</h2>
      <label class="field">${esc(t('p.name'))}<input id="p-name" required value="${esc(ed.name)}" autocomplete="off" maxlength="80"></label>
      <label class="field">${esc(t('p.sex'))}<select id="p-sex"><option value="">${esc(t('sex.none'))}</option><option value="m">${esc(t('sex.m'))}</option><option value="w">${esc(t('sex.w'))}</option></select></label>
      <label class="field">${esc(t('p.birth'))}<input id="p-birth" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(ed.birthDate || '')}"></label>
      <label class="field">${esc(t('p.devUser'))}<select id="p-dev"><option value="">–</option><option value="1">${esc(t('p.devA'))}</option><option value="2">${esc(t('p.devB'))}</option></select>
        <span class="small muted">${esc(t('p.devHint'))}</span></label>
      <div class="row">
        <button class="btn primary" id="p-save">${esc(t('common.save'))}</button>
        <button class="btn" id="p-cancel">${esc(t('common.cancel'))}</button>
        ${ed.id ? `<button class="btn danger" id="p-del">${esc(t('p.delete'))}</button>` : ''}
      </div>
    </div>` : ''}`;
  $('#add').addEventListener('click', () => viewPersons('new').then(() => $('#p-name').focus()));
  app.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => viewPersons(b.dataset.edit)));
  if (!ed) return;
  $('#p-sex').value = ed.sex || ''; $('#p-dev').value = ed.deviceUser || '';
  $('#p-cancel').addEventListener('click', () => viewPersons());
  $('#p-save').addEventListener('click', async () => {
    const name = $('#p-name').value.trim();
    if (!name) { toast(t('p.nameMissing')); return; }
    const dev = $('#p-dev').value;
    if (dev) for (const o of persons) if (o.id !== ed.id && o.deviceUser === dev) await savePerson({ ...o, deviceUser: '' });
    const p = { id: ed.id || newPersonId(), name, sex: $('#p-sex').value, birthDate: $('#p-birth').value, deviceUser: dev };
    await savePerson(p);
    persons = await listPersons();
    // Grenzwerte hängen von Geschlecht/Alter ab → Zusammenfassungen aktualisieren
    for (const r of recs.filter(r => r.personId === p.id)) { const { a, res } = runAnalysis(r); r.summary = makeSummary(r, a, res); await saveRecord(r); }
    toast(t('common.saved')); viewPersons();
  });
  $('#p-del')?.addEventListener('click', async () => {
    if (!confirm(t('p.deleteConfirm', { name: ed.name, n: count(ed.id) }))) return;
    await deletePerson(ed.id);
    persons = await listPersons();
    for (const r of recs.filter(r => r.personId === ed.id)) { r.personId = null; const { a, res } = runAnalysis(r); r.summary = makeSummary(r, a, res); await saveRecord(r); }
    if (settings.personFilter === ed.id) { settings.personFilter = 'all'; await saveAppSettings(); }
    viewPersons();
  });
}

// ---------------------------------------------------------------- Info
async function viewInfo() {
  const c = CALIBRATION?.af;
  app.innerHTML = `
    <h1>${esc(t('i.title'))}</h1>
    <div class="card">
      <h2>${esc(t('i.what'))}</h2>
      <ol><li>${t('i.l1')}</li><li>${t('i.l2')}</li><li>${t('i.l3')}</li><li>${t('i.l4')}</li></ol>
    </div>
    <div class="card">
      <h2>${esc(t('i.how'))}</h2>
      ${c ? `<p>${esc(t('i.afIntro', { a: nf(CALIBRATION.n.A), o: nf(CALIBRATION.n.N + CALIBRATION.n.O) }))}</p>
      <ul><li>${esc(t('i.af1', { auc: nf(c.auc, 3), sens: nf(c.sens_at_spec95 * 100) }))}</li><li>${esc(t('i.af2'))}</li><li>${esc(t('i.af3'))}</li></ul>` : ''}
      <p>${esc(t('i.other'))}</p>
      <p>${t('i.limits')}</p>
    </div>
    <div class="card small">
      <h2>${esc(t('i.licenses'))}</h2>
      <ul><li>${esc(t('i.lic1'))}</li><li>${esc(t('i.lic2'))}</li><li>${esc(t('i.lic3'))}</li><li>${esc(t('i.lic4'))}</li><li>${esc(t('i.lic5'))}</li></ul>
      <p>${esc(t('i.noAffil'))}</p>
      <p>${esc(t('upd.version', { v: VERSION }))} · <a href="https://github.com/laserrapt0r/Tool-for-Pulsebit-EX" target="_blank" rel="noopener">${esc(t('i.source'))}</a></p>
    </div>`;
}

// ---------------------------------------------------------------- Sprache
const langOptions = () => Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
async function changeLang(l) {
  settings.lang = l; await saveAppSettings();
  await setLang(l);
  renderChrome();
  route();
}
function renderChrome() {
  applyStatic();
  document.title = t('app.title');
  for (const id of ['lang', 'dlg-lang']) { const s = $('#' + id); if (s) { if (!s.options.length) s.innerHTML = langOptions(); s.value = lang(); } }
}

// ---------------------------------------------------------------- Speicher
/** Bittet den Browser, die Daten nicht bei Speicherknappheit zu löschen. */
async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* egal */ }
}
async function storageInfo() {
  try {
    const persisted = await navigator.storage?.persisted?.();
    const est = await navigator.storage?.estimate?.();
    return `${t(persisted ? 's.persistOk' : 's.persistNo')}${est?.usage ? ` · ${nf(est.usage / 1e6)} MB` : ''}`;
  } catch { return ''; }
}

// ---------------------------------------------------------------- Installation & Updates
let deferredPrompt = null, swReg = null, waitingWorker = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#install').hidden = false; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; $('#install').hidden = true; toast(t('inst.done')); });
async function doInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null; $('#install').hidden = true;
}

function askVersion(worker) {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = e => resolve(e.data?.version || null);
    worker.postMessage({ type: 'VERSION' }, [ch.port2]);
    setTimeout(() => resolve(null), 1500);
  });
}
async function showUpdate(worker) {
  waitingWorker = worker;
  const v = await askVersion(worker);
  $('#update-text').textContent = v ? t('upd.availableV', { v }) : t('upd.available');
  $('#update').hidden = false;
}
async function checkForUpdate() {
  if (!swReg) return null;
  try { await swReg.update(); } catch { return null; } // offline oder Server nicht erreichbar
  await new Promise(r => setTimeout(r, 1200));
  const w = swReg.waiting || (swReg.installing && await new Promise(r => {
    const i = swReg.installing; i.addEventListener('statechange', () => i.state === 'installed' && r(i)); setTimeout(() => r(null), 8000);
  }));
  if (w && navigator.serviceWorker.controller) { showUpdate(w); return true; }
  return false;
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try { swReg = await navigator.serviceWorker.register('sw.js'); } catch { return; }
  if (swReg.waiting && navigator.serviceWorker.controller) showUpdate(swReg.waiting);
  swReg.addEventListener('updatefound', () => {
    const w = swReg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (userAcceptedUpdate && !reloading) { reloading = true; location.reload(); } });
  // Regelmäßig und beim Zurückkehren zur App nach neuen Versionen sehen
  setInterval(() => swReg.update().catch(() => {}), 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') swReg.update().catch(() => {}); });
}
let userAcceptedUpdate = false;
$('#update-now').addEventListener('click', () => { userAcceptedUpdate = true; waitingWorker?.postMessage({ type: 'SKIP_WAITING' }); $('#update').hidden = true; });
$('#update-later').addEventListener('click', () => { $('#update').hidden = true; });
$('#install').addEventListener('click', doInstall);
$('#lang').addEventListener('change', e => changeLang(e.target.value));
$('#dlg-lang').addEventListener('change', e => changeLang(e.target.value));

// ---------------------------------------------------------------- Start
(async function start() {
  await loadSettings();
  await setLang(settings.lang || detectLang());
  renderChrome();
  if (!(await getSetting('disclaimerAccepted', false))) {
    const d = $('#disclaimer'); d.showModal();
    d.addEventListener('close', () => { setSetting('disclaimerAccepted', true); requestPersist(); }, { once: true });
  }
  route();
  registerSW();
  requestPersist();
})();
