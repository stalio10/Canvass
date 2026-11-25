/* Canvass · Lead Finder module.
 * Runs inside the Canvass shell (index.html) and reuses its helpers ($, esc, api, toast, go, render, the drawer and modal).
 * All figures come from the server; nothing here is invented. */
"use strict";
(() => {
const LF = window.LF = { arg: '', openId: null, on: false, dash: null, health: null, set: null, jobs: [], worker: null, timer: 0, seq: 0, names: [], prevRunning: new Set(), view: null, jobFilter: null, finder: null };

/* ---------- small helpers ---------- */
const CATC = { Qualified: 'var(--good)', Unverified: 'var(--warn)', Rejected: 'var(--bad)', 'No Opportunity': 'var(--muted)', Unprocessed: 'var(--muted)', Duplicates: 'var(--muted)', all: 'var(--accent)' };
const CATI = { Qualified: 'verified', Unverified: 'help', Rejected: 'block', 'No Opportunity': 'remove_done', Duplicates: 'content_copy', all: 'list' };
const CATS4 = ['Qualified', 'Unverified', 'No Opportunity', 'Rejected'];
const SUB = [['lf-home', 'insights', 'Dashboard'], ['lf-find', 'travel_explore', 'Find'], ['lf-bulk', 'upload_file', 'Upload'], ['lf-add', 'bolt', 'Quick add'], ['lf-leads', 'fact_check', 'Results'], ['lf-reports', 'monitoring', 'Reports'], ['lf-settings', 'tune', 'Settings']];
const PITCH = [['email', 'Email', 'mail'], ['whatsapp', 'WhatsApp', 'chat'], ['call', 'Call script', 'call'], ['proposal', 'Proposal', 'description'], ['auditOffer', 'Audit offer', 'workspace_premium']];
const COUNTRIES = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Oman', 'Bahrain', 'Kuwait', 'India', 'United Kingdom'];
const CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];
const cpill = c => `<span class="pill" style="--sc:${CATC[c] || 'var(--muted)'}">${esc(c)}</span>`;
const prioC = p => p === 'High' ? 'var(--good)' : p === 'Medium' ? 'var(--accent)' : 'var(--muted)';
const ppill = p => p ? `<span class="pill" style="--sc:${prioC(p)}">${esc(p)}</span>` : '';
const ini = n => initials(String(n || '').replace(/\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ') || '?');
const ring = (v, cls = '') => `<span class="lf-score ${cls}" style="--v:${v || 0};--sc:${v >= 80 ? 'var(--good)' : v >= 60 ? 'var(--accent)' : 'var(--warn)'}" title="Lead score ${v ?? '–'} of 100"><b>${v ?? '–'}</b></span>`;
const fmtDT = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtD = s => s ? new Date(s.length === 10 ? s + 'T12:00:00Z' : s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const agoI = s => s ? ago(new Date(s).getTime()) : '';
const n0 = v => Number(v || 0).toLocaleString('en-GB');
const link = (u, t) => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(t || s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : esc(t || '—'); };
const admin = () => !!(S.me && S.me.isAdmin);
const qs = (a, p) => a + (p ? '&' + new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null)) : '');
const running = j => ['queued', 'running'].includes(j.status);
const jobLabel = j => j.type === 'discovery' ? `${j.params?.category || indName(j.params?.industryId) || 'Search'} in ${[j.params?.area, j.params?.city].filter(Boolean).join(', ')}` : j.type === 'bulk' ? (j.params?.quick ? 'Quick check: ' : 'Upload: ') + (j.params?.fileName || 'list').replace(/^Quick add: /, '') : `Re-check of ${j.params?.ids || ''} compan${j.params?.ids === 1 ? 'y' : 'ies'}`;
const jobIcon = j => j.type === 'discovery' ? 'travel_explore' : j.type === 'bulk' ? (j.params?.quick ? 'bolt' : 'upload_file') : 'autorenew';
const indName = id => (LF.set?.industries || []).find(i => i.id === id)?.name || id || '';
const countsPills = c => Object.entries(c || {}).map(([k, v]) => `<span class="pill" style="--sc:${CATC[k] || 'var(--muted)'}">${esc(k)} ${v}</span>`).join('') || '<span class="hint" style="margin:0">Nothing processed yet</span>';
const stLabel = j => j.status === 'running' ? 'Running' : j.status === 'queued' ? 'Waiting' : j.status === 'done' ? 'Finished' : j.status === 'failed' ? 'Stopped' : 'Cancelled';
const stColor = j => j.status === 'done' ? 'var(--good)' : j.status === 'failed' ? 'var(--bad)' : running(j) ? 'var(--accent)' : 'var(--muted)';
const store = { get(k, d) { try { const v = localStorage.getItem('lf_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('lf_' + k, JSON.stringify(v)); } catch { } } };
function bars(obj, { limit = 8, color, href } = {}) {
  const e = Object.entries(obj || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!e.length) return '<div class="empty" style="padding:18px"><span class="ms">bar_chart</span>Nothing to show yet</div>';
  const max = Math.max(...e.map(x => x[1]));
  return `<div class="lf-bars">${e.map(([k, v], i) => `<div class="lf-bar"><span title="${esc(k)}">${esc(k)}</span><div class="tr"><i style="width:${Math.max(3, Math.round(100 * v / max))}%;--c:${color ? color(k) : 'var(--accent)'};animation-delay:${i * 50}ms"></i></div><b>${v}</b></div>`).join('')}</div>`;
}
function budgetMeter(b, compact) {
  if (!b) return '';
  if (!b.enabled) return `<div class="lf-note bad"><span class="ms">warning</span><div><b>Free-tier protection is off.</b> Google requests are not limited by Canvass.</div></div>`;
  const m = b.limit ? b.used / b.limit : 1, d = b.dayLimit ? b.dayUsed / b.dayLimit : 1;
  const cls = x => x >= 1 ? 'bad' : x >= .8 ? 'warn' : '';
  return `<div class="lf-meter ${cls(m)}"><div class="top"><span>Google requests this month</span><span><b>${n0(b.used)}</b> of ${n0(b.limit)}</span></div><div class="lfm-bar"><i style="width:${Math.min(100, m * 100)}%"></i></div></div>
   ${compact ? '' : `<div class="lf-meter ${cls(d)}"><div class="top"><span>Today</span><span><b>${n0(b.dayUsed)}</b> of ${n0(b.dayLimit)}</span></div><div class="lfm-bar"><i style="width:${Math.min(100, d * 100)}%"></i></div></div>`}`;
}
function toView(el) { const sc = $('#scroller'); if (!sc || !el) return; sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12, behavior: reduced ? 'auto' : 'smooth' }); }
function modal(html, onReady) {
  const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.classList.add('on'); $('#scrim').classList.add('on');
  onReady && onReady(m); return m;
}
function confirmBox(title, text, okText = 'Confirm', danger) {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><div class="acc-mfoot"><span class="grow"></span><button type="button" class="btn text" id="lfNo">Cancel</button><button type="button" class="btn filled" id="lfOk" ${danger ? 'style="background:var(--bad);color:#fff"' : ''}>${esc(okText)}</button></div>`, m => {
      $('#lfOk', m).onclick = () => { closeModal(); res(true); }; $('#lfNo', m).onclick = () => { closeModal(); res(false); }; setTimeout(() => $('#lfOk', m)?.focus(), 50);
    });
  });
}
function fail(e) { if (e && e.code === 'signed_out') return; oops((e && e.message) || 'Something went wrong. Try again.'); }
async function download(url) {
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) { let m = 'Download failed'; try { m = (await r.json()).error || m; } catch { } throw new Error(m); }
    const name = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'canvass-download';
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  } catch (e) { oops(e.message); }
}
let xlsxP = null;
function loadXlsx() { if (window.XLSX) return Promise.resolve(); return xlsxP ||= new Promise((ok_, no) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = ok_; s.onerror = () => { xlsxP = null; no(new Error('Couldn’t load the spreadsheet reader. Check your connection.')); }; document.head.appendChild(s); }); }

/* ---------- start / stop / background loop ---------- */
LF.start = async () => {
  LF.stop(); LF.on = true;
  try { [LF.set, LF.health] = await Promise.all([api('lf_settings'), api('lf_health')]); } catch (e) { return; }
  LF.refreshDash(); LF.loadNames(); LF.loop();
  if (S.view.startsWith('lf-')) render.full = true, render();
};
LF.stop = () => { LF.on = false; clearTimeout(LF.timer); LF.dash = LF.health = LF.set = null; LF.jobs = []; LF.prevRunning = new Set(); const c = $('#lfChip'); if (c) c.hidden = true; LF.rail(); };
LF.refreshDash = async () => { try { LF.dash = await api('lf_dashboard'); LF.dashAt = Date.now(); LF.rail(); if (S.view === 'overview') onData(); } catch { } };
LF.loadNames = async () => { try { LF.names = (await api(qs('lf_companies', { category: 'all', size: 200, sort: 'recent' }))).items; } catch { } };
LF.kick = () => { if (LF.health) LF.health.running = (LF.health.running || 0) + 1; clearTimeout(LF.timer); LF.timer = setTimeout(LF.loop, 200); };
LF.loop = async () => {
  clearTimeout(LF.timer); if (!LF.on || !S.live) return;
  let pending = 0;
  try {
    const bg = LF.worker && LF.worker.background;
    if ((LF.health?.running || LF.jobs.some(running)) && !bg) await api('lf_tick', {});        // keep jobs moving while this page is open
    const j = await api('lf_jobs'); LF.jobs = j.jobs || []; LF.worker = j.worker;
    pending = LF.jobs.filter(running).length; if (LF.health) LF.health.running = pending;
    const now_ = new Set(LF.jobs.filter(running).map(x => x.id));
    for (const id of LF.prevRunning) if (!now_.has(id)) LF.finished(LF.jobs.find(x => x.id === id));
    LF.prevRunning = now_;
    LF.chip(); LF.rail(); await LF.updatePanels();
  } catch (e) { if (e && e.code === 'signed_out') return; }
  LF.timer = setTimeout(LF.loop, pending ? (LF.worker?.background ? 2500 : 400) : (document.hidden ? 30000 : 12000));
};
LF.finished = j => {
  if (!j) return;
  const q = j.counts?.Qualified || 0;
  if (j.status === 'done') ok(`${jobLabel(j)}: finished. ${q} qualified lead${q === 1 ? '' : 's'}${q ? ' added to the pipeline' : ''}.`, 'See results', () => { LF.jobFilter = j.id; go(`lf-leads/${q ? 'Qualified' : 'all'}`); });
  else if (j.status === 'failed') oops(`${jobLabel(j)} stopped: ${j.error || 'unknown error'}`);
  LF.refreshDash(); LF.loadNames(); if (S.live) sync(true, true);
  if (S.view.startsWith('lf-') && ['lf-home', 'lf-leads'].includes(S.view) && !$('#lfJobPanel')) { render.full = true; render(); }
};
LF.chip = () => {
  const c = $('#lfChip'); if (!c) return;
  const j = LF.jobs.find(x => x.status === 'running') || LF.jobs.find(running);
  if (!j || !LF.on || (S.view === 'lf-find' && j.type === 'discovery') || (S.view === 'lf-bulk' && j.type === 'bulk')) { c.hidden = true; return; }
  const p = j.progress || {}, pct = p.total ? Math.round(100 * p.done / p.total) : 0;
  c.hidden = false;
  c.innerHTML = `<span class="lfring ${p.total ? '' : 'spin'}" style="--p:${pct}"></span><span class="t">${esc(jobLabel(j))}<span>${esc(p.phase || 'Starting')}${p.total ? ` · ${p.done} of ${p.total}` : ''}${j.counts?.Qualified ? ` · ${j.counts.Qualified} qualified` : ''}</span></span><span class="ms">chevron_right</span>`;
  c.onclick = () => go(j.type === 'discovery' ? 'lf-find' : j.type === 'bulk' && !j.params?.quick ? 'lf-bulk' : 'lf-home');
};
LF.rail = () => {
  const q = $('#cLfQ'); if (q) q.textContent = LF.dash?.totals?.qualified || '';
  const d = $('#cLf'); if (d) { const on = LF.on && LF.jobs.some(running); d.classList.toggle('on', on); d.title = on ? 'A Lead Finder search is running' : ''; }
};
LF.onView = v => { LF.chip(); if (v === 'overview' && LF.on && Date.now() - (LF.dashAt || 0) > 15000) { LF.dashAt = Date.now(); LF.refreshDash(); } };

/* ---------- sidebar group: click to open, chevron to fold ---------- */
function applyFold(open) {
  const g = $('#lfGroup'); if (!g) return;
  g.classList.toggle('collapsed', !open); const ch = $('#lfChev');
  if (ch) { ch.setAttribute('aria-expanded', open); ch.setAttribute('aria-label', open ? 'Hide the Lead Finder menu' : 'Show the Lead Finder menu'); }
  store.set('navOpen', open);
}
function bindRail() {
  applyFold(store.get('navOpen', true));
  $('#lfChev')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); applyFold($('#lfGroup').classList.contains('collapsed')); });
  $('#lfParent')?.addEventListener('click', () => applyFold(true));
}
LF.subnav = v => `<nav class="lf-subnav" aria-label="Lead Finder">${SUB.map(([k, ic, l]) => `<a href="#${k}" ${k === v ? 'aria-current="page"' : ''}><span class="ms">${ic}</span>${l}</a>`).join('')}</nav>`;

/* ---------- view router ---------- */
const V = {};
LF.render = (v, el, full) => {
  if (!full && el.dataset.lfv === v && el.querySelector('.lf')) return;
  el.dataset.lfv = v; LF.view = v; const tok = ++LF.seq;
  el.innerHTML = `<div class="lf enter">${LF.subnav(v)}<div id="lfBody"><div class="grid kpis">${'<div class="skel" style="height:132px"></div>'.repeat(4)}</div></div></div>`;
  const box = $('#lfBody');
  if (!S.live) { box.innerHTML = `<div class="card empty"><span class="ms">radar</span><b>Lead Finder needs the Canvass server</b>Sign in to use Lead Finder. The preview has no server behind it.</div>`; return; }
  Promise.resolve(V[v] ? V[v](box, () => tok === LF.seq) : null).catch(e => { if (tok === LF.seq) box.innerHTML = `<div class="banner warn"><span class="ms">error</span><div class="grow">Couldn’t load this page: ${esc(e.message || e)}</div><button class="btn text sm" onclick="render.full=true;render()">Try again</button></div>`; });
};
const ensureSet = async () => { if (!LF.set) LF.set = await api('lf_settings'); return LF.set; };

/* ================= Dashboard ================= */
V['lf-home'] = async (box, alive) => {
  const [d, h, jl] = await Promise.all([api('lf_dashboard'), api('lf_health'), api('lf_jobs'), ensureSet()]);
  if (!alive()) return; LF.dash = d; LF.health = h; LF.jobs = jl.jobs; LF.worker = jl.worker; LF.rail();
  const t = d.totals, b = h.budget, run = LF.jobs.filter(running);
  const linked = all().filter(x => x.lfId), waiting = linked.filter(x => x.status === 'lead' && !x.ownerId);
  const total = CATS4.reduce((s, c) => s + (d.charts.validation[c] || 0), 0);
  const line = !t.discovered ? 'Search Google or upload a list. Every business is verified, audited and scored before it reaches your pipeline.'
    : `<b>${t.qualified}</b> qualified lead${t.qualified === 1 ? '' : 's'} from <b>${t.discovered}</b> businesses checked.${waiting.length ? ` <b>${waiting.length}</b> waiting to be claimed in the pipeline.` : ''}`;
  box.innerHTML = `
  <div class="hello" style="--i:0"><div class="grow"><h2>${t.qualified ? `${n0(t.qualified)} lead${t.qualified === 1 ? '' : 's'} ready to pitch` : 'Find your next clients'}<span>.</span></h2><p>${line}</p></div>
   <div class="lf-actions"><button class="btn filled rp" data-goto="lf-find"><span class="ms">travel_explore</span>Find on Google</button><button class="btn tonal rp" data-goto="lf-bulk"><span class="ms">upload_file</span>Upload a list</button><button class="btn outline rp" data-goto="lf-add"><span class="ms">bolt</span>Quick add</button></div></div>
  ${d.demoMode ? `<div class="banner warn"><span class="ms">science</span><div class="grow">Demo mode is on. ${d.demoRecords} fictional demo companies are included below. Turn it off in Settings for real figures.</div><button class="btn text sm" data-goto="lf-settings">Settings</button></div>` : ''}
  ${!h.placesKey ? `<div class="banner"><span class="ms">key</span><div class="grow">Add your Google Places key to search Google automatically. Bulk upload and Quick add work without it.</div>${admin() ? '<button class="btn text sm" data-goto="lf-settings">Add key</button>' : ''}</div>` : ''}
  ${run.length ? `<section class="card" style="margin-bottom:16px" id="lfJobPanel" data-lfjob="${esc(run[0].id)}">${jobPanel(run[0])}</section>` : ''}
  <div class="grid kpis lf-kpis" style="--i:1">
   <a class="card kpi hero" href="#lf-leads/Qualified"><div class="lab"><span class="ms">verified</span>Qualified leads</div><div class="big num">${n0(t.qualified)}</div><div class="foot"><b>${t.highPriority}</b> high priority</div></a>
   <a class="card kpi" href="#lf-leads/all"><div class="lab"><span class="ms">storefront</span>Businesses checked</div><div class="big num">${n0(t.discovered)}</div><div class="foot">${t.active} confirmed active</div></a>
   <a class="card kpi" href="#pipeline"><div class="lab"><span class="ms">view_kanban</span>In your pipeline</div><div class="big num">${n0(t.transferred)}</div><div class="foot"><b>${t.converted}</b> won${t.followUpsDue ? ` · <span class="overdue">${t.followUpsDue} follow-up${t.followUpsDue === 1 ? '' : 's'} due</span>` : ''}</div></a>
   <div class="card kpi"><div class="lab"><span class="ms">data_usage</span>Google requests</div><div class="big num">${b.enabled ? `${n0(b.used)}<span style="font-size:18px;color:var(--muted)"> / ${n0(b.limit)}</span>` : n0(b.used)}</div><div class="foot">${b.enabled ? `Today ${b.dayUsed} of ${b.dayLimit} · free-tier limit on` : '<span class="overdue">Limit off</span>'}</div></div>
  </div>
  <div class="grid two" style="--i:2">
   <section class="card"><div class="card-h"><h2>Validation results</h2><span class="grow"></span><span class="sub num">${total} checked</span></div>
    ${total ? `<div class="lf-funnel" role="img" aria-label="Validation results">${CATS4.filter(c => d.charts.validation[c]).map((c, i) => `<i style="--sc:${CATC[c]};flex:${d.charts.validation[c]};animation-delay:${i * 70}ms" title="${c}: ${d.charts.validation[c]}"></i>`).join('')}</div>
    <div class="lf-legend">${CATS4.map(c => `<a href="#lf-leads/${encodeURIComponent(c)}"><span class="dot" style="--pc:${CATC[c]}"></span>${c}<b>${d.charts.validation[c] || 0}</b></a>`).join('')}</div>` : '<div class="empty"><span class="ms">fact_check</span><b>No results yet</b>Run a search or upload a list to see how businesses score.</div>'}
    <p class="rep-help" style="margin-top:12px"><span class="ms">info</span><span>Only <b>Qualified</b> businesses go to the pipeline. They passed every check and have at least one confirmed issue you can help with.</span></p></section>
   <section class="card"><div class="card-h"><h2>Recent searches</h2><span class="grow"></span><button class="btn text sm rp" data-goto="lf-reports">History</button></div>
    <div class="list">${LF.jobs.slice(0, 6).map(j => `<button class="row rp" data-lfjobres="${esc(j.id)}"><span class="bizicon" style="--sc:${stColor(j)}"><span class="ms">${jobIcon(j)}</span></span><span class="t"><b>${esc(jobLabel(j))}</b><span>${esc(stLabel(j))} · ${j.counts?.Qualified || 0} qualified of ${j.progress?.done || 0} · ${agoI(j.startedAt || j.createdAt)}</span></span><span class="ms" style="color:var(--muted)">chevron_right</span></button>`).join('') || '<div class="empty"><span class="ms">history</span><b>No searches yet</b>Your searches and uploads show up here.</div>'}</div></section>
  </div>
  <div class="lf-strip" style="--i:3">
   <a href="#lf-leads/Unverified"><b>${t.unverified}</b><span>Unverified</span></a><a href="#lf-leads/Rejected"><b>${t.rejected}</b><span>Rejected</span></a><a href="#lf-leads/No%20Opportunity"><b>${t.noOpportunity}</b><span>No opportunity</span></a>
   <div><b>${t.withoutWebsite}</b><span>Without a website</span></div><div><b>${t.weakGbp}</b><span>Weak Google profiles</span></div><div><b>${t.websiteIssues}</b><span>With website issues</span></div>
   <div><b>${t.withinWindow}</b><span>Est. within ${LF.set?.eligibilityYears || 5} years</span></div><a href="#lf-leads/Duplicates"><b>${t.duplicatesSkipped}</b><span>Duplicates skipped</span></a></div>
  <div class="grid two" style="--i:4">
   <section class="card"><div class="card-h"><h2>Where the opportunities are</h2></div>${bars(d.charts.issues, { color: k => k.startsWith('Google') ? 'var(--warn)' : 'var(--accent)' })}</section>
   <section class="card"><div class="card-h"><h2>Services to pitch</h2><span class="grow"></span><span class="sub">Across qualified leads</span></div>${bars(d.charts.services, { color: () => 'var(--good)' })}</section>
  </div>
  <div class="grid two" style="--i:5">
   <section class="card"><div class="card-h"><h2>Industries</h2></div>${bars(d.charts.industry)}</section>
   <section class="card"><div class="card-h"><h2>Areas</h2></div>${bars(d.charts.location)}</section>
  </div>`;
  bindJobPanel(box);
};

/* ================= job panel (Find, Upload, Dashboard) ================= */
function jobPanel(j) {
  const p = j.progress || {}, pct = p.total ? Math.round(100 * p.done / p.total) : (j.status === 'done' ? 100 : 0), r = running(j);
  return `<div class="lf-job"><div class="top"><span class="bizicon" style="--sc:${stColor(j)}"><span class="ms">${jobIcon(j)}</span></span><div class="t"><b>${esc(jobLabel(j))}</b><span>${esc(stLabel(j))}${r ? ` · ${esc(p.phase || 'Starting')}` : ''}${p.total ? ` · ${p.done} of ${p.total} businesses` : ''}</span></div>
   ${r ? `<button class="btn outline sm rp" data-lfstop="${esc(j.id)}" ${j.cancelRequested ? 'disabled' : ''}><span class="ms">stop_circle</span>${j.cancelRequested ? 'Stopping…' : 'Stop'}</button>` : `<button class="btn tonal sm rp" data-lfjobres="${esc(j.id)}"><span class="ms">fact_check</span>See results</button>`}</div>
   <div class="lf-prog ${r && !p.total ? 'ind' : ''}"><i style="width:${pct}%"></i></div>
   <div class="lf-counts">${countsPills(j.counts)}</div>
   ${j.error ? `<div class="lf-note bad"><span class="ms">error</span><div>${esc(j.error)}</div></div>` : ''}${j.note ? `<div class="lf-note warn"><span class="ms">info</span><div>${esc(j.note)}</div></div>` : ''}
   ${r && !(LF.worker && LF.worker.background) ? `<p class="hint" style="margin:0"><span class="ms" style="font-size:15px;vertical-align:-3px">info</span> Keep Canvass open in a tab until this finishes${S.view.startsWith('lf-') ? '' : ''}. You can use other pages meanwhile.</p>` : ''}
   ${j.log ? `<details class="lfx" ${r ? '' : ''}><summary><span class="ms">receipt_long</span>Step-by-step log<span class="ms chev">expand_more</span></summary><div class="in"><div class="lf-log">${esc((j.log || []).slice(-120).join('\n'))}</div></div></details>` : ''}</div>`;
}
function bindJobPanel(root) {
  root.addEventListener('click', async e => {
    let el;
    if (el = e.target.closest('[data-lfstop]')) { el.disabled = true; try { await api('lf_job_cancel', { id: el.dataset.lfstop }); info('Stopping after the business being checked now.'); } catch (x) { fail(x); } LF.kick(); return; }
    if (el = e.target.closest('[data-lfjobres]')) { const j = LF.jobs.find(x => x.id === el.dataset.lfjobres); LF.jobFilter = el.dataset.lfjobres; go(`lf-leads/${j && j.counts?.Qualified ? 'Qualified' : 'all'}`); }
  });
}
LF.updatePanels = async () => {
  const p = $('#lfJobPanel'); if (!p) return;
  const id = p.dataset.lfjob; if (!id) return;
  try {
    const j = await api(qs('lf_job', { id }));
    const open = p.querySelector('details')?.open, lg = p.querySelector('.lf-log'), atEnd = lg ? lg.scrollTop + lg.clientHeight >= lg.scrollHeight - 8 : true;
    p.innerHTML = jobPanel(j);
    if (open) { p.querySelector('details').open = true; const l2 = p.querySelector('.lf-log'); if (l2 && atEnd) l2.scrollTop = l2.scrollHeight; }
  } catch { }
};

/* ================= Find on Google ================= */
V['lf-find'] = async (box, alive) => {
  const [s, h, jl] = await Promise.all([api('lf_settings'), api('lf_health'), api('lf_jobs')]);
  if (!alive()) return; LF.set = s; LF.health = h; LF.jobs = jl.jobs; LF.worker = jl.worker;
  const last = store.get('find', {}); const cur = LF.jobs.find(j => j.type === 'discovery' && running(j)) || (LF.jobs[0]?.type === 'discovery' && Date.now() - new Date(LF.jobs[0].finishedAt || 0) < 3600e3 ? LF.jobs[0] : null);
  const opts = (list, sel) => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
  box.innerHTML = `
  ${!h.placesKey ? `<div class="banner"><span class="ms">key</span><div class="grow">Searching Google needs a Google Places API key (Places API (New)). ${admin() ? 'Add it in Settings.' : 'Ask the admin to add it in Lead Finder settings.'} Bulk upload and Quick add work without it.</div>${admin() ? '<button class="btn text sm" data-goto="lf-settings">Add key</button>' : ''}</div>` : ''}
  <div class="grid two" style="margin-top:0">
   <section class="card lf-form"><div class="card-h"><span class="stepno">1</span><h2>What and where</h2></div>
    <form id="lfFind" novalidate><div class="fields">
     <div class="field"><label for="ff_ind">Industry</label><select class="inp" id="ff_ind" name="industryId" required><option value="">Choose an industry</option>${s.industries.map(i => `<option value="${esc(i.id)}" ${i.id === last.industryId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
     <div class="field"><label for="ff_cat">Type of business <small>(optional)</small></label><input class="inp" id="ff_cat" name="category" list="ffCatList" value="${esc(last.category || '')}" placeholder="e.g. fit-out company"><datalist id="ffCatList"></datalist></div>
     <div class="field"><label for="ff_city">City</label><input class="inp" id="ff_city" name="city" list="ffCities" value="${esc(last.city || 'Dubai')}" required><datalist id="ffCities">${opts(CITIES)}</datalist></div>
     <div class="field"><label for="ff_area">Area <small>(optional)</small></label><input class="inp" id="ff_area" name="area" value="${esc(last.area || '')}" placeholder="e.g. Business Bay"></div>
     <div class="field"><label for="ff_country">Country</label><input class="inp" id="ff_country" name="country" list="ffCountries" value="${esc(last.country || s.defaultCountry)}" required><datalist id="ffCountries">${opts(COUNTRIES)}</datalist></div>
     <div class="field"><label for="ff_count">Qualified leads you want</label><div class="num-step"><button type="button" class="rp" data-step="-1" aria-label="Fewer"><span class="ms">remove</span></button><input class="inp num" id="ff_count" name="count" type="number" min="1" max="200" value="${esc(last.count || 10)}" inputmode="numeric"><button type="button" class="rp" data-step="1" aria-label="More"><span class="ms">add</span></button></div></div>
    </div>
    <div class="lf-est" id="ffEst"></div>
    <div class="lf-go"><button class="btn filled rp" id="ffGo" type="submit" ${h.placesKey ? '' : 'disabled'}><span class="ms">travel_explore</span>Find and check leads</button><button type="button" class="btn text rp" id="ffSched" ${h.placesKey ? '' : 'disabled'}><span class="ms">event_repeat</span>Repeat automatically…</button></div></form>
   </section>
   <section class="card" id="${cur ? 'lfJobPanel' : 'lfHow'}" ${cur ? `data-lfjob="${esc(cur.id)}"` : ''}>${cur ? jobPanel(cur) : howItWorks()}</section>
  </div>
  <section class="card" style="margin-top:16px"><div class="card-h"><h2>Repeating searches</h2><span class="grow"></span><span class="sub">Run on a schedule. New businesses only, duplicates are skipped.</span></div><div id="ffSchedList"></div></section>`;
  const f = $('#lfFind');
  const val = () => Object.fromEntries(new FormData(f));
  const upd = () => {
    const v = val(), ind = s.industries.find(i => i.id === v.industryId), cnt = Math.max(1, +v.count || 1);
    $('#ffCatList').innerHTML = (ind?.keywords || []).map(k => `<option>${esc(k)}</option>`).join('');
    const cap = Math.min(s.maxCandidatesPerSearch, Math.max(cnt * 6, 20)), queries = v.category ? 1 : 1 + Math.min(4, ind?.keywords?.length || 0);
    const pagesMax = Math.min(Math.ceil(cap / 20) + queries, queries * 3), b = LF.health.budget, left = b.enabled ? Math.min(b.remaining, b.dayRemaining) : null;
    $('#ffEst').innerHTML = `<p><span class="ms" style="font-size:16px;vertical-align:-3px;color:var(--accent)">info</span> Checks up to <b>${cap}</b> businesses and stops once <b>${cnt}</b> qualif${cnt === 1 ? 'ies' : 'y'}. Uses up to <b>${pagesMax}</b> Google requests.${left !== null && left < pagesMax ? ' <b style="color:var(--warn)">You may hit your limit first. Businesses found by then are still checked.</b>' : ''}</p>${budgetMeter(b)}`;
  };
  f.oninput = upd; upd();
  f.addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (!b) return; const i = $('#ff_count'); i.value = Math.max(1, Math.min(200, (+i.value || 0) + +b.dataset.step)); upd(); });
  f.onsubmit = async e => {
    e.preventDefault(); const v = val();
    if (!v.industryId) { warn('Choose an industry first'); $('#ff_ind').focus(); return; }
    if (!v.city.trim()) { warn('Add a city'); $('#ff_city').focus(); return; }
    store.set('find', v); const btn = $('#ffGo'); btn.disabled = true;
    try {
      const j = await api('lf_discover', v); LF.jobs.unshift(j); LF.kick();
      const panel = $('#lfHow') || $('#lfJobPanel'); panel.id = 'lfJobPanel'; panel.dataset.lfjob = j.id; panel.innerHTML = jobPanel(j);
      ok('Search started. Each business is checked as it’s found.'); if (innerWidth < 1180) toView(panel);
    } catch (x) { fail(x); }
    btn.disabled = !LF.health.placesKey;
  };
  $('#ffSched').onclick = () => {
    const v = val(); if (!v.industryId || !v.city) return warn('Choose an industry and city first');
    modal(`<form id="schF"><h2>Repeat this search</h2><p class="lead">Canvass runs it on its own and adds only new businesses. It counts toward your Google limits.</p>
      <div class="fields"><div class="field full"><label for="schName">Name</label><input class="inp" id="schName" value="${esc((v.category || indName(v.industryId)) + ' in ' + [v.area, v.city].filter(Boolean).join(', '))}"></div>
      <div class="field full"><label>How often</label><div class="seg" role="group" id="schEvery">${[[24, 'Daily'], [168, 'Weekly'], [720, 'Monthly']].map(([h_, l]) => `<button type="button" data-h="${h_}" aria-pressed="${h_ === 168}">${l}</button>`).join('')}</div></div></div>
      <div class="acc-mfoot"><span class="grow"></span><button type="button" class="btn text" data-act="closeModal">Cancel</button><button class="btn filled"><span class="ms">check</span>Save</button></div></form>`, m => {
      $$('#schEvery button', m).forEach(b => b.onclick = () => $$('#schEvery button', m).forEach(x => x.setAttribute('aria-pressed', x === b)));
      $('#schF', m).onsubmit = async ev => { ev.preventDefault(); try { await api('lf_schedule_save', { name: $('#schName', m).value, everyHours: +$('#schEvery [aria-pressed="true"]', m).dataset.h, params: v }); closeModal(); ok('Saved. It runs on its own from now on.'); drawSched(); } catch (x) { fail(x); } };
    });
  };
  const drawSched = async () => {
    const list = (await api('lf_schedules')).schedules;
    $('#ffSchedList').innerHTML = list.length ? `<div class="list">${list.map(x => `<div class="row"><span class="bizicon" style="--sc:var(--accent)"><span class="ms">event_repeat</span></span><span class="t"><b>${esc(x.name)}</b><span>${x.everyHours >= 720 ? 'Monthly' : x.everyHours >= 168 ? 'Weekly' : 'Daily'} · last run ${x.lastRunAt ? esc(fmtDT(x.lastRunAt)) : 'not yet'}${x.lastResult ? ' · ' + esc(x.lastResult) : ''}</span></span><button class="btn text sm rp" data-schdel="${esc(x.id)}" style="color:var(--bad)">Remove</button></div>`).join('')}</div>`
      : `<div class="empty" style="padding:16px"><span class="ms">event_repeat</span><b>No repeating searches</b>Fill in the search above, then choose “Repeat automatically”.</div>`;
    $$('[data-schdel]', box).forEach(b => b.onclick = async () => { if (!await confirmBox('Remove this repeating search?', 'It won’t run again. Results already found stay.', 'Remove', true)) return; await api('lf_schedule_delete', { id: b.dataset.schdel }); drawSched(); });
  };
  drawSched(); bindJobPanel(box);
};
function howItWorks() {
  return `<div class="card-h"><span class="stepno">2</span><h2>What Canvass checks</h2></div><ol class="lf-steps">
   <li><span class="ms">category</span><div><b>Right industry and area</b>Google categories and the address must match your search.</div></li>
   <li><span class="ms">block</span><div><b>Leaves out the wrong fits</b>Closed, chain, very large, out-of-area and duplicate businesses.</div></li>
   <li><span class="ms">bolt</span><div><b>Confirms it’s active</b>Recent reviews, a working website, opening hours, a phone number.</div></li>
   <li><span class="ms">cake</span><div><b>Checks its age</b>Licence dates, domain records and website history. Domain dates alone never reject a business.</div></li>
   <li><span class="ms">travel_explore</span><div><b>Audits Google profile and website</b>Reviews, photos, hours, HTTPS, mobile, SEO, enquiry forms, speed.</div></li>
   <li><span class="ms">auto_awesome</span><div><b>Scores it and drafts pitches</b>From real findings only. Nothing is ever sent automatically.</div></li>
   <li><span class="ms">view_kanban</span><div><b>Qualified leads join the pipeline</b>They appear under Spotted, ready for someone to claim.</div></li></ol>`;
}

/* ================= Bulk upload ================= */
V['lf-bulk'] = async (box, alive) => {
  const [s, h, jl] = await Promise.all([ensureSet(), api('lf_health'), api('lf_jobs')]);
  if (!alive()) return; LF.health = h; LF.jobs = jl.jobs; LF.worker = jl.worker;
  const cur = LF.jobs.find(j => j.type === 'bulk' && !j.params?.quick && running(j));
  let parsed = null, fileName = '';
  box.innerHTML = `
  ${!h.placesKey ? '<div class="banner"><span class="ms">info</span><div class="grow">No Google Places key yet, so Google profile checks are skipped. Websites and age are still checked, but most businesses will stay Unverified until activity is confirmed.</div></div>' : ''}
  <div class="grid two" style="margin-top:0">
   <section class="card"><div class="card-h"><span class="stepno">1</span><h2>Add businesses</h2></div>
    <div class="lf-drop" id="bkDrop" tabindex="0" role="button" aria-label="Choose a spreadsheet"><span class="ms">upload_file</span><b>Drop an Excel or CSV file here</b><span>or click to choose one. Columns we read: Company, Website, Phone, Email, Address, City, Country, Industry, Google Maps link, Instagram, LinkedIn, Established date + source.</span></div>
    <input type="file" id="bkFile" accept=".xlsx,.xls,.csv" hidden><div id="bkInfo"></div>
    <div class="lf-or">or paste</div>
    <label class="sr" for="bkPaste">Paste one per line</label><textarea class="inp" id="bkPaste" rows="6" placeholder="One per line: websites, business names or Google Maps links&#10;example-business.ae&#10;Olive Interiors LLC&#10;https://maps.app.goo.gl/…"></textarea>
    <p class="hint"><a href="#" id="bkTpl">Download a template</a> to fill in Excel.</p>
   </section>
   <section class="card lf-form"><div class="card-h"><span class="stepno">2</span><h2>Filter <small style="font-weight:600;color:var(--muted)">(optional)</small></h2></div>
    <p class="hint" style="margin:-6px 0 14px">Set these to reject businesses outside your target industry or city.</p>
    <div class="fields"><div class="field full"><label for="bkInd">Industry</label><select class="inp" id="bkInd"><option value="">Any industry</option>${s.industries.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="bkCity">City</label><input class="inp" id="bkCity" list="bkCities" placeholder="Any"><datalist id="bkCities">${CITIES.map(c => `<option>${c}</option>`).join('')}</datalist></div>
    <div class="field"><label for="bkCountry">Country</label><input class="inp" id="bkCountry" value="${esc(s.defaultCountry)}"></div></div>
    <div class="lf-go"><button class="btn filled rp" id="bkGo"><span class="ms">fact_check</span>Check this list</button></div>
    ${admin() ? `<details class="lfx" style="margin-top:18px"><summary><span class="ms">history</span>Earlier Canvass list<span class="ms chev">expand_more</span></summary><div class="in"><p class="hint" style="margin:0">Re-check the businesses from the first version of the app, if that list is on this computer.</p><button class="btn outline sm rp" id="bkLegacy" style="align-self:flex-start">Import and re-check</button></div></details>` : ''}
   </section>
  </div>
  <section class="card" style="margin-top:16px" ${cur ? `id="lfJobPanel" data-lfjob="${esc(cur.id)}"` : 'id="bkPanel" hidden'}>${cur ? jobPanel(cur) : ''}</section>`;
  const drop = $('#bkDrop'), file = $('#bkFile');
  drop.onclick = () => file.click(); drop.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.click());
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); }; drop.ondragleave = () => drop.classList.remove('hot');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('hot'); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && read(file.files[0]);
  async function read(fl) {
    try {
      await loadXlsx();
      const wb = XLSX.read(await fl.arrayBuffer(), { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      for (const addr of Object.keys(ws)) { if (addr[0] === '!') continue; const c = ws[addr]; if (c.l?.Target) { const p = XLSX.utils.decode_cell(addr); (rows[p.r] ||= [])[p.c] = c.l.Target; } }
      parsed = rows.filter(r => r && r.some(v => String(v).trim())); fileName = fl.name;
      $('#bkInfo').innerHTML = `<div class="lf-file"><span class="ms">task</span><div class="t"><b>${esc(fl.name)}</b><span>${Math.max(0, parsed.length - 1)} rows · columns: ${esc((parsed[0] || []).filter(Boolean).join(', ').slice(0, 200))}</span></div><button class="icon-btn" id="bkClear" aria-label="Remove file"><span class="ms">close</span></button></div>`;
      $('#bkClear').onclick = () => { parsed = null; fileName = ''; $('#bkInfo').innerHTML = ''; file.value = ''; };
    } catch (e) { parsed = null; $('#bkInfo').innerHTML = `<div class="lf-note bad" style="margin-top:10px"><span class="ms">error</span><div>Couldn’t read that file: ${esc(e.message)}</div></div>`; }
  }
  $('#bkTpl').onclick = e => {
    e.preventDefault();
    const csv = '﻿Company,Website,Phone,Email,City,Country,Industry,Google Maps link,Instagram,Established date,Established source\r\nExample Interiors LLC,example-interiors.ae,+971 4 000 0000,hello@example-interiors.ae,Dubai,United Arab Emirates,Interior design,,,2023-03-01,DED licence 123456\r\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'canvass-upload-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const start = async body => {
    try {
      const j = await api('lf_bulk', body); LF.jobs.unshift(j); LF.kick();
      const p = $('#bkPanel') || $('#lfJobPanel'); p.hidden = false; p.id = 'lfJobPanel'; p.dataset.lfjob = j.id; p.innerHTML = jobPanel(j); toView(p);
      ok(`Checking ${j.params.rows} business${j.params.rows === 1 ? '' : 'es'}.`);
    } catch (x) { fail(x); }
  };
  $('#bkGo').onclick = () => {
    const text = $('#bkPaste').value.trim();
    if (!parsed && !text) return warn('Choose a file or paste some businesses first');
    start({ rows: parsed || [], text, fileName: fileName || 'Pasted list', industryId: $('#bkInd').value, city: $('#bkCity').value.trim(), country: $('#bkCountry').value.trim() });
  };
  $('#bkLegacy') && ($('#bkLegacy').onclick = async () => { if (await confirmBox('Re-check the earlier list?', 'Businesses already in Lead Finder are skipped as duplicates.', 'Start')) { try { const j = await api('lf_bulk_legacy', {}); LF.jobs.unshift(j); LF.kick(); render.full = true; render(); } catch (x) { fail(x); } } });
  bindJobPanel(box);
};

/* ================= Results ================= */
V['lf-leads'] = async (box, alive) => {
  const s = await ensureSet(); const d = LF.dash = await api('lf_dashboard'); if (!alive()) return; LF.rail();
  const arg = LF.arg || 'Qualified'; const tab = [...CATS4, 'all', 'Duplicates'].includes(arg) ? arg : 'Qualified';
  const t = d.totals, counts = { Qualified: t.qualified, Unverified: t.unverified, 'No Opportunity': t.noOpportunity, Rejected: t.rejected, all: t.discovered, Duplicates: t.duplicatesSkipped };
  const intro = { Qualified: 'Passed every check and has at least one confirmed issue you can help with. These are in the pipeline under Spotted.', Unverified: 'Something important couldn’t be confirmed (age, activity, location, industry or contact). Open one and add evidence to re-check it.',
    'No Opportunity': 'Active and a good fit, but nothing confirmed to improve right now.', Rejected: 'Left out: too old, closed, large or a chain, out of area, wrong industry, or not genuine.', all: 'Every business Lead Finder has checked.', Duplicates: 'Skipped because the business was already in Lead Finder (same Google listing, website, phone, or name and area).' };
  const job = LF.jobFilter ? LF.jobs.find(j => j.id === LF.jobFilter) || { id: LF.jobFilter, type: '', params: {} } : null;
  const st = store.get('leadsState', { q: '', industry: '', priority: '', sort: 'score' }); st.page = 0;
  box.innerHTML = `
  ${d.demoMode ? '<div class="banner warn"><span class="ms">science</span><div class="grow">Demo mode is on. Names starting with [DEMO] are fictional.</div></div>' : ''}
  <nav class="lf-tabs" aria-label="Result groups">${[...CATS4, 'all', 'Duplicates'].map(c => `<a href="#lf-leads/${encodeURIComponent(c)}" ${c === tab ? 'aria-current="page"' : ''}><span class="dot" style="--pc:${CATC[c]}"></span>${c === 'all' ? 'All' : c === 'Duplicates' ? 'Duplicates skipped' : c}<b>${counts[c] ?? 0}</b></a>`).join('')}</nav>
  <p class="lf-intro">${esc(intro[tab])}</p><div id="lrBox"></div>`;
  if (tab === 'Duplicates') {
    const h = await api('lf_history'); if (!alive()) return;
    $('#lrBox').innerHTML = h.duplicates.length ? `<div class="tablewrap lf-table"><table><thead><tr><th>When</th><th>Skipped</th><th>Already in Lead Finder as</th><th>Matched by</th><th>From</th></tr></thead><tbody>${h.duplicates.map(x => `<tr ${x.matchedId ? `data-lfopen="${esc(x.matchedId)}"` : ''}><td style="white-space:nowrap">${esc(fmtDT(x.at))}</td><td>${esc(x.name)}</td><td><b>${esc(x.matchedName)}</b></td><td>${esc(x.by)}</td><td>${esc(x.source)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="card empty"><span class="ms">content_copy</span><b>No duplicates skipped</b></div>';
    return;
  }
  const lr = $('#lrBox');
  lr.innerHTML = `<div class="toolbar"><label class="searchbox"><span class="ms">search</span><span class="sr">Search results</span><input id="lrQ" value="${esc(st.q)}" placeholder="Name, website, phone, area…" autocomplete="off"></label>
   <select class="inp" id="lrInd" aria-label="Industry"><option value="">All industries</option>${s.industries.map(i => `<option value="${esc(i.id)}" ${st.industry === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
   ${tab === 'Qualified' ? `<select class="inp" id="lrPr" aria-label="Priority"><option value="">All priorities</option>${['High', 'Medium', 'Low'].map(p => `<option ${st.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>` : ''}
   <select class="inp" id="lrSort" aria-label="Sort"><option value="score">Highest score</option><option value="recent" ${st.sort === 'recent' ? 'selected' : ''}>Recently checked</option><option value="name" ${st.sort === 'name' ? 'selected' : ''}>Name A–Z</option></select>
   ${job ? `<span class="lf-filter"><span class="ms">filter_alt</span>${esc(jobLabel(job))}<button id="lrJobX" aria-label="Show all"><span class="ms">close</span></button></span>` : ''}
   <span class="grow"></span><button class="btn text sm rp" id="lrRe" title="Run every check again for the businesses on this page. Uses Google requests."><span class="ms">autorenew</span>Re-check page</button></div><div id="lrRows"></div>`;
  const draw = async () => {
    const res = await api(qs('lf_companies', { category: tab, q: st.q, industry: st.industry, priority: tab === 'Qualified' ? st.priority : '', sort: st.sort, page: st.page, size: 50, job: job?.id || '' }));
    if (!alive()) return; st.ids = res.items.map(x => x.id);
    const rows = res.items;
    $('#lrRows').innerHTML = rows.length ? `<div class="tablewrap lf-table"><table><thead><tr><th>Business</th><th>${tab === 'Qualified' ? 'Priority' : 'Why'}</th><th>Findings</th><th>Pitch</th><th>Website</th><th>Pipeline</th><th>Checked</th></tr></thead><tbody>
      ${rows.map(c => `<tr data-lfopen="${esc(c.id)}" tabindex="0"><td><div class="bn">${ring(c.score, 'sm')}<div><b title="${esc(c.name)}">${esc(c.name)}</b><span>${esc([c.industry, c.area, c.city].filter(Boolean).join(' · '))}</span></div></div></td>
       <td>${tab === 'Qualified' ? ppill(c.priority) : tab === 'all' ? cpill(c.category) + (c.reasons[0] ? `<span class="sub" style="max-width:240px">${esc(c.reasons[0])}</span>` : '') : `<span style="display:block;max-width:260px;font-size:13px">${esc(c.reasons[0] || '—')}</span>`}</td>
       <td style="font-size:13px"><b>${c.confirmedIssues}</b> confirmed · ${c.potentialIssues} to check<span class="sub" style="max-width:240px">${esc(c.topIssues.slice(0, 2).join('; '))}</span></td>
       <td><div class="svcs">${c.services.slice(0, 2).map(x => `<span class="svc">${esc(x)}</span>`).join('') || '<span class="sub">—</span>'}</div></td>
       <td style="font-size:13px">${c.website ? link(c.website) : '—'}<span class="sub">${esc(c.websiteStatus)}</span></td>
       <td>${c.hq ? `<button class="btn text sm" data-hqopen="${esc(c.hq.id)}" style="padding:0 6px">${stPill(c.hq.status)}</button>` : c.category === 'Qualified' && !c.demo ? `<button class="btn tonal sm rp" data-addpipe="${esc(c.id)}"><span class="ms">add</span>Add</button>` : '<span class="sub">—</span>'}</td>
       <td style="white-space:nowrap;color:var(--muted);font-size:13px">${esc(agoI(c.lastVerifiedAt))}</td></tr>`).join('')}</tbody></table></div>
      <div class="lf-mlist">${rows.map(c => `<button class="lf-mcard rp" data-lfopen="${esc(c.id)}"><div class="h">${ring(c.score, 'sm')}<div class="t"><b>${esc(c.name)}</b><span>${esc([c.industry, c.area || c.city].filter(Boolean).join(' · '))}</span></div>${tab === 'Qualified' ? ppill(c.priority) : cpill(c.category)}</div>
        <div class="m">${tab === 'Qualified' ? `<span><b style="color:var(--ink)">${c.confirmedIssues}</b> confirmed issue${c.confirmedIssues === 1 ? '' : 's'}</span>${c.services[0] ? `<span class="svc">${esc(c.services[0])}</span>` : ''}` : `<span>${esc(c.reasons[0] || '')}</span>`}${c.hq ? stPill(c.hq.status) : ''}</div></button>`).join('')}</div>
      <div class="lf-pager"><span>${res.total} business${res.total === 1 ? '' : 'es'}</span><span class="grow"></span>${res.total > 50 ? `<button class="btn outline sm" id="lrPrev" ${st.page ? '' : 'disabled'}>Previous</button><span>Page ${st.page + 1} of ${Math.ceil(res.total / 50)}</span><button class="btn outline sm" id="lrNext" ${(st.page + 1) * 50 < res.total ? '' : 'disabled'}>Next</button>` : ''}</div>`
      : `<div class="card empty"><span class="ms">${CATI[tab]}</span><b>${st.q || st.industry || st.priority || job ? 'Nothing matches' : `No ${tab === 'all' ? '' : tab.toLowerCase() + ' '}results yet`}</b>${st.q || st.industry || st.priority || job ? 'Try clearing a filter.' : 'Run a search or upload a list.'}${!st.q && !job && tab === 'Qualified' && t.discovered ? '<a class="btn tonal sm rp" href="#lf-leads/Unverified" style="margin-top:8px">See unverified</a>' : ''}</div>`;
    $('#lrPrev') && ($('#lrPrev').onclick = () => { st.page--; draw(); }); $('#lrNext') && ($('#lrNext').onclick = () => { st.page++; draw(); });
  };
  const save = () => store.set('leadsState', { q: st.q, industry: st.industry, priority: st.priority, sort: st.sort });
  let deb; $('#lrQ').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value.trim(); st.page = 0; save(); draw(); }, 250); };
  $('#lrInd').onchange = e => { st.industry = e.target.value; st.page = 0; save(); draw(); };
  $('#lrPr') && ($('#lrPr').onchange = e => { st.priority = e.target.value; st.page = 0; save(); draw(); });
  $('#lrSort').onchange = e => { st.sort = e.target.value; save(); draw(); };
  $('#lrJobX') && ($('#lrJobX').onclick = () => { LF.jobFilter = null; render.full = true; render(); });
  $('#lrRe').onclick = async () => { if (!st.ids?.length) return; if (!await confirmBox(`Re-check ${st.ids.length} business${st.ids.length === 1 ? '' : 'es'}?`, 'Every check runs again. This uses Google requests within your limits.', 'Re-check')) return; try { await api('lf_refresh', { ids: st.ids }); LF.kick(); ok('Re-check started. You’ll see the progress at the bottom.'); } catch (x) { fail(x); } };
  lr.addEventListener('click', e => { const a = e.target.closest('[data-addpipe]'); if (a) { e.stopPropagation(); toPipeline(a.dataset.addpipe).then(draw); } const h = e.target.closest('[data-hqopen]'); if (h) { e.stopPropagation(); openDrawer(h.dataset.hqopen); } }, true);
  draw();
};
async function toPipeline(id, force) {
  try { const r = await api('lf_to_pipeline', { id, force: !!force }); await sync(true, true); ok('Added to the pipeline under Spotted.', 'Open', () => openDrawer(r.hqId)); LF.refreshDash(); return r; }
  catch (e) { if (e.code === 409 && !force && await confirmBox('Add it anyway?', e.message, 'Add to pipeline')) return toPipeline(id, true); if (e.code !== 409) fail(e); }
}

/* ================= Reports & backup ================= */
V['lf-reports'] = async (box, alive) => {
  const [h, u, bk] = await Promise.all([api('lf_history'), api('lf_usage'), api('lf_backups')]); if (!alive()) return;
  const bb = u.budget;
  box.innerHTML = `
  <div class="grid two" style="margin-top:0">
   <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">download</span><h2>Export</h2></div>
    <div class="fields" style="grid-template-columns:1fr"><div class="field"><label for="exSet">What to export</label><select class="inp" id="exSet"><option value="qualified">Qualified leads</option><option value="pipeline">In the pipeline</option><option value="unverified">Unverified</option><option value="no-opportunity">No opportunity</option><option value="rejected">Rejected</option><option value="all">Everything</option></select></div></div>
    <div class="lf-go"><button class="btn filled rp" id="exX"><span class="ms">table_view</span>Excel (.xlsx)</button><button class="btn tonal rp" id="exC"><span class="ms">description</span>CSV</button></div><p class="hint" id="exNote"></p></section>
   <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">backup</span><h2>Backup &amp; restore</h2></div>
    <p class="hint" style="margin:-6px 0 12px">A backup is made on the server every day (the last 14 are kept). API keys are never in a backup. You can also restore a backup from the <b>Windows version (v1.0)</b> here to move your leads online.</p>
    <div class="lf-actions"><button class="btn filled rp" id="bkDl"><span class="ms">download</span>Download backup</button><button class="btn tonal rp" id="bkNow"><span class="ms">save</span>Back up now</button>${admin() ? '<button class="btn outline rp" id="bkUp"><span class="ms">upload</span>Restore from file…</button><input type="file" id="bkUpF" accept=".json,application/json" hidden>' : ''}</div>
    <details class="lfx" style="margin-top:14px"><summary><span class="ms">inventory_2</span>Backups on the server (${bk.backups.length})<span class="ms chev">expand_more</span></summary><div class="in">${bk.backups.length ? `<table class="lf-mini"><tbody>${bk.backups.slice(0, 20).map(b => `<tr><td>${esc(b.name.replace('canvass-backup-', '').replace('.json', ''))}</td><td style="white-space:nowrap">${Math.max(1, Math.round(b.size / 1024))} KB</td><td style="text-align:right">${admin() ? `<button class="btn text sm" data-rs="${esc(b.name)}">Restore</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">None yet.</p>'}</div></details></section>
  </div>
  <section class="card" style="margin-top:16px"><div class="card-h"><span class="ms" style="color:var(--accent)">data_usage</span><h2>Google usage</h2><span class="grow"></span><span class="sub">${esc(u.note)}</span></div>
   <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:20px;align-items:start" id="usGrid"><div style="display:flex;flex-direction:column;gap:12px">${budgetMeter(bb)}<p class="hint" style="margin:0">Months are counted in Pacific Time, the way Google bills. Canvass refuses a Google request before sending it once a limit is reached.</p></div>
   <div style="overflow-x:auto">${u.days.length ? `<table class="lf-mini"><thead><tr><th>Day</th><th>Google Places</th><th>PageSpeed</th><th>Domain records</th><th>Archive</th><th>Websites</th><th>Est. cost</th></tr></thead><tbody>${u.days.slice(0, 31).map(d => `<tr><td style="white-space:nowrap">${esc(fmtD(d.day))}</td>${['places', 'pagespeed', 'rdap', 'wayback', 'website'].map(k => `<td class="num">${d.apis[k] ? `${d.apis[k].ok}${d.apis[k].failed ? ` <span style="color:var(--bad)">(${d.apis[k].failed} failed)</span>` : ''}` : '—'}</td>`).join('')}<td class="num">$${d.estimatedCostUsd.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:16px">No requests yet.</div>'}</div></div></section>
  <section class="card" style="margin-top:16px"><div class="card-h"><span class="ms" style="color:var(--accent)">history</span><h2>Search history</h2></div>
   ${h.searches.length ? `<div style="overflow-x:auto"><table class="lf-mini"><thead><tr><th>When</th><th>Type</th><th>Search or file</th><th>Found</th><th>Results</th></tr></thead><tbody>${h.searches.map(x => `<tr><td style="white-space:nowrap">${esc(fmtDT(x.at))}</td><td>${esc(x.type)}</td><td>${esc(x.params?.fileName || [x.params?.category || indName(x.params?.industryId), [x.params?.area, x.params?.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</td><td class="num">${x.candidates ?? ''}</td><td><div class="lf-counts">${countsPills(x.counts)}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:16px"><span class="ms">history</span><b>No searches yet</b></div>'}</section>`;
  if (innerWidth < 900) $('#usGrid').style.gridTemplateColumns = '1fr';
  const note = () => api(qs('lf_export', { dataset: $('#exSet').value })).then(tb => { $('#exNote').textContent = `${tb.rows.length} rows. ${tb.note}`; return tb; });
  note(); $('#exSet').onchange = note;
  $('#exC').onclick = () => download(qs('api.php?a=lf_export', { format: 'csv', dataset: $('#exSet').value }));
  $('#exX').onclick = async () => {
    try {
      const [tb] = await Promise.all([note(), loadXlsx()]); const ds = $('#exSet').value, t = LF.dash?.totals || {};
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Canvass Lead Finder report', new Date().toLocaleString()], [], ['Measure', 'Count'], ['Businesses checked', t.discovered], ['Qualified', t.qualified], ['Unverified', t.unverified], ['Rejected', t.rejected], ['No opportunity', t.noOpportunity], ['In the pipeline', t.transferred], ['Won', t.converted], [], ['Note', tb.note], ...(LF.dash?.demoMode ? [['WARNING', 'Demo mode is on: includes fictional demonstration data']] : [])]), 'Summary');
      const ws = XLSX.utils.aoa_to_sheet([tb.header, ...tb.rows]); ws['!cols'] = tb.header.map(x => ({ wch: Math.min(48, Math.max(12, x.length + 2)) }));
      XLSX.utils.book_append_sheet(wb, ws, ds.slice(0, 30)); XLSX.writeFile(wb, `canvass-${ds}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { fail(e); }
  };
  $('#bkDl').onclick = () => download('api.php?a=lf_backup_download');
  $('#bkNow').onclick = async () => { try { await api('lf_backup_save', {}); ok('Backup saved on the server.'); render.full = true; render(); } catch (e) { fail(e); } };
  const restoreDone = r => { ok(`Restored ${r.restored} businesses${r.addedToPipeline ? `, ${r.addedToPipeline} added to the pipeline` : ''}.`); LF.refreshDash(); LF.loadNames(); sync(true, true); render.full = true; render(); };
  if ($('#bkUp')) {
    $('#bkUp').onclick = () => $('#bkUpF').click();
    $('#bkUpF').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      let data; try { data = JSON.parse(await f.text()); } catch { return oops('That file isn’t a Canvass backup.'); }
      if (!data || !data.companies) return oops('That file isn’t a Canvass backup.');
      const n = Object.keys(data.companies).length;
      if (!await confirmBox(`Restore ${n} businesses from “${f.name}”?`, 'This replaces the Lead Finder data on the server. A safety backup is made first. Pitch HQ businesses, people and Accounts are not touched. Leads that were in the old sales pipeline are added to the Canvass pipeline.', 'Restore', true)) return;
      try { restoreDone(await api('lf_restore', data)); } catch (x) { fail(x); }
    };
  }
  $$('[data-rs]', box).forEach(b => b.onclick = async () => { if (!await confirmBox('Restore this backup?', 'Current Lead Finder data is backed up first, then replaced.', 'Restore', true)) return; try { restoreDone(await api('lf_backup_restore', { name: b.dataset.rs })); } catch (x) { fail(x); } });
};

/* ================= Settings ================= */
V['lf-settings'] = async (box, alive) => {
  const [s, h, d] = await Promise.all([api('lf_settings'), api('lf_health'), api('lf_dashboard')]); if (!alive()) return; LF.set = s;
  const ro = admin() ? '' : 'disabled';
  const num = (n, v, l, help = '', step = 1) => `<div class="field"><label for="st_${n}">${esc(l)}</label><input class="inp num" type="number" step="${step}" id="st_${n}" name="${n}" value="${esc(v)}" ${ro}>${help ? `<small>${esc(help)}</small>` : ''}</div>`;
  const sw = (n, v, l, help = '') => `<div class="switch" role="switch" tabindex="0" data-sw="${n}" aria-checked="${!!v}" ${ro ? 'aria-disabled="true"' : ''}><div class="t"><b>${esc(l)}</b>${help ? `<span>${esc(help)}</span>` : ''}</div><span class="tog" aria-checked="${!!v}"></span></div>`;
  const key = (n, l, conf, masked, env, help) => `<div class="field"><label for="st_${n}">${esc(l)}</label><input class="inp" id="st_${n}" name="${n}" type="password" autocomplete="off" placeholder="${conf ? esc(masked) + ' (saved)' : 'Not set'}" ${ro || env ? 'disabled' : ''}><small>${env ? 'Set on the server (environment variable).' : esc(help)}</small></div>`;
  const wsum = Object.values(s.weights).reduce((a, b) => a + b, 0);
  box.innerHTML = `<form class="lf-set" id="stF" novalidate>
  ${admin() ? '' : '<div class="banner"><span class="ms">lock</span><div class="grow">Only the admin can change Lead Finder settings. You can see them here.</div></div>'}
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">key</span><div><h2>Google keys</h2><p>Keys stay on the server and are never shown in full, exported or backed up.</p></div></div>
   <div class="fields">${key('googlePlacesKey', 'Google Places API key', s.googlePlacesKeyConfigured, s.googlePlacesKey, s.googlePlacesKeyFromEnv, 'Needs Places API (New). Restrict the key to Places API.')}
   ${key('pageSpeedKey', 'PageSpeed Insights key (optional)', s.pageSpeedKeyConfigured, s.pageSpeedKey, s.pageSpeedKeyFromEnv, 'Free from Google Cloud. Without it, speed tests use a small shared quota.')}</div>
   <p class="hint">Leave a key empty to keep the saved one. ${s.googlePlacesKeyConfigured || s.pageSpeedKeyConfigured ? 'Type a single space and save to remove one.' : ''}</p></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">shield</span><div><h2>Free-tier protection</h2><p>Canvass counts every Google Places request and stops before going past your limits.</p></div></div>
   <div class="switches">${sw('b_enabled', s.budget.enabled, 'Enforce the limits (recommended)', 'Off means Canvass won’t stop at a limit.')}</div>
   <div class="fields" style="margin-top:12px">${num('b_month', s.budget.placesMonthlyLimit, 'Requests per month')}${num('b_day', s.budget.placesDailyLimit, 'Requests per day')}</div>
   <div style="margin-top:14px">${budgetMeter(h.budget)}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">rule</span><div><h2>Which businesses qualify</h2><p>The rules every business must pass. The score never overrides them.</p></div></div>
   <div class="fields">${num('eligibilityYears', s.eligibilityYears, 'Founded within (years)', 'Counted back from today.')}${num('activeMinEvidence', s.activeMinEvidence, 'Activity signals needed', 'Besides Google saying “open”.')}${num('recentReviewMonths', s.recentReviewMonths, 'A review is recent within (months)')}
   ${num('largeCompanyReviewThreshold', s.largeCompanyReviewThreshold, 'Too large above (reviews)')}${num('chainLocationThreshold', s.chainLocationThreshold, 'A chain at (same-name places)')}${num('maxCandidatesPerSearch', s.maxCandidatesPerSearch, 'Most businesses per search', 'Keeps Google use in check.')}${num('ageMinSources', s.ageMinSources, 'Sources for an accepted estimate')}</div>
   <div class="switches">${sw('acceptEstimatedAge', s.acceptEstimatedAge, 'Accept consistent estimates for age', 'Off (recommended): only a licence or registration date, or an old review, confirms age. On: matching domain and archive dates count as an estimate.')}
   ${sw('rejectOldWebsiteArchive', s.rejectOldWebsiteArchive, 'Reject when the website is older than the window', 'Unless a newer founding date is recorded.')}
   ${sw('requireConfirmedIssue', s.requireConfirmedIssue, 'Qualified needs at least one confirmed issue', 'Off: possible improvements alone can qualify a business.')}
   ${sw('autoAddToPipeline', s.autoAddToPipeline !== false, 'Add qualified leads to the pipeline automatically', 'They appear under Spotted for anyone to claim.')}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">speed</span><div><h2>Lead score</h2><p>Out of 100 (weights add up to ${wsum}, always rescaled). High and Medium priority start at these scores.</p></div></div>
   <div class="fields">${num('w_age', s.weights.age, 'Company age')}${num('w_activity', s.weights.activity, 'Active and genuine')}${num('w_gbp', s.weights.gbp, 'Google profile gaps')}${num('w_website', s.weights.website, 'Website gaps')}${num('w_contact', s.weights.contact, 'Contact details')}${num('p_high', s.priority.high, 'High priority from')}${num('p_medium', s.priority.medium, 'Medium priority from')}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">storefront</span><div><h2>Google profile benchmarks</h2><p>Below these, a profile counts as weak for that industry.</p></div></div>
   <div class="tablewrap lf-ind" style="box-shadow:none;border:1px solid var(--line)"><table><thead><tr><th>Industry</th><th>Min. reviews</th><th>Min. rating</th><th>Min. photos</th></tr></thead><tbody>
   ${[{ id: 'default', name: 'Default (all others)' }, ...s.industries].map(i => { const b = s.benchmarks[i.id]; return `<tr><td>${esc(i.name)}${b || i.id === 'default' ? '' : ' <span class="hint">(default)</span>'}</td>${['minReviews', 'minRating', 'minPhotos'].map(k => `<td><input class="inp num" style="width:96px" type="number" step="${k === 'minRating' ? 0.1 : 1}" data-bm="${esc(i.id)}" data-k="${k}" value="${esc((b || s.benchmarks.default)[k])}" aria-label="${esc(i.name)} ${k}" ${ro}></td>`).join('')}</tr>`; }).join('')}</tbody></table></div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">badge</span><div><h2>Your company</h2><p>Used to sign the pitches.</p></div></div>
   <div class="fields">${[['name', 'Company name'], ['sender', 'Sender name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']].map(([k, l]) => `<div class="field"><label for="c_${k}">${l}</label><input class="inp" id="c_${k}" name="c_${k}" value="${esc(s.company[k])}" ${ro}></div>`).join('')}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">design_services</span><div><h2>Services you offer</h2><p>Only switched-on services are suggested, and only when a finding supports them.</p></div></div>
   <div class="lf-chiplist">${s.services.map((x, i) => `<button type="button" class="chip rp" data-svci="${i}" aria-pressed="${!!x.enabled}" ${ro}><span class="ms">${x.enabled ? 'check' : 'add'}</span>${esc(x.name)}</button>`).join('')}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">category</span><div><h2>Industries</h2><p>Google place types and keywords decide whether a business belongs to an industry. Separate with commas.</p></div></div>
   <div class="tablewrap lf-ind" style="box-shadow:none;border:1px solid var(--line)"><table><thead><tr><th>Industry</th><th>Google place types</th><th>Keywords</th></tr></thead><tbody id="indRows">
   ${s.industries.map((i, n) => `<tr><td><input class="inp" data-ind="${n}" data-k="name" value="${esc(i.name)}" ${ro}></td><td><input class="inp" data-ind="${n}" data-k="types" value="${esc((i.types || []).join(', '))}" ${ro}></td><td><input class="inp" data-ind="${n}" data-k="keywords" value="${esc((i.keywords || []).join(', '))}" ${ro}></td></tr>`).join('')}</tbody></table></div>
   ${admin() ? '<button type="button" class="btn text sm rp" id="addInd" style="margin-top:10px"><span class="ms">add</span>Add industry</button>' : ''}</section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">policy</span><div><h2>Data and Google’s terms</h2><p>Google content is deleted after the days below (Place IDs are kept).</p></div></div>
   <div class="fields">${num('googleRetentionDays', s.googleRetentionDays, 'Keep Google content for (days)', 'Google allows at most 30.')}${num('brokenLinkSample', s.brokenLinkSample, 'Links checked per website')}${num('contactCooldownDays', s.contactCooldownDays, 'Days before contacting again', 'Warns you if you log the same channel sooner.')}${num('cost_places', s.costPer1000.places, 'Places price per 1,000 (US$)', 'For estimates only. Check Google’s price list.', 0.01)}</div>
   <div class="switches">${sw('runPageSpeed', s.runPageSpeed, 'Run Google speed tests on websites', 'Adds 10–60 seconds per website.')}${sw('includeGoogleContentInExports', s.includeGoogleContentInExports, 'Include Google ratings and Google-only contacts in exports', 'Google restricts this. Leave off unless your use is allowed.')}</div></section>
  <section class="card"><div class="card-h"><span class="ms" style="color:var(--accent)">science</span><div><h2>Demo data</h2><p>${d.demoRecords} fictional demo companies stored. They are marked [DEMO], never go to the pipeline, and only count while demo mode is on.</p></div></div>
   <div class="lf-actions"><button type="button" class="btn tonal rp" id="demoLoad" ${ro}><span class="ms">science</span>Load demo data</button><button type="button" class="btn outline rp" id="demoClear" ${ro} style="color:var(--bad)"><span class="ms">delete</span>Remove demo data</button></div></section>
  ${admin() ? '<div class="lf-savebar"><span class="grow" id="stDirty">All changes saved</span><button class="btn filled rp" id="stSave"><span class="ms">check</span>Save settings</button></div>' : ''}
  </form>`;
  if (!admin()) return;
  const f = $('#stF'); let dirty = false;
  const mark = () => { dirty = true; $('#stDirty').textContent = 'You have unsaved changes'; $('#stDirty').style.color = 'var(--warn)'; };
  f.addEventListener('input', mark);
  f.addEventListener('click', e => {
    const sw_ = e.target.closest('[data-sw]'); if (sw_) { const v = sw_.getAttribute('aria-checked') !== 'true'; sw_.setAttribute('aria-checked', v); sw_.querySelector('.tog').setAttribute('aria-checked', v); mark(); return; }
    const c = e.target.closest('[data-svci]'); if (c) { const v = c.getAttribute('aria-pressed') !== 'true'; c.setAttribute('aria-pressed', v); c.querySelector('.ms').textContent = v ? 'check' : 'add'; mark(); }
  });
  f.addEventListener('keydown', e => { const sw_ = e.target.closest('[data-sw]'); if (sw_ && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); sw_.click(); } });
  $('#addInd').onclick = () => { const n = $$('#indRows tr').length; $('#indRows').insertAdjacentHTML('beforeend', `<tr><td><input class="inp" data-ind="${n}" data-k="name" placeholder="New industry"></td><td><input class="inp" data-ind="${n}" data-k="types"></td><td><input class="inp" data-ind="${n}" data-k="keywords"></td></tr>`); mark(); };
  f.onsubmit = async e => {
    e.preventDefault();
    const v = n => f.elements[n]?.value, b = n => $(`[data-sw="${n}"]`).getAttribute('aria-checked') === 'true';
    const body = {
      eligibilityYears: +v('eligibilityYears'), activeMinEvidence: +v('activeMinEvidence'), recentReviewMonths: +v('recentReviewMonths'), largeCompanyReviewThreshold: +v('largeCompanyReviewThreshold'), chainLocationThreshold: +v('chainLocationThreshold'),
      maxCandidatesPerSearch: +v('maxCandidatesPerSearch'), ageMinSources: +v('ageMinSources'), acceptEstimatedAge: b('acceptEstimatedAge'), rejectOldWebsiteArchive: b('rejectOldWebsiteArchive'), requireConfirmedIssue: b('requireConfirmedIssue'),
      autoAddToPipeline: b('autoAddToPipeline'), runPageSpeed: b('runPageSpeed'), includeGoogleContentInExports: b('includeGoogleContentInExports'),
      weights: { age: +v('w_age'), activity: +v('w_activity'), gbp: +v('w_gbp'), website: +v('w_website'), contact: +v('w_contact') }, priority: { high: +v('p_high'), medium: +v('p_medium') },
      googleRetentionDays: +v('googleRetentionDays'), brokenLinkSample: +v('brokenLinkSample'), contactCooldownDays: +v('contactCooldownDays'), costPer1000: { ...s.costPer1000, places: +v('cost_places') },
      budget: { enabled: b('b_enabled'), placesMonthlyLimit: +v('b_month'), placesDailyLimit: +v('b_day') },
      company: Object.fromEntries(['name', 'sender', 'phone', 'email', 'website'].map(k => [k, v('c_' + k)])),
      services: s.services.map((x, i) => ({ ...x, enabled: $(`[data-svci="${i}"]`).getAttribute('aria-pressed') === 'true' })), benchmarks: {}, industries: []
    };
    for (const k of ['googlePlacesKey', 'pageSpeedKey']) { const val = v(k); if (val) body[k] = val === ' ' ? '' : val.trim(); }
    $$('[data-bm]').forEach(i => { (body.benchmarks[i.dataset.bm] ||= {})[i.dataset.k] = +i.value; });
    $$('#indRows tr').forEach((tr, n) => { const g = k => $(`[data-k="${k}"]`, tr).value; const old = s.industries[n] || {}; if (g('name').trim()) body.industries.push({ ...old, id: old.id || g('name'), name: g('name'), types: g('types'), keywords: g('keywords') }); });
    try { LF.set = await api('lf_settings_save', body); LF.health = await api('lf_health'); dirty = false; ok('Settings saved.'); render.full = true; render(); } catch (x) { fail(x); }
  };
  $('#demoLoad').onclick = async () => { try { const r = await api('lf_demo_load', {}); ok(`Loaded ${r.loaded} demo companies. Demo mode is on.`); LF.refreshDash(); render.full = true; render(); } catch (x) { fail(x); } };
  $('#demoClear').onclick = async () => { if (!await confirmBox('Remove all demo companies?', 'Demo mode is switched off too.', 'Remove', true)) return; try { const r = await api('lf_demo_clear', {}); ok(`Removed ${r.removed} demo companies.`); LF.refreshDash(); render.full = true; render(); } catch (x) { fail(x); } };
  LF.leaveGuard = () => dirty;
};

/* ================= company panel ================= */
LF.open = async id => {
  LF.openId = id; S.openId = null;
  const dr = $('#drawer');
  if (!dr.classList.contains('on')) { dr.innerHTML = `<div class="dr-h"><div class="t"><div class="skel" style="height:30px;width:60%"></div></div><button class="icon-btn rp" data-act="close" aria-label="Close"><span class="ms">close</span></button></div><div class="dr-b"><div class="skel" style="height:90px"></div><div class="skel" style="height:220px"></div></div>`; }
  dr.classList.add('on', 'lf-dr'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on');
  let c; try { c = await api(qs('lf_company', { id })); } catch (e) { LF.close(); return fail(e); }
  if (LF.openId !== id) return;
  drawCompany(c);
};
LF.close = () => { LF.openId = null; const dr = $('#drawer'); dr.classList.remove('lf-dr'); closeDrawer(); };
const _closeDrawer = closeDrawer;
window.closeDrawer = closeDrawer = function () { LF.openId = null; $('#drawer').classList.remove('lf-dr'); _closeDrawer(); };
function drawCompany(c, keepTab) {
  const dr = $('#drawer'); const sc0 = dr.querySelector('.dr-b')?.scrollTop || 0;
  const g = c.google || {}, a = c.age || {}, act = c.activity || {}, v = c.validation || {}, sc = c.score || {}, p = c.pipeline || {}, wa = c.websiteAudit, ra = c.reviewAnalysis || {}, cat = v.category || 'Unprocessed';
  const fact = (k, val, sub = '') => `<div class="lf-fact"><div class="k">${esc(k)}</div><div class="v">${val || '—'}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const conf = (c.issues || []).filter(i => i.status === 'Confirmed Issue'), pot = (c.issues || []).filter(i => i.status !== 'Confirmed Issue');
  const issue = i => `<div class="lf-issue ${i.status === 'Confirmed Issue' ? '' : 'pot'}"><span class="ic"><span class="ms">${i.area === 'gbp' ? 'storefront' : 'language'}</span></span><div><b>${esc(i.title)}</b><div class="d">${esc(i.detail)}</div><div class="s">${i.area === 'gbp' ? 'Google profile' : 'Website'} · ${safeUrl(i.evidence) && /^https?:/i.test(i.evidence || '') ? link(i.evidence, 'source') : esc(i.evidence)} · ${esc(fmtD(i.checkedAt))}</div></div></div>`;
  const ev = [...(a.evidence || []).map(e => ({ what: e.label + ': ' + e.date, src: e.source, url: e.url, at: e.checkedAt, kind: 'Age' })), ...(act.evidence || []).map(e => ({ what: e.label, src: e.source, url: e.url, at: e.checkedAt, kind: 'Activity' }))];
  const pitches = c.pitch ? PITCH.filter(([k]) => c.pitch[k]) : [];
  const hq = c.hq, inPipe = !!hq;
  const hist = [...(p.history || []), ...(p.notes || []).map(n => ({ at: n.at, event: '📝 ' + n.text }))].sort((x, y) => String(y.at).localeCompare(x.at));
  dr.innerHTML = `<div class="dr-grip" aria-hidden="true"></div><div class="dr-h"><span class="bizicon" style="--sc:${CATC[cat] || 'var(--muted)'}">${esc(ini(c.name))}</span><div class="t"><h2>${esc(c.name)}</h2><div class="sub">${cpill(cat)}<span>${esc([c.industryName || c.industry || g.primaryTypeDisplayName, c.area, c.city].filter(Boolean).join(' · '))}</span>${c.demo ? '<span class="tag-ex">Demo</span>' : ''}</div></div><button class="icon-btn rp" data-act="close" aria-label="Close"><span class="ms">close</span></button></div>
  <div class="dr-b">
   <div class="lf-sum">${ring(sc.total, 'lg')}<div class="t"><b>${sc.priority ? `${esc(sc.priority)} priority` : 'Lead score'}</b><span>${cat === 'Qualified' ? `${conf.length} confirmed issue${conf.length === 1 ? '' : 's'} to help with · checked ${esc(agoI(c.lastVerifiedAt))}` : `Checked ${esc(agoI(c.lastVerifiedAt))}`}</span></div></div>
   ${cat !== 'Qualified' && (v.reasons || []).length ? `<div class="lf-note ${cat === 'Rejected' ? 'bad' : 'warn'}"><span class="ms">${CATI[cat] || 'info'}</span><div><b>Why it’s ${esc(cat.toLowerCase())}</b><ul class="lf-reasons">${v.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${cat === 'Unverified' ? '<div style="margin-top:6px">Know something we couldn’t find? Use <b>Add evidence</b> below.</div>' : ''}</div></div>` : ''}
   ${p.validationWarning ? `<div class="lf-note warn"><span class="ms">info</span><div>It’s in the pipeline, but the latest check says <b>${esc(cat)}</b>.</div></div>` : ''}
   <div class="lf-acts">
    ${inPipe ? `<button class="btn filled rp" data-hqopen="${esc(hq.id)}"><span class="ms">view_kanban</span>Open in pipeline</button><span style="align-self:center">${stPill(hq.status)}</span>` : cat === 'Qualified' && !c.demo ? `<button class="btn filled rp" data-lfact="pipe"><span class="ms">add</span>Add to pipeline</button>` : ''}
    <button class="btn tonal rp" data-lfact="refresh" ${c.demo ? 'disabled title="Demo records are not re-checked online"' : ''}><span class="ms">autorenew</span>Re-check</button>
    ${admin() ? `<button class="btn text rp" data-lfact="delete" style="color:var(--bad)"><span class="ms">delete</span>Delete</button>` : ''}</div>
   <div><div class="sec-t">At a glance</div><div class="lf-facts">
    ${fact('Phone', c.contact?.phone ? `<a href="tel:${esc(c.contact.phone.replace(/[^\d+]/g, ''))}">${esc(c.contact.phone)}</a>` : 'Not available', esc(c.contactSources?.phone || ''))}
    ${fact('Email', c.contact?.email ? `<a href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a>` : 'Not available', esc(c.contactSources?.email || ''))}
    ${fact('Website', c.contact?.website ? link(c.contact.website) : esc(c.websiteStatus || 'Not available'), esc(c.contact?.website ? c.websiteStatus || '' : ''))}
    ${fact('Google Maps', c.contact?.mapsUrl ? link(c.contact.mapsUrl, 'Open in Maps') : (g.placeId ? link('https://www.google.com/maps/place/?q=place_id:' + g.placeId, 'Open in Maps') : 'Not available'), c.contact?.directionsUrl ? link(c.contact.directionsUrl, 'Directions') : '')}
    ${fact('Company age', `${esc(a.status || '—')}${a.earliestDate ? ' · since ' + esc(fmtD(a.earliestDate)) : ''}`, esc(a.basis || ''))}
    ${fact('Open for business', esc(act.status || '—'), `${act.signals ?? 0} activity signal${act.signals === 1 ? '' : 's'}`)}
    ${fact('Google rating', g.rating != null ? `${esc(g.rating)} ★` : g.expired ? 'Expired, re-check to refresh' : 'Not available', g.userRatingCount != null ? `${n0(g.userRatingCount)} reviews` : '')}
    ${fact('Website age', a.websiteAge?.firstSeen ? `Online since ${esc(fmtD(a.websiteAge.firstSeen))}` : esc(a.websiteAge?.status || '—'), a.websiteAge?.firstSeen ? 'Estimate from archive history' : '')}
    ${fact('Location', esc([c.area, c.city, c.country].filter(Boolean).join(', ') || '—'), esc(c.contact?.address || ''))}
    ${fact('Found by', esc(c.source?.type === 'google' ? 'Google search' : c.source?.type === 'quick' ? 'Quick add' : c.source?.type === 'demo' ? 'Demo data' : 'Upload'), esc(c.source?.detail || ''))}
   </div>${g.placeId && !c.demo && !g.expired ? `<p class="hint">Google Maps data © Google. Kept for at most ${esc(LF.set?.googleRetentionDays || 30)} days.</p>` : ''}</div>
   <div><div class="sec-t">What we found<span class="grow"></span><span class="num" style="text-transform:none;letter-spacing:0">${conf.length} confirmed · ${pot.length} to check</span></div>
    ${conf.length ? conf.map(issue).join('') : '<p class="hint" style="margin:0">No confirmed issues.</p>'}
    ${pot.length ? `<details class="lfx" style="margin-top:10px"><summary><span class="ms">tips_and_updates</span>${pot.length} possible improvement${pot.length === 1 ? '' : 's'}<span class="ms chev">expand_more</span></summary><div class="in" style="gap:0">${pot.map(issue).join('')}</div></details>` : ''}</div>
   <div><div class="sec-t">Services to pitch</div>${(c.services || []).length ? `<div class="lf-svc">${c.services.map(s => `<div><b>${esc(s.name)}</b><span>Because: ${esc(s.reasons.join('; '))}</span></div>`).join('')}</div>` : '<p class="hint" style="margin:0">No suggestions. Nothing found supports one.</p>'}</div>
   ${pitches.length ? `<div><div class="sec-t">Ready-made pitch<span class="grow"></span><span style="text-transform:none;letter-spacing:0;font-weight:600">Review before sending</span></div>
    <div class="seg" role="tablist" style="max-width:100%;overflow-x:auto">${pitches.map(([k, l, ic]) => `<button type="button" role="tab" data-pt="${k}" aria-pressed="${k === (keepTab || 'email')}"><span class="ms" style="font-size:17px">${ic}</span>${l}</button>`).join('')}</div>
    <pre class="lf-pitch" id="lfPitch"></pre>
    <div class="lf-acts" style="margin-top:10px"><button class="btn tonal rp" data-lfact="copy"><span class="ms">content_copy</span>Copy</button><button class="btn outline rp" data-lfact="sent" ${p.doNotContact ? 'disabled' : ''}><span class="ms">done_all</span>I sent this</button>${c.contact?.email ? `<a class="btn text rp" id="lfMail" href="#"><span class="ms">mail</span>Open in email</a>` : ''}${c.contact?.phone ? `<a class="btn text rp" id="lfWa" href="#" target="_blank" rel="noopener"><span class="ms">chat</span>WhatsApp</a>` : ''}</div>
    <p class="hint">Nothing is sent automatically. “I sent this” records it, warns you if the same channel was used in the last ${esc(LF.set?.contactCooldownDays ?? 14)} days, and moves the pipeline card to Pitched.</p></div>`
    : `<div><div class="sec-t">Ready-made pitch</div><p class="hint" style="margin:0">Pitches are written only for qualified leads.</p></div>`}
   <div><div class="sec-t">Contact &amp; notes</div>
    <div class="switch" role="switch" tabindex="0" data-lfact="dnc" aria-checked="${!!p.doNotContact}"><div class="t"><b>Do not contact</b><span>They asked not to hear from us.</span></div><span class="tog" aria-checked="${!!p.doNotContact}"></span></div>
    <div style="display:flex;gap:8px;margin-top:10px"><input class="inp" id="lfNote" placeholder="Add a note (call outcome, next step…)"><button class="btn tonal rp" data-lfact="note">Add</button></div>
    ${c.contactVerifiedAt ? `<p class="hint">Contact details confirmed ${esc(fmtD(c.contactVerifiedAt))}. They stay after Google’s 30-day limit.</p>` : `<button class="btn text sm rp" data-lfact="verify" style="margin-top:8px" title="Keeps Google-sourced contact details after the 30-day limit"><span class="ms">verified_user</span>I confirmed these contact details myself</button>`}
    ${hist.length ? `<div class="lf-hist" style="margin-top:10px">${hist.map(h => `<div><time>${esc(fmtD(h.at))}</time><span>${esc(h.event)}</span></div>`).join('')}</div>` : ''}</div>
   <details class="lfx"><summary><span class="ms">add_task</span>Add evidence<span class="ms chev">expand_more</span></summary><div class="in">
    <p class="hint" style="margin:0">Confirmed something yourself, like a trade licence date? Add it with its source and the business is re-checked straight away.</p>
    <div class="fields"><div class="field full"><label for="evType">What did you confirm?</label><select class="inp" id="evType"><option value="establishment">Founding or licence date</option><option value="activity">Recent activity (post, call, visit)</option><option value="identity">It’s a genuine business</option><option value="no-website">It has no website</option><option value="invalid">It’s fake or invalid</option></select></div>
    <div class="field" id="evDateW"><label for="evDate">Date</label><input class="inp" type="date" id="evDate" max="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label for="evSrc">Source</label><input class="inp" id="evSrc" placeholder="e.g. DED licence 123456"></div><div class="field full"><label for="evUrl">Link <small>(optional)</small></label><input class="inp" id="evUrl" placeholder="https://"></div></div>
    <button class="btn filled rp" data-lfact="evidence" style="align-self:flex-start"><span class="ms">check</span>Save and re-check</button></div></details>
   <details class="lfx"><summary><span class="ms">checklist</span>All checks<span class="ms chev">expand_more</span></summary><div class="in">
    <table class="lf-mini"><tbody>${(v.checks || []).map(x => `<tr><td>${esc(x.label)}</td><td>${x.state === 'pass' ? cpill('Pass').replace('var(--muted)', 'var(--good)') : x.state === 'fail-reject' ? cpill('Rejected') : x.state === 'fail-unverified' ? cpill('Unverified') : x.state === 'no-opportunity' ? cpill('No Opportunity') : '<span class="hint">n/a</span>'}</td><td style="color:var(--muted)">${esc(x.detail)}</td></tr>`).join('')}</tbody></table>
    <p class="hint" style="margin:0">Score parts: ${Object.entries(sc.parts || {}).map(([k, val]) => `${esc(k)} ${esc(val)}/${esc(sc.max?.[k])}`).join(' · ')}. ${esc(sc.note || '')}</p></div></details>
   <details class="lfx"><summary><span class="ms">source</span>Sources (${ev.length})<span class="ms chev">expand_more</span></summary><div class="in">
    ${ev.length ? `<table class="lf-mini"><thead><tr><th>Type</th><th>Finding</th><th>Source</th><th>Checked</th></tr></thead><tbody>${ev.map(e => `<tr><td>${esc(e.kind)}</td><td>${esc(e.what)}</td><td>${e.url ? link(e.url, e.src) : esc(e.src)}</td><td style="white-space:nowrap">${esc(fmtD(e.at))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin:0">No sources recorded.</p>'}
    ${(a.notes || []).map(n => `<p class="hint" style="margin:0">${esc(n)}</p>`).join('')}${act.note ? `<p class="hint" style="margin:0"><b>Activity:</b> ${esc(act.note)}</p>` : ''}</div></details>
   ${wa ? `<details class="lfx"><summary><span class="ms">language</span>Website check<span class="ms chev">expand_more</span></summary><div class="in"><div class="lf-facts">
    ${fact('Checked', esc(fmtDT(wa.checkedAt)))}${fact('Status', wa.availability?.ok ? `Working (HTTP ${esc(wa.availability.httpStatus)})` : esc(wa.availability?.error || 'Failed'))}${fact('Response time', wa.availability?.responseMs ? `${(wa.availability.responseMs / 1000).toFixed(2)} s` : '—', 'One measurement')}
    ${fact('Secure (HTTPS)', wa.https?.usesHttps ? 'Yes' : 'No', wa.https?.httpRedirectsToHttps === false ? 'Plain address doesn’t redirect' : '')}${fact('Works on phones', wa.page ? (wa.page.viewport ? 'Yes' : 'No') : '—')}${fact('Page title', esc(wa.page?.title || '—'))}
    ${fact('Enquiry form', wa.page ? (wa.page.forms || wa.contactPageForms ? 'Yes' : 'Not found') : '—')}${fact('WhatsApp', wa.page ? (wa.page.whatsapp ? 'Yes' : 'Not found') : '—')}${fact('Buttons like “Get a quote”', esc(wa.page?.ctas?.join(', ') || 'Not found'))}
    ${fact('Broken links', wa.brokenLinks ? `${wa.brokenLinks.broken.length} of ${wa.brokenLinks.checked}` : '—')}${fact('Sitemap', wa.sitemap == null ? '—' : wa.sitemap ? 'Found' : 'Not found')}${fact('Social links', Object.entries(wa.page?.social || {}).map(([k, u]) => link(u, k)).join(', ') || 'None')}</div>
    <div class="sec-t" style="margin:6px 0 0">Google speed test (mobile)</div>${wa.pagespeed?.status === 'Tested' ? `<div class="lf-facts">${fact('Performance', esc(wa.pagespeed.performance))}${fact('SEO', esc(wa.pagespeed.seo))}${fact('Accessibility', esc(wa.pagespeed.accessibility))}${fact('Best practices', esc(wa.pagespeed.bestPractices))}</div><p class="hint" style="margin:0">${esc(wa.pagespeed.source || '')} · ${esc(fmtDT(wa.pagespeed.testedAt))}</p>` : `<p class="hint" style="margin:0">${esc(wa.pagespeed?.status || 'Not tested')}${wa.pagespeed?.error ? ': ' + esc(wa.pagespeed.error) : ''}. No scores are shown for tests that didn’t run.</p>`}
    ${wa.page?.jsRendered ? '<p class="hint" style="margin:0">This site builds its content with JavaScript, so some page checks count only as possible issues.</p>' : ''}</div></details>` : ''}
   ${ra.status === 'Analysed' ? `<details class="lfx"><summary><span class="ms">reviews</span>Reviews<span class="ms chev">expand_more</span></summary><div class="in">
    <p class="hint" style="margin:0">${esc(ra.sampleNote)} ${esc(ra.authenticityNote)} Confidence: <b>${esc(ra.confidence)}</b>.</p>
    <div class="lf-facts">${fact('Customers like', esc(ra.positiveThemes.map(t => `${t.theme} (${t.count})`).join(', ') || 'Nothing stands out'))}${fact('Customers complain about', esc(ra.negativeThemes.map(t => `${t.theme} (${t.count})`).join(', ') || 'Nothing stands out'))}</div>
    ${(ra.opportunities || []).length ? ra.opportunities.map(o => `<div class="lf-note"><span class="ms">lightbulb</span><div>${esc(o)}</div></div>`).join('') : ''}
    ${(ra.items || []).map(r => `<div class="lf-quote"><span class="hint" style="margin:0">${esc(fmtD(r.date))} · ${esc(r.rating)}★ · ${esc(r.author)}</span><div>“${esc(r.excerpt)}”</div></div>`).join('')}</div></details>` : ''}
  </div>`;
  const b = dr.querySelector('.dr-b'); if (b && sc0) b.scrollTop = sc0;
  let cur = keepTab || 'email';
  const show = k => {
    cur = k; const txt = c.pitch[k]; $('#lfPitch').textContent = txt; $$('[data-pt]', dr).forEach(x => x.setAttribute('aria-pressed', x.dataset.pt === k));
    const m = $('#lfMail'); if (m) { const sub = (txt.match(/^Subject: (.*)$/m) || [])[1] || ''; m.href = `mailto:${encodeURIComponent(c.contact.email)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(txt.replace(/^Subject: .*\n+/, ''))}`; }
    const w = $('#lfWa'); if (w) w.href = `https://wa.me/${(c.contact.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(c.pitch.whatsapp || txt)}`;
  };
  if (pitches.length) { $$('[data-pt]', dr).forEach(x => x.onclick = () => show(x.dataset.pt)); show(pitches.some(([k]) => k === cur) ? cur : 'email'); }
  const evT = $('#evType'); const syncEv = () => { $('#evDateW').hidden = evT.value !== 'establishment'; }; evT.onchange = syncEv; syncEv();
  const reload = async () => { try { drawCompany(await api(qs('lf_company', { id: c.id })), cur); } catch (e) { fail(e); } };
  const patch = async body => { try { await api('lf_company_patch', { id: c.id, ...body }); ok('Saved.'); reload(); } catch (e) { fail(e); } };
  dr.onclick = async e => {
    const h = e.target.closest('[data-hqopen]'); if (h) { LF.openId = null; dr.classList.remove('lf-dr'); openDrawer(h.dataset.hqopen); return; }
    const el = e.target.closest('[data-lfact]'); if (!el) return; const k = el.dataset.lfact;
    if (k === 'copy') { try { await navigator.clipboard.writeText(c.pitch[cur]); ok('Copied.'); } catch { const r = document.createRange(); r.selectNodeContents($('#lfPitch')); getSelection().removeAllRanges(); getSelection().addRange(r); info('Selected. Press Ctrl+C to copy.'); } }
    else if (k === 'sent') {
      const log = force => api('lf_contact_log', { id: c.id, channel: cur, force });
      try { await log(false); ok('Recorded.' + (c.hq ? ' The pipeline card moved to Pitched.' : '')); sync(true, true); reload(); }
      catch (x) { if (x.code === 409 && /Already contacted/.test(x.message)) { if (await confirmBox('Contacted recently', x.message, 'Record anyway')) { await log(true).catch(fail); sync(true, true); reload(); } } else fail(x); }
    }
    else if (k === 'dnc') patch({ doNotContact: el.getAttribute('aria-checked') !== 'true' });
    else if (k === 'verify') patch({ contactVerified: true });
    else if (k === 'note') { const n = $('#lfNote').value.trim(); if (!n) return warn('Write a note first'); patch({ note: n }); }
    else if (k === 'pipe') { await toPipeline(c.id); reload(); }
    else if (k === 'refresh') { try { await api('lf_refresh', { ids: [c.id] }); LF.kick(); ok('Re-checking. Open it again in a minute to see the result.'); } catch (x) { fail(x); } }
    else if (k === 'delete') { if (!await confirmBox(`Delete ${c.name}?`, 'It’s removed from Lead Finder. A pipeline card, if any, stays. Daily backups keep a copy.', 'Delete', true)) return; try { await api('lf_company_delete', { id: c.id }); ok('Deleted.'); LF.close(); LF.refreshDash(); if (S.view.startsWith('lf-')) { render.full = true; render(); } } catch (x) { fail(x); } }
    else if (k === 'evidence') {
      try { await api('lf_evidence', { id: c.id, type: evT.value, date: $('#evDate').value, source: $('#evSrc').value, url: $('#evUrl').value }); ok('Saved. Re-checked with your evidence.'); sync(true, true); LF.refreshDash(); reload(); }
      catch (x) { fail(x); }
    }
  };
  dr.onkeydown = e => { const sw_ = e.target.closest('[data-lfact="dnc"]'); if (sw_ && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); sw_.click(); } };
  setTimeout(() => dr.querySelector('.dr-h .icon-btn')?.focus({ preventScroll: true }), 60);
}

/* ================= links into the rest of Canvass ================= */
LF.overviewCard = () => {
  if (!LF.dash || !S.live) return '';
  const t = LF.dash.totals, run = LF.jobs.find(running), waiting = all().filter(b => b.lfId && b.status === 'lead' && !b.ownerId);
  return `<section class="card lf-ovc" style="--i:1;margin-bottom:16px"><div class="card-h"><span class="lfb" style="width:30px;height:30px;border-radius:10px"><span class="ms">radar</span></span><h2>Lead Finder</h2><span class="grow"></span><button class="btn text sm rp" data-goto="lf-home">Open</button></div>
   <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
    <a class="row rp" href="#lf-leads/Qualified" style="background:var(--surface-2)"><span class="bizicon" style="--sc:var(--good)"><span class="ms">verified</span></span><span class="t"><b>${t.qualified} qualified</b><span>${t.highPriority} high priority</span></span></a>
    <a class="row rp" href="#pipeline" style="background:var(--surface-2)"><span class="bizicon" style="--sc:var(--accent)"><span class="ms">flag</span></span><span class="t"><b>${waiting.length} to claim</b><span>From Lead Finder, in Spotted</span></span></a>
    ${run ? `<a class="row rp" href="#${run.type === 'discovery' ? 'lf-find' : 'lf-home'}" style="background:var(--accent-c)"><span class="lfring" style="--p:${run.progress?.total ? Math.round(100 * run.progress.done / run.progress.total) : 5}"></span><span class="t"><b>Search running</b><span>${esc(jobLabel(run))}</span></span></a>`
      : `<a class="row rp" href="#lf-find" style="background:var(--surface-2)"><span class="bizicon" style="--sc:var(--accent)"><span class="ms">travel_explore</span></span><span class="t"><b>Find more</b><span>Search an area on Google</span></span></a>`}
   </div></section>`;
};
LF.bizBanner = b => `<div class="gl"><span class="lfb"><span class="ms">radar</span></span><div class="grow" style="font-size:13.5px"><b>Found by Lead Finder</b>${b.lfScore != null ? ` · score ${esc(b.lfScore)}/100` : ''}<br><span style="color:var(--muted)">Findings, pitches and sources are in the full report.</span></div><button class="btn tonal sm rp" data-lfopen="${esc(b.lfId)}"><span class="ms">description</span>Full report</button></div>`;
LF.paletteItems = q => {
  if (!q || !LF.names.length) return [];
  return LF.names.filter(c => [c.name, c.area, c.city, c.industry].join(' ').toLowerCase().includes(q)).slice(0, 5)
    .map(c => ({ run: () => { closePalette(); LF.open(c.id); }, h: `${ring(c.score, 'sm')}<span class="t"><b>${esc(c.name)}</b><span>${esc([c.industry, c.area || c.city].filter(Boolean).join(' · '))}</span></span>${cpill(c.category)}` }));
};
LF.quickCheck = async (d, hqId) => {
  try {
    const j = await api('lf_bulk', { rows: [['Company', 'Website', 'Phone', 'Google Maps link', 'Area', 'Address', 'Instagram'], [d.name || '', d.website || '', d.phone || '', d.mapsUrl || '', d.area || '', d.address || '', d.instagram || '']], fileName: 'Quick add: ' + (d.name || 'business'), quick: true, linkHq: hqId || null });
    LF.jobs.unshift(j); LF.kick();
  } catch (e) { fail(e); }
};

/* ---------- global wiring ---------- */
document.addEventListener('click', e => {
  const o = e.target.closest('[data-lfopen]'); if (o && !e.target.closest('a[target]')) { e.preventDefault(); e.stopPropagation(); LF.open(o.dataset.lfopen); }
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && LF.openId && !$('#modal').classList.contains('on') && !$('#palette').classList.contains('on')) { e.stopPropagation(); LF.close(); }
  if (e.key === 'Enter' && LF.openId === null) { const r = document.activeElement?.closest?.('tr[data-lfopen]'); if (r) LF.open(r.dataset.lfopen); }
}, true);
addEventListener('hashchange', () => { if (LF.openId) LF.close(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && LF.on) LF.loop(); });
bindRail();
})();
