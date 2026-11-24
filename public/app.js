'use strict';
/* CANVASS Lead Finder ERP — browser client. All data comes from the local server API; nothing here is invented. */

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const safeUrl = u => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const link = (u, text) => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(text || s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : esc(text || '—'); };
const pill = (text, cls = text) => `<span class="pill ${esc(String(cls).split(' ')[0])}">${esc(text)}</span>`;
const today = () => new Date().toISOString().slice(0, 10);
let PIN = ''; try { PIN = sessionStorage.getItem('canvassPin') || ''; } catch { /* storage blocked */ }

function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }

function modal(html, onReady) {
  const m = $('#modal'); m.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) close(); };
  onReady && onReady(m, close); return close;
}
function confirmBox(message, okText = 'Confirm') {
  return new Promise(resolve => modal(`<h2>Please confirm</h2><p>${esc(message)}</p><div class="row mt"><button class="btn" id="mOk">${esc(okText)}</button><button class="btn plain" id="mNo">Cancel</button></div>`,
    (m, close) => { $('#mOk', m).onclick = () => { close(); resolve(true); }; $('#mNo', m).onclick = () => { close(); resolve(false); }; $('#mOk', m).focus(); }));
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'canvass', ...(PIN ? { 'x-canvass-pin': PIN } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) { await askPin(); return api(path, { method, body, raw }); }
  if (raw) { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed'); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}
function askPin() {
  return new Promise(resolve => modal(`<h2>Access PIN</h2><p class="muted">This Canvass server is shared on the network and needs its PIN.</p><label class="f">PIN<input class="in" id="pinIn" type="password" autocomplete="off"></label><div class="row mt"><button class="btn" id="pinOk">Continue</button></div>`,
    (m, close) => { $('#pinIn', m).focus(); const go = () => { PIN = $('#pinIn', m).value; try { sessionStorage.setItem('canvassPin', PIN); } catch { /* ignore */ } close(); resolve(); }; $('#pinOk', m).onclick = go; $('#pinIn', m).onkeydown = e => e.key === 'Enter' && go(); }));
}
async function download(path, fallbackName) {
  try {
    const res = await api(path, { raw: true });
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message); }
}

// ---------- shared state ----------
const S = { settings: null, health: null, dash: null };
async function refreshMeta() {
  [S.health, S.settings, S.dash] = await Promise.all([api('/health'), api('/settings'), api('/dashboard')]);
  const t = S.dash.totals;
  const nq = $('#navQualified'); nq.textContent = t.qualified; nq.hidden = !t.qualified;
  const nd = $('#navDue'); nd.textContent = t.followUpsDue; nd.hidden = !t.followUpsDue; nd.title = 'Follow-ups due';
  $('#status').innerHTML = `<div><span class="dot ${S.health.placesKey ? 'on' : 'off'}"></span>Google Places ${S.health.placesKey ? 'connected' : 'key not set'}</div>
    <div><span class="dot ${S.health.pageSpeedKey ? 'on' : 'off'}"></span>PageSpeed ${S.health.pageSpeedKey ? 'key set' : 'free quota'}</div>
    ${S.health.budget?.enabled ? `<div title="Google Places requests this billing month (Pacific Time). Canvass refuses requests beyond your limit.">Google requests: <b>${S.health.budget.used}</b> / ${S.health.budget.limit} this month</div>` : '<div style="color:var(--bad)">Free-tier protection off</div>'}
    <div>${S.health.demoMode ? '<span class="pill demo">Demo mode on</span>' : 'Production data'}</div><div>v${esc(S.health.version)}</div>`;
}
const industryOptions = (sel, any = 'Choose industry') => `<option value="">${esc(any)}</option>` + S.settings.industries.map(i => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('');

// ---------- charts ----------
const PALETTE = { Qualified: 'good', Unverified: 'warn', Rejected: 'bad', 'No Opportunity': 'muted', Unprocessed: 'muted' };
const CSSVAR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--muted)', brand: 'var(--brand)' };
function bars(obj, { limit = 8, colorFor } = {}) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!entries.length) return '<div class="empty">No processed data yet.</div>';
  const max = Math.max(...entries.map(e => e[1]));
  return `<div class="bars">${entries.map(([k, v]) => `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><div class="track"><i class="${colorFor ? colorFor(k) : ''}" style="width:${Math.max(3, Math.round(100 * v / max))}%"></i></div><b>${v}</b></div>`).join('')}</div>`;
}
function donut(obj) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v > 0);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (!total) return '<div class="empty">No processed data yet.</div>';
  let acc = 0; const r = 52, C = 2 * Math.PI * r;
  const arcs = entries.map(([k, v]) => { const len = C * v / total, off = -acc; acc += len; return `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${CSSVAR[PALETTE[k] || 'brand']}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${off}" transform="rotate(-90 70 70)"><title>${esc(k)}: ${v}</title></circle>`; }).join('');
  return `<div class="donut-wrap"><svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Validation results">${arcs}<text x="70" y="68" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${total}</text><text x="70" y="88" text-anchor="middle" font-size="11" fill="var(--muted)">companies</text></svg>
    <div class="legend">${entries.map(([k, v]) => `<span><i style="background:${CSSVAR[PALETTE[k] || 'brand']}"></i>${esc(k)} · <b>${v}</b> (${Math.round(100 * v / total)}%)</span>`).join('')}</div></div>`;
}

// ---------- pages ----------
const pages = {};

pages.dashboard = async el => {
  await refreshMeta();
  const d = S.dash, t = d.totals;
  const k = (label, v, cls = '', href = '') => `<a class="kpi ${cls}" ${href ? `href="${href}"` : ''}><div class="l">${esc(label)}</div><div class="v">${v}</div></a>`;
  el.innerHTML = `
  ${d.demoMode ? `<div class="banner demo">⚠ Demo mode is on. ${d.demoRecords} fictional demonstration companies are included in these statistics. Turn demo mode off in Settings for production figures.</div>` : ''}
  <div class="page-head"><div><h1>Dashboard</h1><p>Figures come only from companies the ERP has actually processed. ${esc(fmtDateTime(d.generatedAt))}</p></div>
  <div class="row"><a class="btn" href="#finder">Find leads</a><a class="btn ghost" href="#bulk">Upload a list</a></div></div>
  <div class="kpis">
    ${k('Qualified leads', t.qualified, 'hero', '#leads')}
    ${k('Companies discovered', t.discovered)}${k('Active (verified)', t.active, 'good')}${k(`Established ≤ ${S.settings.eligibilityYears} years`, t.withinWindow)}
    ${k('Unverified', t.unverified, 'warn', '#leads/Unverified')}${k('Rejected', t.rejected, 'bad', '#leads/Rejected')}${k('No opportunity', t.noOpportunity, '', '#leads/No Opportunity')}
    ${k('Without websites', t.withoutWebsite)}${k('Weak Google profiles', t.weakGbp)}${k('Website issues', t.websiteIssues)}
    ${k('High-priority leads', t.highPriority, 'good')}${k('Transferred to sales', t.transferred, '', '#pipeline')}${k('Follow-ups due', t.followUpsDue, t.followUpsDue ? 'bad' : '', '#pipeline')}${k('Converted customers', t.converted, 'good')}
  </div>
  <div class="grid g3">
    <section class="card"><h2>Validation results</h2>${donut(d.charts.validation)}</section>
    <section class="card"><h2>Industry-wise leads</h2>${bars(d.charts.industry)}</section>
    <section class="card"><h2>Location-wise leads</h2>${bars(d.charts.location)}</section>
    <section class="card"><h2>Detected issue categories</h2>${bars(d.charts.issues, { colorFor: k => k.startsWith('Google profile') ? 'warn' : '' })}</section>
    <section class="card"><h2>Recommended Canvass services</h2><p class="small muted" style="margin-top:-8px">Across qualified leads</p>${bars(d.charts.services)}</section>
    <section class="card"><h2>Sales pipeline</h2>${bars(Object.fromEntries(Object.entries(d.charts.pipeline).filter(([, v]) => v)), { limit: 7, colorFor: k => k === 'Won' ? 'good' : k === 'Lost' ? 'bad' : '' })}</section>
  </div>
  <section class="card mt"><div class="split"><h2 style="margin:0">Recent processing jobs</h2><a href="#reports" class="small">All history</a></div><div id="dashJobs" class="mt"></div></section>`;
  const list = await api('/jobs');
  $('#dashJobs').innerHTML = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Started</th><th>Type</th><th>Status</th><th>Processed</th><th>Results</th></tr></thead><tbody>${list.slice(0, 6).map(j => `<tr><td class="num">${esc(fmtDateTime(j.startedAt || j.createdAt))}</td><td>${esc(jobLabel(j))}</td><td>${pill(j.status, j.status === 'done' ? 'pass' : j.status === 'failed' ? 'Rejected' : 'Unknown')}</td><td class="num">${j.progress?.done ?? 0} / ${j.progress?.total ?? 0}</td><td class="small">${esc(countsText(j.counts))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No searches or uploads yet. Start with the Google Auto Lead Finder or Bulk Upload.</div>';
};
const jobLabel = j => j.type === 'discovery' ? `Google search: ${j.params?.category || j.params?.industryId} in ${[j.params?.area, j.params?.city].filter(Boolean).join(', ')}` : j.type === 'bulk' ? `Upload: ${j.params?.fileName}` : 'Re-verification';
const countsText = c => Object.entries(c || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';

// ----- job progress panel (shared by both finder modules) -----
let jobTimer = null;
function watchJob(el, jobId) {
  clearInterval(jobTimer);
  const draw = async () => {
    let j; try { j = await api('/jobs/' + jobId); } catch { return; }
    const pct = j.progress?.total ? Math.round(100 * j.progress.done / j.progress.total) : (j.status === 'done' ? 100 : 3);
    el.innerHTML = `<div class="split"><h2 style="margin:0">${esc(jobLabel(j))}</h2>${pill(j.status, j.status === 'done' ? 'pass' : j.status === 'failed' ? 'Rejected' : 'Unknown')}</div>
      <p class="small muted">${esc(j.progress?.phase || '')} · ${j.progress?.done ?? 0} of ${j.progress?.total ?? '?'} processed</p>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="small"><b>${esc(countsText(j.counts))}</b></p>
      ${j.error ? `<div class="banner bad">${esc(j.error)}</div>` : ''}${j.note ? `<div class="banner info">${esc(j.note)}</div>` : ''}
      <div class="row" style="margin-bottom:10px">${['queued', 'running'].includes(j.status) ? '<button class="btn sm danger" id="jobStop">Stop</button>' : '<a class="btn sm" href="#leads">View qualified leads</a>'}</div>
      <div class="log" id="jobLog">${esc((j.log || []).slice(-80).join('\n'))}</div>`;
    const lg = $('#jobLog', el); if (lg) lg.scrollTop = lg.scrollHeight;
    const stop = $('#jobStop', el); if (stop) stop.onclick = async () => { await api(`/jobs/${jobId}/cancel`, { method: 'POST' }); toast('Stopping after the current companies finish.'); };
    if (!['queued', 'running'].includes(j.status)) { clearInterval(jobTimer); refreshMeta(); }
  };
  el.hidden = false; draw(); jobTimer = setInterval(draw, 1500);
}

pages.finder = async el => {
  await refreshMeta();
  const s = S.settings, last = (() => { try { return JSON.parse(localStorage.getItem('canvassFinder') || '{}'); } catch { return {}; } })();
  el.innerHTML = `
  <div class="page-head"><div><h1>Google Auto Lead Finder</h1><p>Choose where and what to search. The ERP finds businesses through the Google Places API, then verifies, audits, scores and validates each one automatically. Only qualified leads move to the sales pipeline.</p></div></div>
  ${S.health.placesKey ? '' : '<div class="banner info">Automatic discovery needs a Google Places API key (Places API (New), billing enabled). Add it in <a href="#settings">Settings</a>. Bulk Upload works without a key.</div>'}
  <div class="grid g2">
  <section class="card"><h2>Search</h2>
    <form id="findForm" class="form">
      <label class="f">Country<input class="in" name="country" list="countries" value="${esc(last.country || s.defaultCountry)}" required></label>
      <label class="f">City<input class="in" name="city" list="cities" value="${esc(last.city || 'Dubai')}" required></label>
      <label class="f">Area or location <small>(optional)</small><input class="in" name="area" value="${esc(last.area || '')}" placeholder="e.g. Business Bay"></label>
      <label class="f">Business industry<select class="in" name="industryId" required>${industryOptions(last.industryId)}</select></label>
      <label class="f">Business category <small>(optional)</small><input class="in" name="category" list="catList" value="${esc(last.category || '')}" placeholder="e.g. fit-out company"></label>
      <label class="f">Qualified leads required<input class="in" name="count" type="number" min="1" max="200" value="${esc(last.count || 10)}" required></label>
    </form>
    <datalist id="countries"><option>United Arab Emirates</option><option>Saudi Arabia</option><option>Qatar</option><option>Oman</option><option>Bahrain</option><option>Kuwait</option><option>India</option><option>United Kingdom</option></datalist>
    <datalist id="cities"><option>Dubai</option><option>Abu Dhabi</option><option>Sharjah</option><option>Ajman</option><option>Ras Al Khaimah</option><option>Fujairah</option><option>Umm Al Quwain</option><option>Al Ain</option></datalist>
    <datalist id="catList"></datalist>
    <p class="small muted" id="estimate"></p>
    <div class="row"><button class="btn" id="findGo" ${S.health.placesKey ? '' : 'disabled'}>Find and validate leads</button><button class="btn plain" id="schedGo" ${S.health.placesKey ? '' : 'disabled'}>Repeat this search automatically…</button></div>
  </section>
  <section class="card" id="jobPanel" hidden></section>
  <section class="card" id="howPanel"><h2>What happens to each company</h2><ol class="small" style="padding-left:18px;margin:0;display:grid;gap:4px">
    <li>Confirm industry and location from Google categories and address</li><li>Exclude closed, out-of-area, large and duplicate businesses</li>
    <li>Check active status (Google status plus recent reviews, working website, hours, phone)</li><li>Check company and website age (documented dates, RDAP domain records, Internet Archive history)</li>
    <li>Audit the Google Business Profile and analyse available reviews</li><li>Audit the website (availability, HTTPS, mobile, SEO, enquiry paths, PageSpeed)</li>
    <li>Score the opportunity, recommend Canvass services and draft pitches</li><li>Qualified leads move to the sales pipeline automatically</li></ol>
    <p class="small muted">Anything that cannot be verified is labelled Unverified and kept out of the pipeline.</p></section>
  </div>
  <section class="card mt"><h2>Scheduled searches</h2><div id="schedList"></div></section>`;
  const form = $('#findForm');
  const upd = () => {
    const f = Object.fromEntries(new FormData(form)); const ind = s.industries.find(i => i.id === f.industryId);
    $('#catList').innerHTML = (ind?.keywords || []).map(k => `<option>${esc(k)}</option>`).join('');
    const cap = Math.min(s.maxCandidatesPerSearch, Math.max((+f.count || 1) * 6, 20)), queries = f.category ? 1 : 1 + Math.min(4, ind?.keywords?.length || 0);
    const pagesMax = Math.min(Math.ceil(cap / 20) + queries, queries * 3);
    const b = S.health.budget, left = b?.enabled ? Math.min(b.remaining, b.dayRemaining) : null;
    $('#estimate').innerHTML = esc(`Analyses up to ${cap} companies and stops early once ${+f.count || 1} qualified leads are found. Uses up to ${pagesMax} Google Places requests.`) +
      (left === null ? ' <b style="color:var(--bad)">Free-tier protection is off.</b>' : ` <b>${left} requests left within your limits</b> (${b.used}/${b.limit} this month, ${b.dayUsed}/${b.dayLimit} today).` + (left < pagesMax ? ' <span style="color:var(--warn)">The search will stop when the limit is reached; companies found so far are still processed.</span>' : ''));
  };
  form.oninput = upd; upd();
  $('#findGo').onclick = async () => {
    if (!form.reportValidity()) return;
    const body = Object.fromEntries(new FormData(form)); try { localStorage.setItem('canvassFinder', JSON.stringify(body)); } catch { /* ignore */ }
    try { const job = await api('/discover', { method: 'POST', body }); $('#howPanel').hidden = true; watchJob($('#jobPanel'), job.id); } catch (e) { toast(e.message, 6000); }
  };
  $('#schedGo').onclick = () => {
    if (!form.reportValidity()) return;
    const params = Object.fromEntries(new FormData(form));
    modal(`<h2>Repeat this search</h2><p class="small muted">Runs while the Canvass server is running. New companies only; duplicates are skipped.</p>
      <label class="f">Name<input class="in" id="schName" value="${esc((params.category || S.settings.industries.find(i => i.id === params.industryId)?.name) + ' in ' + params.city)}"></label>
      <label class="f mt">Frequency<select class="in" id="schEvery"><option value="24">Daily</option><option value="168" selected>Weekly</option><option value="720">Monthly</option></select></label>
      <div class="row mt"><button class="btn" id="schOk">Save schedule</button></div>`, (m, close) => {
      $('#schOk', m).onclick = async () => { try { await api('/schedules', { method: 'POST', body: { name: $('#schName', m).value, everyHours: +$('#schEvery', m).value, params } }); close(); toast('Schedule saved.'); drawSchedules(); } catch (e) { toast(e.message); } };
    });
  };
  const drawSchedules = async () => {
    const list = await api('/schedules');
    $('#schedList').innerHTML = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Every</th><th>Last run</th><th>Result</th><th></th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x.name)}</td><td>${x.everyHours >= 720 ? 'Month' : x.everyHours >= 168 ? 'Week' : 'Day'}</td><td>${esc(fmtDateTime(x.lastRunAt))}</td><td class="small">${esc(x.lastResult || '—')}</td><td><button class="btn sm danger" data-del="${esc(x.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No scheduled searches.</div>';
    $$('[data-del]', $('#schedList')).forEach(b => b.onclick = async () => { await api('/schedules/' + b.dataset.del, { method: 'DELETE' }); drawSchedules(); });
  };
  drawSchedules();
  const running = (await api('/jobs')).find(j => j.type === 'discovery' && ['queued', 'running'].includes(j.status));
  if (running) { $('#howPanel').hidden = true; watchJob($('#jobPanel'), running.id); }
};

pages.bulk = async el => {
  await refreshMeta();
  let parsed = null, fileName = '';
  el.innerHTML = `
  <div class="page-head"><div><h1>Bulk Upload Lead Finder</h1><p>Upload Excel or CSV files, or paste website URLs, company names or Google Maps links. Every row goes through the same verification, audit and validation engine as the Google finder.</p></div></div>
  ${S.health.placesKey ? '' : '<div class="banner info">Without a Google Places key, Google Business checks are skipped. Websites and age are still checked, but most companies will stay Unverified until activity is confirmed.</div>'}
  <div class="grid g2">
  <section class="card"><h2>1. Add companies</h2>
    <div class="drop" id="drop" tabindex="0" role="button">Drop an Excel (.xlsx, .xls) or CSV file here, or click to choose<br><small>Columns recognised: Company, Website, Phone, Email, Address, City, Country, Industry, Google Maps link, Instagram, LinkedIn, Established date + source</small></div>
    <input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
    <p id="fileInfo" class="small"></p>
    <label class="f mt">Or paste one per line (URLs, company names or Google Maps links)<textarea class="in" id="paste" rows="7" placeholder="https://example-business.ae&#10;Olive Interiors LLC&#10;https://maps.app.goo.gl/..."></textarea></label>
  </section>
  <section class="card"><h2>2. Batch checks <small class="muted">(optional)</small></h2>
    <p class="small muted" style="margin-top:-6px">Set these to reject companies outside your target industry or location.</p>
    <div class="form"><label class="f">Industry<select class="in" id="bInd">${industryOptions('', 'Any industry')}</select></label>
    <label class="f">City<input class="in" id="bCity" list="cities2" placeholder="Any"></label><label class="f">Country<input class="in" id="bCountry" value="${esc(S.settings.defaultCountry)}"></label></div>
    <datalist id="cities2"><option>Dubai</option><option>Abu Dhabi</option><option>Sharjah</option><option>Ajman</option><option>Ras Al Khaimah</option></datalist>
    <div class="row mt"><button class="btn" id="bulkGo">Process list</button></div>
    <h3>Previous Canvass list</h3><p class="small muted">Re-check the 102 businesses from the earlier version of the app (in <code>legacy/</code>) with the new engine.</p>
    <button class="btn plain" id="legacyGo">Import and re-validate legacy list</button>
  </section></div>
  <section class="card mt" id="jobPanel" hidden></section>`;
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click(); drop.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && readFile(file.files[0]);
  async function readFile(f) {
    try {
      if (!window.XLSX) throw new Error('Spreadsheet reader not loaded.');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      for (const addr of Object.keys(ws)) { if (addr[0] === '!') continue; const cell = ws[addr]; if (cell.l?.Target) { const p = XLSX.utils.decode_cell(addr); (rows[p.r] ||= [])[p.c] = cell.l.Target; } }
      parsed = rows.filter(r => r && r.some(v => String(v).trim())); fileName = f.name;
      $('#fileInfo').innerHTML = `<b>${esc(f.name)}</b>: ${parsed.length - 1} data rows. Columns: ${esc((parsed[0] || []).filter(Boolean).join(', ').slice(0, 300))}`;
    } catch (e) { parsed = null; $('#fileInfo').textContent = 'Could not read the file: ' + e.message; }
  }
  $('#bulkGo').onclick = async () => {
    const text = $('#paste').value.trim();
    if (!parsed && !text) return toast('Choose a file or paste some companies first.');
    try {
      const job = await api('/bulk', { method: 'POST', body: { rows: parsed || [], text, fileName: fileName || 'Pasted list', industryId: $('#bInd').value, city: $('#bCity').value.trim(), country: $('#bCountry').value.trim() } });
      watchJob($('#jobPanel'), job.id); $('#jobPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message, 6000); }
  };
  $('#legacyGo').onclick = async () => {
    if (!await confirmBox('Process the 102 businesses from the previous app? Duplicates already in the ERP are skipped.', 'Process list')) return;
    try { const job = await api('/bulk/legacy', { method: 'POST' }); watchJob($('#jobPanel'), job.id); } catch (e) { toast(e.message, 6000); }
  };
  const running = (await api('/jobs')).find(j => j.type === 'bulk' && ['queued', 'running'].includes(j.status));
  if (running) watchJob($('#jobPanel'), running.id);
};

pages.leads = async (el, arg) => {
  await refreshMeta();
  const cats = ['Qualified', 'Unverified', 'No Opportunity', 'Rejected'];
  const tab = cats.includes(arg) ? arg : arg === 'Duplicates' ? 'Duplicates' : 'Qualified';
  const t = S.dash.totals, counts = { Qualified: t.qualified, Unverified: t.unverified, 'No Opportunity': t.noOpportunity, Rejected: t.rejected, Duplicates: t.duplicatesSkipped };
  const intro = { Qualified: 'Companies that passed every mandatory check and have confirmed improvement opportunities. These are in the sales pipeline.',
    Unverified: 'Missing evidence for age, activity, authenticity, location or industry. Add evidence on the company card to re-validate. Never transferred automatically.',
    'No Opportunity': 'Active and eligible, but no confirmed digital improvement need was found.',
    Rejected: 'Excluded: older than the eligibility window, closed, large/chain, out of location, irrelevant industry or invalid.',
    Duplicates: 'Entries skipped because the company already exists (matched by Place ID, website domain, phone, or name and location).' };
  el.innerHTML = `
  <div class="page-head"><div><h1>Qualified Leads</h1><p>${esc(intro[tab])}</p></div></div>
  ${S.dash.demoMode ? '<div class="banner demo">Demo mode is on — companies marked [DEMO] are fictional.</div>' : ''}
  <div class="tabs">${[...cats, 'Duplicates'].map(c => `<a class="tab ${c === tab ? 'active' : ''}" href="#leads/${encodeURIComponent(c)}">${c === 'Duplicates' ? 'Duplicates skipped' : esc(c)}<span class="c">${counts[c] ?? 0}</span></a>`).join('')}</div>
  <section class="card" id="leadList"></section>`;
  if (tab === 'Duplicates') {
    const h = await api('/history');
    $('#leadList').innerHTML = h.duplicates.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Skipped entry</th><th>Matched existing record</th><th>Matched by</th><th>Source</th></tr></thead><tbody>${h.duplicates.map(d => `<tr><td class="num">${esc(fmtDateTime(d.at))}</td><td>${esc(d.name)}</td><td>${d.matchedId ? `<a href="#" data-open="${esc(d.matchedId)}">${esc(d.matchedName)}</a>` : esc(d.matchedName)}</td><td>${esc(d.by)}</td><td class="small">${esc(d.source)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No duplicates skipped.</div>';
    $$('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); openCompany(a.dataset.open); });
    return;
  }
  const st = { q: '', industry: '', priority: '', sort: 'score', page: 0 };
  const box = $('#leadList');
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><input class="in" id="lq" placeholder="Search name, website, phone, area" style="max-width:280px">
    <select class="in" id="lind" style="max-width:220px">${industryOptions('', 'All industries')}</select>
    ${tab === 'Qualified' ? '<select class="in" id="lpr" style="max-width:160px"><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select>' : ''}
    <select class="in" id="lsort" style="max-width:170px"><option value="score">Highest score</option><option value="recent">Recently updated</option><option value="name">Name A–Z</option></select>
    <button class="btn plain sm" id="lre" title="Runs all checks again for the companies listed on this page">Re-verify this page</button></div><div id="lrows"></div>`;
  const draw = async () => {
    const qs = new URLSearchParams({ category: tab, q: st.q, industry: st.industry, priority: st.priority, sort: st.sort, page: st.page, size: 50 });
    const d = await api('/companies?' + qs);
    st.ids = d.items.map(x => x.id);
    $('#lrows').innerHTML = d.items.length ? `<div class="tbl-wrap"><table><thead><tr><th>Company</th><th>${tab === 'Qualified' ? 'Priority' : 'Reason'}</th><th>Score</th><th>Findings</th><th>Recommended services</th><th>Website</th><th>Age · Activity</th><th>Verified</th></tr></thead><tbody>
      ${d.items.map(c => `<tr class="click" data-id="${esc(c.id)}"><td><b>${esc(c.name)}</b><div class="sub">${esc([c.industry, c.area, c.city].filter(Boolean).join(' · '))}</div></td>
        <td>${tab === 'Qualified' ? pill(c.priority || '—') : `<span class="small">${esc(c.reasons[0] || '—')}</span>`}</td>
        <td class="score">${c.score ?? '—'}</td>
        <td class="small">${c.confirmedIssues} confirmed · ${c.potentialIssues} potential<div class="sub">${esc(c.topIssues.join('; '))}</div></td>
        <td class="small">${esc(c.services.join(', ') || '—')}</td>
        <td class="small">${c.website ? link(c.website) : '—'}<div class="sub">${esc(c.websiteStatus)}</div></td>
        <td>${pill(c.age || '—')} ${pill(c.activity || '—', c.activity.startsWith('Closed') ? 'Closed' : c.activity)}</td>
        <td class="small num">${esc(fmtDate(c.lastVerifiedAt))}</td></tr>`).join('')}</tbody></table></div>
      <div class="split mt"><span class="small muted">${d.total} companies</span><div class="row"><button class="btn sm plain" id="pv" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm plain" id="nx" ${(st.page + 1) * 50 < d.total ? '' : 'disabled'}>Next</button></div></div>`
      : `<div class="empty">No ${esc(tab.toLowerCase())} companies${st.q ? ' match your search' : ' yet'}.</div>`;
    $$('tr[data-id]', box).forEach(r => r.onclick = () => openCompany(r.dataset.id));
    const pv = $('#pv'), nx = $('#nx'); if (pv) pv.onclick = () => { st.page--; draw(); }; if (nx) nx.onclick = () => { st.page++; draw(); };
  };
  let deb; $('#lq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 250); };
  $('#lind').onchange = e => { st.industry = e.target.value; st.page = 0; draw(); };
  if ($('#lpr')) $('#lpr').onchange = e => { st.priority = e.target.value; st.page = 0; draw(); };
  $('#lsort').onchange = e => { st.sort = e.target.value; draw(); };
  $('#lre').onclick = async () => { if (!st.ids?.length) return; if (!await confirmBox(`Re-run every check for ${st.ids.length} companies? This uses API requests.`, 'Re-verify')) return; try { await api('/refresh', { method: 'POST', body: { ids: st.ids } }); toast('Re-verification started. See progress on the Dashboard.'); } catch (e) { toast(e.message); } };
  draw();
};

const STAGES = ['New', 'Contacted', 'Follow-up', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
pages.pipeline = async el => {
  await refreshMeta();
  el.innerHTML = `<div class="page-head"><div><h1>Sales Pipeline</h1><p>Qualified leads arrive here automatically. Open a card to copy the pitch, log contact, set follow-ups and move the stage.</p></div>
    <div class="row"><select class="in" id="pAssign" style="width:auto"><option value="">Everyone</option>${S.settings.team.map(m => `<option>${esc(m)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="pDue"> Follow-ups due only</label></div></div><div id="board"></div>`;
  const draw = async () => {
    const d = await api('/companies?pipeline=1&category=all&size=200');
    const who = $('#pAssign').value, dueOnly = $('#pDue').checked, t = today();
    const items = d.items.filter(c => (!who || c.pipeline.assignedTo === who) && (!dueOnly || (c.pipeline.followUpDate && c.pipeline.followUpDate <= t)));
    $('#board').innerHTML = items.length || d.items.length ? `<div class="board">${STAGES.map(s => { const list = items.filter(c => (c.pipeline.stage || 'New') === s); return `<div class="col"><h3>${esc(s)}<span>${list.length}</span></h3>
      ${list.map(c => { const due = c.pipeline.followUpDate && c.pipeline.followUpDate <= t && !['Won', 'Lost'].includes(s); return `<div class="lead-card" data-id="${esc(c.id)}" tabindex="0"><span class="t">${esc(c.name)}</span>
        <span class="row">${pill(c.priority || '—')}<span class="score">${c.score ?? ''}</span>${c.pipeline.doNotContact ? pill('Do not contact', 'Rejected') : ''}</span>
        <span class="muted">${esc([c.industry, c.city].filter(Boolean).join(' · '))}</span>
        ${c.pipeline.assignedTo ? `<span>👤 ${esc(c.pipeline.assignedTo)}</span>` : ''}${c.pipeline.followUpDate ? `<span class="${due ? 'due' : ''}">Follow-up ${esc(fmtDate(c.pipeline.followUpDate))}${due ? ' · due' : ''}</span>` : ''}
        ${c.pipeline.validationWarning ? `<span class="small" style="color:var(--warn)">${esc(c.pipeline.validationWarning)}</span>` : ''}</div>`; }).join('') || '<div class="empty small">—</div>'}</div>`; }).join('')}</div>`
      : '<div class="card empty">No leads in the pipeline yet. Qualified leads are added automatically after validation.</div>';
    $$('.lead-card').forEach(c => { c.onclick = () => openCompany(c.dataset.id, draw); c.onkeydown = e => e.key === 'Enter' && openCompany(c.dataset.id, draw); });
  };
  $('#pAssign').onchange = draw; $('#pDue').onchange = draw; draw();
};

pages.reports = async el => {
  await refreshMeta();
  el.innerHTML = `<div class="page-head"><div><h1>Reports and Backup</h1><p>Export processed data, keep backups, and review search, duplicate and API usage history.</p></div></div>
  <div class="grid g2">
  <section class="card"><h2>Export</h2><div class="form"><label class="f">Data<select class="in" id="exSet"><option value="qualified">Qualified leads</option><option value="pipeline">Sales pipeline</option><option value="unverified">Unverified leads</option><option value="no-opportunity">No opportunity</option><option value="rejected">Rejected companies</option><option value="all">All companies</option></select></label></div>
    <div class="row mt"><button class="btn" id="exXlsx">Excel workbook (.xlsx)</button><button class="btn ghost" id="exCsv">CSV</button></div>
    <p class="small muted" id="exNote"></p></section>
  <section class="card"><h2>Backup and restore</h2><p class="small muted" style="margin-top:-6px">A backup is saved automatically every day (last 14 kept). API keys are never included in downloads.</p>
    <div class="row"><button class="btn" id="bkDl">Download backup</button><button class="btn ghost" id="bkNow">Save backup on this PC</button><button class="btn plain" id="bkUp">Restore from file…</button><input type="file" id="bkFile" accept=".json" hidden></div>
    <div id="bkList" class="mt"></div></section></div>
  <section class="card mt"><h2>Search history</h2><div id="hist"></div></section>
  <section class="card mt"><h2>API usage and estimated cost</h2><div id="usage"></div></section>`;
  const xl = async () => {
    const ds = $('#exSet').value, t = await api('/export?dataset=' + ds);
    $('#exNote').textContent = t.note + ` ${t.rows.length} rows.`;
    if (!window.XLSX) return toast('Excel library not loaded — use CSV.');
    const wb = XLSX.utils.book_new();
    const d = S.dash.totals;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CANVASS Lead Finder report', new Date().toLocaleString()], [], ['Measure', 'Count'], ['Companies discovered', d.discovered], ['Qualified', d.qualified], ['Unverified', d.unverified], ['Rejected', d.rejected], ['No opportunity', d.noOpportunity], ['In sales pipeline', d.transferred], ['Converted', d.converted], [], ['Note', t.note], ...(S.dash.demoMode ? [['WARNING', 'Demo mode is on: includes fictional demonstration data']] : [])]), 'Summary');
    const ws = XLSX.utils.aoa_to_sheet([t.header, ...t.rows]); ws['!cols'] = t.header.map(h => ({ wch: Math.min(48, Math.max(12, h.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, ds.slice(0, 30));
    XLSX.writeFile(wb, `canvass-${ds}-${today()}.xlsx`);
  };
  $('#exXlsx').onclick = () => xl().catch(e => toast(e.message));
  $('#exCsv').onclick = () => download('/export?format=csv&dataset=' + $('#exSet').value, 'canvass.csv');
  $('#bkDl').onclick = () => download('/backup', 'canvass-backup.json');
  $('#bkNow').onclick = async () => { const r = await api('/backup', { method: 'POST' }); toast('Saved ' + r.created); drawBk(); };
  $('#bkUp').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!await confirmBox(`Replace all current data with "${f.name}"? A safety backup of the current data is saved first.`, 'Restore')) return;
    try { const r = await api('/restore', { method: 'POST', body: JSON.parse(await f.text()) }); toast(`Restored ${r.restored} companies.`); refreshMeta(); drawBk(); } catch (err) { toast('Restore failed: ' + err.message, 6000); }
  };
  const drawBk = async () => {
    const list = await api('/backups');
    $('#bkList').innerHTML = list.length ? `<div class="tbl-wrap" style="max-height:220px"><table><tbody>${list.slice(0, 20).map(b => `<tr><td class="small">${esc(b.name.replace('canvass-backup-', '').replace('.json', ''))}</td><td class="small num">${Math.round(b.size / 1024)} KB</td><td><button class="btn sm plain" data-rs="${esc(b.name)}">Restore</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">No backups yet.</div>';
    $$('[data-rs]').forEach(b => b.onclick = async () => { if (!await confirmBox('Restore this backup? Current data is backed up first.', 'Restore')) return; const r = await api(`/backups/${encodeURIComponent(b.dataset.rs)}/restore`, { method: 'POST' }); toast(`Restored ${r.restored} companies.`); refreshMeta(); });
  };
  drawBk();
  const h = await api('/history');
  $('#hist').innerHTML = h.searches.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Type</th><th>Search / file</th><th>Candidates</th><th>Results</th></tr></thead><tbody>${h.searches.map(s => `<tr><td class="num small">${esc(fmtDateTime(s.at))}</td><td>${esc(s.type)}</td><td class="small">${esc(s.params?.fileName || [s.params?.category || s.params?.industryId, [s.params?.area, s.params?.city, s.params?.country].filter(Boolean).join(', ')].join(' · '))}</td><td class="num">${s.candidates ?? ''}</td><td class="small">${esc(countsText(s.counts))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No searches yet.</div>';
  const u = await api('/usage');
  const bb = u.budget;
  $('#usage').insertAdjacentHTML('beforebegin', `<p>${bb.enabled ? `Free-tier protection on: <b>${bb.used}</b> of ${bb.limit} Google Places requests used in ${esc(bb.month)} (Pacific Time); <b>${bb.dayUsed}</b> of ${bb.dayLimit} today.` : '<b style="color:var(--bad)">Free-tier protection is off.</b>'}</p>`);
  $('#usage').innerHTML = u.days.length ? `<p class="small muted">${esc(u.note)}</p><div class="tbl-wrap"><table><thead><tr><th>Day</th><th>Google Places</th><th>PageSpeed</th><th>RDAP</th><th>Archive</th><th>Website checks</th><th>Est. cost (US$)</th></tr></thead><tbody>${u.days.map(d => `<tr><td class="num">${esc(d.day)}</td>${['places', 'pagespeed', 'rdap', 'wayback', 'website'].map(k => `<td class="num">${d.apis[k] ? `${d.apis[k].ok}${d.apis[k].failed ? ` <span class="small" style="color:var(--bad)">(${d.apis[k].failed} failed)</span>` : ''}` : '—'}</td>`).join('')}<td class="num">${d.estimatedCostUsd.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No API requests yet.</div>';
};

pages.settings = async el => {
  await refreshMeta();
  const s = S.settings;
  const num = (name, val, label, help = '', step = 1) => `<label class="f">${esc(label)}<input class="in" type="number" step="${step}" name="${name}" value="${esc(val)}">${help ? `<small>${esc(help)}</small>` : ''}</label>`;
  const chk = (name, val, label, help = '') => `<label class="check"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}><span><b>${esc(label)}</b>${help ? `<br><span class="small muted">${esc(help)}</span>` : ''}</span></label>`;
  el.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Settings are stored on this computer's Canvass server. API keys never leave the server.</p></div><button class="btn" id="saveTop">Save settings</button></div>
  <form id="setForm" class="stack">
  <section class="card"><h2>API keys</h2><div class="form">
    <label class="f">Google Places API key<input class="in" name="googlePlacesKey" type="password" autocomplete="off" placeholder="${s.googlePlacesKeyConfigured ? esc(s.googlePlacesKey) + ' (saved)' : 'Not set'}"><small>${s.googlePlacesKeyFromEnv ? 'Set by GOOGLE_PLACES_API_KEY environment variable.' : 'Requires Places API (New) and billing. Restrict the key to Places API.'}</small></label>
    <label class="f">PageSpeed Insights API key <small>(optional)</small><input class="in" name="pageSpeedKey" type="password" autocomplete="off" placeholder="${s.pageSpeedKeyConfigured ? esc(s.pageSpeedKey) + ' (saved)' : 'Not set — limited free quota'}"><small>Raises the PageSpeed quota. Free from Google Cloud.</small></label>
  </div><p class="small muted">Leave a key field empty to keep the saved key. Type a single space and save to remove it.</p></section>
  <section class="card"><h2>Free-tier protection (Google Places)</h2>
    <p class="small muted" style="margin-top:-6px">Canvass counts every Google Places request and refuses to send more once a limit is reached, so a search can't go past your free allowance. Months are counted in Pacific Time, as Google bills. Set the monthly limit a little below the free monthly calls Google lists for <b>Text Search (Enterprise + Atmosphere)</b> on its pricing page.</p>
    <div class="stack">${chk('b_enabled', s.budget.enabled, 'Enforce limits (recommended)', 'Off = no limit inside Canvass. Google quota caps still apply if you set them.')}</div>
    <div class="form mt">${num('b_month', s.budget.placesMonthlyLimit, 'Monthly request limit')}${num('b_day', s.budget.placesDailyLimit, 'Daily request limit')}</div>
    <p class="small">Used this month: <b>${S.health.budget.used}</b> · today: <b>${S.health.budget.dayUsed}</b></p></section>
  <section class="card"><h2>Lead eligibility</h2><div class="form">
    ${num('eligibilityYears', s.eligibilityYears, 'Eligibility window (years)', 'Measured from today, so it updates automatically.')}
    ${num('activeMinEvidence', s.activeMinEvidence, 'Activity signals required', 'Besides Google "operational" status.')}
    ${num('recentReviewMonths', s.recentReviewMonths, 'Recent review = within (months)')}
    ${num('largeCompanyReviewThreshold', s.largeCompanyReviewThreshold, 'Large business if reviews exceed')}
    ${num('chainLocationThreshold', s.chainLocationThreshold, 'Chain if same name appears at')}
    ${num('maxCandidatesPerSearch', s.maxCandidatesPerSearch, 'Max companies analysed per search', 'Controls API cost.')}
  </div><div class="stack mt">
    ${chk('acceptEstimatedAge', s.acceptEstimatedAge, 'Accept consistent estimates for company age', 'Off (recommended): only a documented establishment or licence date verifies age. On: matching domain registration and archive dates are accepted as an estimate — less reliable.')}
    ${num('ageMinSources', s.ageMinSources, 'Sources needed for an accepted estimate')}
    ${chk('rejectOldWebsiteArchive', s.rejectOldWebsiteArchive, 'Reject when the website has existed longer than the window', 'Unless a newer establishment date is documented.')}
    ${chk('requireConfirmedIssue', s.requireConfirmedIssue, 'Qualified leads need at least one confirmed issue', 'Off: potential improvements alone can qualify a lead.')}
  </div></section>
  <section class="card"><h2>Lead score weights (total ${Object.values(s.weights).reduce((a, b) => a + b, 0)})</h2><div class="form">
    ${num('w_age', s.weights.age, 'Company and website age')}${num('w_activity', s.weights.activity, 'Active business and authenticity')}${num('w_gbp', s.weights.gbp, 'Google Business opportunities')}${num('w_website', s.weights.website, 'Website and SEO opportunities')}${num('w_contact', s.weights.contact, 'Contact information')}
    ${num('p_high', s.priority.high, 'High priority from')}${num('p_medium', s.priority.medium, 'Medium priority from')}
  </div><p class="small muted">Scores are always rescaled to 100. Mandatory checks override the score.</p></section>
  <section class="card"><h2>Industry benchmarks (Google profile)</h2><div class="tbl-wrap"><table><thead><tr><th>Industry</th><th>Min. reviews</th><th>Min. rating</th><th>Min. photos</th></tr></thead><tbody>
    ${[{ id: 'default', name: 'Default (all others)' }, ...s.industries].map(i => { const b = s.benchmarks[i.id]; return `<tr><td>${esc(i.name)}${b || i.id === 'default' ? '' : ' <span class="small muted">(default)</span>'}</td>${['minReviews', 'minRating', 'minPhotos'].map(k => `<td><input class="in" style="width:90px" type="number" step="${k === 'minRating' ? 0.1 : 1}" data-bm="${esc(i.id)}" data-k="${k}" value="${esc((b || s.benchmarks.default)[k])}"></td>`).join('')}</tr>`; }).join('')}
  </tbody></table></div></section>
  <section class="card"><h2>Your company (used in pitches)</h2><div class="form">
    ${['name', 'sender', 'phone', 'email', 'website'].map(k => `<label class="f">${{ name: 'Company name', sender: 'Sender name', phone: 'Phone', email: 'Email', website: 'Website' }[k]}<input class="in" name="c_${k}" value="${esc(s.company[k])}"></label>`).join('')}
  </div></section>
  <section class="card"><h2>Team members</h2><label class="f">One name per line<textarea class="in" name="team" rows="4">${esc(s.team.join('\n'))}</textarea></label></section>
  <section class="card"><h2>Canvass services</h2><p class="small muted" style="margin-top:-6px">Only switched-on services are recommended, and only when a finding supports them.</p>
    <div class="form">${s.services.map((x, i) => `<label class="check"><input type="checkbox" data-svc="${i}" ${x.enabled ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div></section>
  <section class="card"><h2>Industries</h2><p class="small muted" style="margin-top:-6px">Google place types and keywords decide whether a business belongs to an industry. Comma-separated.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Industry</th><th>Google place types</th><th>Keywords</th></tr></thead><tbody id="indRows">
    ${s.industries.map((i, n) => `<tr><td><input class="in" data-ind="${n}" data-k="name" value="${esc(i.name)}"></td><td><input class="in" data-ind="${n}" data-k="types" value="${esc((i.types || []).join(', '))}"></td><td><input class="in" data-ind="${n}" data-k="keywords" value="${esc((i.keywords || []).join(', '))}"></td></tr>`).join('')}
    </tbody></table></div><button type="button" class="btn plain sm mt" id="addInd">Add industry</button></section>
  <section class="card"><h2>Data, compliance and processing</h2><div class="form">
    ${num('googleRetentionDays', s.googleRetentionDays, 'Keep Google content for (days)', 'Google Maps Platform allows at most 30 days. Place IDs are kept.')}
    ${num('brokenLinkSample', s.brokenLinkSample, 'Links checked per website')}
    ${num('concurrency', s.concurrency, 'Companies processed at once')}
    ${num('contactCooldownDays', s.contactCooldownDays, 'Days before re-contacting on the same channel')}
    ${num('cost_places', s.costPer1000.places, 'Places price per 1,000 requests (US$)', 'For cost estimates — check current Google pricing.', 0.01)}
  </div><div class="stack mt">
    ${chk('runPageSpeed', s.runPageSpeed, 'Run PageSpeed Insights tests', 'Adds 10–60 seconds per website.')}
    ${chk('includeGoogleContentInExports', s.includeGoogleContentInExports, 'Include Google ratings, reviews and Google-only contact details in exports', 'Google Maps Platform terms restrict exporting this content. Leave off unless your use is permitted.')}
  </div></section>
  </form>
  <section class="card mt"><h2>Demonstration data</h2><p class="small">${S.dash.demoRecords} demo companies stored. Demo data is fictional, marked [DEMO], and only counted while demo mode is on.</p>
    <div class="row"><button class="btn ghost" id="demoLoad">Load demo data and turn demo mode on</button><button class="btn danger" id="demoClear">Remove demo data and turn demo mode off</button></div></section>
  <div class="row mt"><button class="btn" id="saveBottom">Save settings</button></div>`;
  $('#addInd').onclick = () => { const n = $$('#indRows tr').length; $('#indRows').insertAdjacentHTML('beforeend', `<tr><td><input class="in" data-ind="${n}" data-k="name" placeholder="New industry"></td><td><input class="in" data-ind="${n}" data-k="types"></td><td><input class="in" data-ind="${n}" data-k="keywords"></td></tr>`); };
  const save = async () => {
    const f = $('#setForm'), v = n => f.elements[n]?.value, b = n => !!f.elements[n]?.checked;
    const body = {
      eligibilityYears: +v('eligibilityYears'), activeMinEvidence: +v('activeMinEvidence'), recentReviewMonths: +v('recentReviewMonths'), largeCompanyReviewThreshold: +v('largeCompanyReviewThreshold'),
      chainLocationThreshold: +v('chainLocationThreshold'), maxCandidatesPerSearch: +v('maxCandidatesPerSearch'), ageMinSources: +v('ageMinSources'),
      acceptEstimatedAge: b('acceptEstimatedAge'), rejectOldWebsiteArchive: b('rejectOldWebsiteArchive'), requireConfirmedIssue: b('requireConfirmedIssue'), runPageSpeed: b('runPageSpeed'), includeGoogleContentInExports: b('includeGoogleContentInExports'),
      weights: { age: +v('w_age'), activity: +v('w_activity'), gbp: +v('w_gbp'), website: +v('w_website'), contact: +v('w_contact') }, priority: { high: +v('p_high'), medium: +v('p_medium') },
      googleRetentionDays: +v('googleRetentionDays'), brokenLinkSample: +v('brokenLinkSample'), concurrency: +v('concurrency'), contactCooldownDays: +v('contactCooldownDays'),
      costPer1000: { ...s.costPer1000, places: +v('cost_places') },
      budget: { enabled: b('b_enabled'), placesMonthlyLimit: +v('b_month'), placesDailyLimit: +v('b_day') },
      company: Object.fromEntries(['name', 'sender', 'phone', 'email', 'website'].map(k => [k, v('c_' + k)])),
      team: v('team').split('\n').map(x => x.trim()).filter(Boolean),
      services: s.services.map((x, i) => ({ ...x, enabled: $(`[data-svc="${i}"]`).checked })),
      benchmarks: {}, industries: []
    };
    for (const k of ['googlePlacesKey', 'pageSpeedKey']) { const val = v(k); if (val) body[k] = val === ' ' ? '' : val.trim(); }
    $$('[data-bm]').forEach(i => { (body.benchmarks[i.dataset.bm] ||= {})[i.dataset.k] = +i.value; });
    $$('#indRows tr').forEach((tr, n) => { const g = k => $(`[data-k="${k}"]`, tr).value; const old = s.industries[n] || {}; if (g('name').trim()) body.industries.push({ ...old, id: old.id || g('name'), name: g('name'), types: g('types'), keywords: g('keywords') }); });
    try { await api('/settings', { method: 'PUT', body }); toast('Settings saved.'); route(); } catch (e) { toast(e.message); }
  };
  $('#saveTop').onclick = save; $('#saveBottom').onclick = save;
  $('#demoLoad').onclick = async () => { const r = await api('/demo/load', { method: 'POST' }); toast(`Loaded ${r.loaded} demo companies.`); route(); };
  $('#demoClear').onclick = async () => { if (!await confirmBox('Remove all demo companies?', 'Remove')) return; const r = await api('/demo/clear', { method: 'POST' }); toast(`Removed ${r.removed} demo companies.`); route(); };
};

// ---------- company information card ----------
async function openCompany(id, onChange) {
  const dr = $('#drawer');
  let c;
  try { c = await api('/companies/' + id); } catch (e) { return toast(e.message); }
  const close = () => { dr.hidden = true; dr.innerHTML = ''; document.body.style.overflow = ''; onChange && onChange(); };
  const reload = () => openCompany(id, onChange);
  const g = c.google || {}, a = c.age || {}, act = c.activity || {}, v = c.validation || {}, sc = c.score || {}, p = c.pipeline || {}, wa = c.websiteAudit, ra = c.reviewAnalysis || {};
  const fact = (k, val, sub = '') => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${val || '—'}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const issuesBy = st => (c.issues || []).filter(i => (i.status === 'Confirmed Issue') === st);
  const issueRow = i => `<div class="issue">${pill(i.status === 'Confirmed Issue' ? 'Confirmed' : 'Potential')}<div><b>${esc(i.title)}</b> <span class="small muted">· ${i.area === 'gbp' ? 'Google Business' : 'Website'}</span><div class="d">${esc(i.detail)}</div><div class="small muted">Source: ${safeUrl(i.evidence) ? link(i.evidence) : esc(i.evidence)} · ${esc(fmtDate(i.checkedAt))}</div></div></div>`;
  const ev = [...(a.evidence || []).map(e => ({ what: e.label + ': ' + e.date, src: e.source, url: e.url, at: e.checkedAt, kind: 'Age' })), ...(act.evidence || []).map(e => ({ what: e.label, src: e.source, url: e.url, at: e.checkedAt, kind: 'Activity' }))];
  const pitches = c.pitch ? [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['call', 'Call script'], ['proposal', 'Proposal'], ['auditOffer', 'Free audit offer']] : [];
  const ps = wa?.pagespeed;
  dr.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
   <div class="drawer-head"><div class="ring" style="--p:${sc.total || 0}" title="Lead score"><span>${sc.total ?? '—'}</span></div>
     <div style="flex:1;min-width:0"><h2>${esc(c.name)}</h2><div class="row mt" style="margin-top:6px">${pill(v.category || 'Unprocessed')}${v.category === 'Qualified' ? pill(sc.priority + ' priority', sc.priority) : ''}${c.demo ? pill('Demo data', 'demo') : ''}<span class="small muted">${esc([c.industryName || c.industry, c.area, c.city, c.country].filter(Boolean).join(' · '))}</span></div></div>
     <button class="btn plain sm" id="dClose" aria-label="Close">✕</button></div>
   <div class="drawer-body">
    ${v.reasons?.length ? `<div class="banner ${v.category === 'Rejected' ? 'bad' : 'info'}"><div><b>${esc(v.category)}:</b> ${v.reasons.map(esc).join('<br>')}</div></div>` : ''}
    ${p.validationWarning ? `<div class="banner info">This lead is in the pipeline, but its latest validation result is ${esc(v.category)}.</div>` : ''}
    <section class="card"><div class="facts">
      ${fact('Industry', esc(c.industryName || c.industry || g.primaryTypeDisplayName))}
      ${fact('Location', esc([c.area, c.city, c.country].filter(Boolean).join(', ')), esc(c.contact?.address || ''))}
      ${fact('Company age', pill(a.status || '—'), a.earliestDate ? `Earliest evidence ${esc(a.earliestDate)} · ${esc(a.basis || '')}` : esc(a.basis || ''))}
      ${fact('Website', c.contact?.website ? link(c.contact.website) : esc(c.websiteStatus), esc(c.websiteStatus || ''))}
      ${fact('Website age', a.websiteAge?.firstSeen ? `First archived ${esc(a.websiteAge.firstSeen)}` : esc(a.websiteAge?.status || '—'), a.websiteAge?.firstSeen ? 'Estimate (archive history)' : '')}
      ${fact('Operational status', pill(act.status || '—', String(act.status || '').startsWith('Closed') ? 'Closed' : act.status), `${act.signals ?? 0} activity signals`)}
      ${fact('Google Maps', c.contact?.mapsUrl ? link(c.contact.mapsUrl, 'Open in Maps') : '—', c.contact?.directionsUrl ? link(c.contact.directionsUrl, 'Directions') : '')}
      ${fact('Phone', esc(c.contact?.phone), esc(c.contactSources?.phone || ''))}
      ${fact('Email', c.contact?.email ? esc(c.contact.email) : 'Not available', esc(c.contactSources?.email || ''))}
      ${fact('Google rating', g.rating != null ? `${esc(g.rating)} ★` : (g.expired ? 'Expired — refresh' : 'Not available'), g.userRatingCount != null ? `${esc(g.userRatingCount)} reviews` : '')}
      ${fact('Recent review', ra.recentDates?.[0] ? esc(fmtDate(ra.recentDates[0])) : 'Not available', ra.sampleSize ? `From ${ra.sampleSize}-review sample` : '')}
      ${fact('Photos', g.placeId && !g.expired ? (g.photoCount ? `${esc(g.photoCount)} visible` : 'None returned') : 'Not available', g.photoCount ? 'API returns at most 10' : '')}
      ${fact('Lead score', `<span class="score">${sc.total ?? '—'}</span> / 100`, esc(sc.note || ''))}
      ${fact('Last verified', esc(fmtDateTime(c.lastVerifiedAt)), esc(c.source?.detail || ''))}
    </div>${g.placeId && !c.demo ? '<p class="small muted" style="margin:12px 0 0">Google Maps data © Google. Shown for evaluation; cached for at most ' + esc(S.settings?.googleRetentionDays || 30) + ' days.</p>' : ''}</section>

    <section class="card"><h2>Detected issues</h2>${(c.issues || []).length ? issuesBy(true).map(issueRow).join('') + (issuesBy(false).length ? `<details class="mt"><summary class="small"><b>${issuesBy(false).length} potential improvements</b></summary>${issuesBy(false).map(issueRow).join('')}</details>` : '') : '<div class="empty">No issues found in the checked sources.</div>'}</section>

    <section class="card"><h2>Recommended Canvass services</h2>${(c.services || []).length ? `<div class="stack" style="gap:8px">${c.services.map(s => `<div><b>${esc(s.name)}</b><div class="small muted">Because: ${esc(s.reasons.join('; '))}</div></div>`).join('')}</div>` : '<div class="empty">No service recommendations — no supporting findings.</div>'}</section>

    ${pitches.length ? `<section class="card"><div class="split"><h2 style="margin:0">Personalized sales pitch</h2><span class="small muted">Generated ${esc(fmtDateTime(c.pitch.generatedAt))} · review before sending</span></div>
      <div class="tabs mt">${pitches.map(([k, l], i) => `<button class="tab ${i ? '' : 'active'}" data-pt="${k}">${l}</button>`).join('')}</div>
      <pre class="pitch" id="pitchText"></pre>
      <div class="row mt"><button class="btn" id="pCopy">Copy</button><button class="btn ghost" id="pSent" ${p.doNotContact ? 'disabled' : ''}>Log as sent</button>${c.contact?.email ? `<span class="small muted">Send manually to ${esc(c.contact.email)}</span>` : ''}</div>
      <p class="small muted">Messages are never sent automatically. Sending needs a configured, authorised email/WhatsApp integration and the recipient's consent where required.</p></section>`
      : `<section class="card"><h2>Personalized sales pitch</h2><div class="empty">Pitches are generated only for qualified leads.</div></section>`}

    ${p.inPipeline || v.category === 'Qualified' ? `<section class="card"><h2>Sales pipeline</h2><div class="form">
      <label class="f">Stage<select class="in" id="pStage">${STAGES.map(s => `<option ${s === p.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f">Assigned to<select class="in" id="pWho"><option value="">Unassigned</option>${(S.settings?.team || []).map(m => `<option ${m === p.assignedTo ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="f">Follow-up date<input class="in" type="date" id="pDate" value="${esc(p.followUpDate || '')}"></label></div>
      <div class="row mt"><input class="in" id="pNote" placeholder="Add a note (call outcome, next step…)" style="flex:1;min-width:200px"><button class="btn ghost" id="pAddNote">Add note</button></div>
      <div class="row mt"><label class="check"><input type="checkbox" id="pDnc" ${p.doNotContact ? 'checked' : ''}> Do not contact (opted out)</label>
        ${c.contactVerifiedAt ? '<span class="small muted">Contact details confirmed ' + esc(fmtDate(c.contactVerifiedAt)) + '</span>' : '<button class="btn plain sm" id="pVerContact" title="Keeps Google-sourced contact details after the 30-day Google cache limit">Contact details confirmed by phone/email</button>'}</div>
      <h3>History</h3><div class="small" style="max-height:200px;overflow:auto">${[...(p.history || []), ...(p.notes || []).map(n => ({ at: n.at, event: '📝 ' + n.text }))].sort((x, y) => String(y.at).localeCompare(x.at)).map(h => `<div><span class="muted num">${esc(fmtDateTime(h.at))}</span> — ${esc(h.event)}</div>`).join('') || '<span class="muted">No activity yet.</span>'}</div></section>` : ''}

    <details class="x"><summary>Validation checks</summary><div class="in-body"><div class="tbl-wrap"><table><tbody>${(v.checks || []).map(x => `<tr><td>${esc(x.label)}</td><td>${pill(x.state === 'pass' ? 'Pass' : x.state === 'fail-reject' ? 'Rejected' : x.state === 'fail-unverified' ? 'Unverified' : x.state === 'no-opportunity' ? 'No opportunity' : 'N/A', x.state)}</td><td class="small">${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Score breakdown: ${Object.entries(sc.parts || {}).map(([k, val]) => `${esc(k)} ${esc(val)}/${esc(sc.max?.[k])}`).join(' · ')}</p></div></details>

    <details class="x"><summary>Evidence sources (${ev.length})</summary><div class="in-body">${ev.length ? `<div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Finding</th><th>Source</th><th>Checked</th></tr></thead><tbody>${ev.map(e => `<tr><td>${esc(e.kind)}</td><td>${esc(e.what)}</td><td class="small">${e.url ? link(e.url, e.src) : esc(e.src)}</td><td class="small num">${esc(fmtDate(e.at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No evidence recorded.</div>'}
      ${(a.notes || []).length ? `<h3>Age assessment</h3>${a.notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}` : ''}${act.note ? `<p class="small"><b>Activity:</b> ${esc(act.note)}</p>` : ''}</div></details>

    <details class="x"><summary>Add verification evidence</summary><div class="in-body">
      <p class="small muted">Use this when you confirm something yourself, such as a trade licence date. Every entry needs a source. The company is re-validated immediately.</p>
      <div class="form"><label class="f">Type<select class="in" id="evType"><option value="establishment">Establishment / licence date</option><option value="activity">Recent activity (e.g. social post, phone call)</option><option value="identity">Business identity confirmed</option><option value="no-website">Confirmed: business has no website</option><option value="invalid">Fake or invalid business</option></select></label>
      <label class="f" id="evDateWrap">Date<input class="in" type="date" id="evDate"></label>
      <label class="f">Source / evidence<input class="in" id="evSrc" placeholder="e.g. DED licence 123456 issued 2023-03-01"></label><label class="f">Link <small>(optional)</small><input class="in" id="evUrl" placeholder="https://"></label></div>
      <button class="btn ghost mt" id="evSave">Save evidence and re-validate</button></div></details>

    ${wa ? `<details class="x"><summary>Website audit details</summary><div class="in-body">
      <div class="facts">${fact('Checked', esc(fmtDateTime(wa.checkedAt)))}${fact('Status', wa.availability?.ok ? `HTTP ${esc(wa.availability.httpStatus)}` : esc(wa.availability?.error || 'Failed'))}${fact('Response time', wa.availability?.responseMs ? `${(wa.availability.responseMs / 1000).toFixed(2)} s` : '—', 'single measurement')}
      ${fact('HTTPS', wa.https?.usesHttps ? 'Yes' : 'No', wa.https?.httpRedirectsToHttps === false ? 'HTTP does not redirect' : '')}${fact('Mobile viewport', wa.page ? (wa.page.viewport ? 'Yes' : 'No') : '—')}${fact('Page title', esc(wa.page?.title || '—'))}
      ${fact('Meta description', esc(wa.page?.metaDescription || '—'))}${fact('H1 headings', esc(wa.page?.h1s?.length ?? '—'))}${fact('Enquiry form', wa.page ? (wa.page.forms || wa.contactPageForms ? 'Yes' : 'Not found') : '—')}
      ${fact('WhatsApp', wa.page ? (wa.page.whatsapp ? 'Yes' : 'Not found') : '—')}${fact('Call-to-action', esc(wa.page?.ctas?.join(', ') || 'Not found'))}${fact('Structured data', esc(wa.page?.ldTypes?.join(', ') || 'None'))}
      ${fact('Broken links', wa.brokenLinks ? `${wa.brokenLinks.broken.length} of ${wa.brokenLinks.checked}` : '—')}${fact('Sitemap', wa.sitemap == null ? '—' : wa.sitemap ? 'Found' : 'Not found')}${fact('Footer year', esc(wa.page?.copyrightYear || '—'))}
      ${fact('E-commerce', esc(wa.page?.ecomSignals?.join(', ') || 'Not detected'))}${fact('Social links', Object.entries(wa.page?.social || {}).map(([k, u]) => link(u, k)).join(', ') || 'None')}</div>
      <h3>PageSpeed (mobile)</h3>${ps?.status === 'Tested' ? `<div class="facts">${fact('Performance', esc(ps.performance))}${fact('SEO', esc(ps.seo))}${fact('Accessibility', esc(ps.accessibility))}${fact('Best practices', esc(ps.bestPractices))}${fact('LCP', esc(ps.lcp))}${fact('Tested', esc(fmtDateTime(ps.testedAt)), esc(ps.source))}</div>` : `<p class="small">${esc(ps?.status || 'Not tested')}${ps?.error ? ': ' + esc(ps.error) : ''}. No scores are shown for tests that did not run.</p>`}
      ${wa.page?.jsRendered ? '<p class="small muted">This site builds its content with JavaScript, so some on-page checks are reported as potential only.</p>' : ''}</div></details>` : ''}

    ${ra.status === 'Analysed' ? `<details class="x"><summary>Customer review analysis</summary><div class="in-body">
      <p class="small">${esc(ra.sampleNote)} ${esc(ra.authenticityNote)} Confidence: <b>${esc(ra.confidence)}</b>.</p>
      <div class="grid g2"><div><h3>Positive themes</h3>${ra.positiveThemes.length ? ra.positiveThemes.map(t => `<div class="small">${esc(t.theme)} (${t.count})</div>`).join('') : '<div class="small muted">None identified</div>'}</div>
      <div><h3>Negative themes</h3>${ra.negativeThemes.length ? ra.negativeThemes.map(t => `<div class="small">${esc(t.theme)} (${t.count})</div>`).join('') : '<div class="small muted">None identified</div>'}</div></div>
      ${ra.opportunities?.length ? `<h3>Opportunities</h3>${ra.opportunities.map(o => `<div class="small">• ${esc(o)}</div>`).join('')}` : ''}
      <h3>Reviews in sample</h3>${(ra.items || []).map(r => `<div class="issue">${pill(r.sentiment, r.sentiment === 'positive' ? 'pass' : r.sentiment === 'negative' ? 'Rejected' : 'Unknown')}<div><span class="small muted">${esc(r.date)} · ${esc(r.rating)}★ · ${esc(r.author)}</span><div class="small">“${esc(r.excerpt)}”</div></div></div>`).join('')}
      <p class="small muted">${esc(ra.ownerReplies?.note || '')} Source: ${link(ra.source, 'Google Maps')} · analysed ${esc(fmtDateTime(ra.analysedAt))}</p></div></details>` : ''}

    <div class="row"><button class="btn ghost" id="dRefresh" ${c.demo ? 'disabled title="Demo records are not re-checked online"' : ''}>Re-verify now</button><button class="btn danger" id="dDelete">Delete company</button></div>
   </div></div>`;
  dr.hidden = false; document.body.style.overflow = 'hidden';
  dr.onclick = e => { if (e.target === dr) close(); };
  dr.onkeydown = e => { if (e.key === 'Escape') close(); };
  $('#dClose').onclick = close; $('#dClose').focus();
  // pitch tabs
  if (pitches.length) {
    let cur = 'email';
    const show = k => { cur = k; $('#pitchText').textContent = c.pitch[k]; $$('[data-pt]', dr).forEach(b => b.classList.toggle('active', b.dataset.pt === k)); };
    $$('[data-pt]', dr).forEach(b => b.onclick = () => show(b.dataset.pt)); show('email');
    $('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText(c.pitch[cur]); toast('Copied.'); } catch { const r = document.createRange(); r.selectNodeContents($('#pitchText')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Press Ctrl+C to copy the selected text.'); } };
    $('#pSent').onclick = async () => {
      const log = async force => api(`/companies/${id}/contact-log`, { method: 'POST', body: { channel: cur, force } });
      try { await log(false); toast('Logged. Stage updated.'); reload(); }
      catch (e) { if (e.status === 409 && /Already contacted/.test(e.message) && await confirmBox(e.message, 'Log anyway')) { await log(true); toast('Logged.'); reload(); } else if (e.status !== 409 || !/Already/.test(e.message)) toast(e.message, 5000); }
    };
  }
  const patch = async body => { try { await api('/companies/' + id, { method: 'PATCH', body }); toast('Saved.'); reload(); } catch (e) { toast(e.message); } };
  if ($('#pStage')) {
    $('#pStage').onchange = e => patch({ stage: e.target.value }); $('#pWho').onchange = e => patch({ assignedTo: e.target.value }); $('#pDate').onchange = e => patch({ followUpDate: e.target.value });
    $('#pAddNote').onclick = () => { const n = $('#pNote').value.trim(); if (n) patch({ note: n }); };
    $('#pDnc').onchange = e => patch({ doNotContact: e.target.checked });
    if ($('#pVerContact')) $('#pVerContact').onclick = () => patch({ contactVerified: true });
  }
  const evType = $('#evType'); const syncEv = () => { $('#evDateWrap').hidden = evType.value !== 'establishment'; }; evType.onchange = syncEv; syncEv();
  $('#evSave').onclick = async () => {
    try { await api(`/companies/${id}/evidence`, { method: 'POST', body: { type: evType.value, date: $('#evDate').value, source: $('#evSrc').value, url: $('#evUrl').value } }); toast('Evidence saved. Company re-validated.'); reload(); }
    catch (e) { toast(e.message, 5000); }
  };
  $('#dRefresh').onclick = async () => { try { await api(`/companies/${id}/refresh`, { method: 'POST' }); toast('Re-verification started. Reopen this card in a minute.'); } catch (e) { toast(e.message); } };
  $('#dDelete').onclick = async () => { if (!await confirmBox(`Delete ${c.name}? This cannot be undone (backups are kept).`, 'Delete')) return; await api('/companies/' + id, { method: 'DELETE' }); toast('Deleted.'); close(); route(); };
}

// ---------- router ----------
async function route() {
  clearInterval(jobTimer);
  const [name, ...rest] = (location.hash.slice(1) || 'dashboard').split('/');
  const page = pages[name] ? name : 'dashboard';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  const main = $('#main');
  main.innerHTML = '<div class="empty">Loading…</div>';
  try { await pages[page](main, decodeURIComponent(rest.join('/'))); }
  catch (e) { main.innerHTML = `<div class="banner bad">Could not load this page: ${esc(e.message)}. Is the Canvass server running?</div>`; }
}
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
