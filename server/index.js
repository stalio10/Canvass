'use strict';
// Canvass Lead Finder ERP — local web server and REST API. Zero dependencies: run with `node server/index.js`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./lib/db');
const { publicSettings, applySettingsPatch, effectiveKey } = require('./lib/config');
const engine = require('./lib/engine');
const reports = require('./lib/reports');
const demo = require('./lib/demo');
const { nowIso, newId, isValidDate, normalizeUrl } = require('./lib/util');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.CANVASS_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';
const PIN = process.env.CANVASS_PIN || '';

const store = new Store(DATA_DIR);
const jobs = new engine.Jobs(store);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
async function readJson(req, limit = 25 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const ch of req) { size += ch.length; if (size > limit) throw new HttpError(413, 'Upload too large (25 MB maximum).'); chunks.push(ch); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
}
const need = (cond, msg, status = 400) => { if (!cond) throw new HttpError(status, msg); };
const getCompany = id => { const c = store.get(id); need(c, 'Company not found.', 404); return c; };

function summary(c) {
  return { id: c.id, name: c.name, demo: c.demo, industry: c.industryName || c.industry, city: c.city, area: c.area, country: c.country,
    category: c.validation?.category || 'Unprocessed', reasons: (c.validation?.reasons || []).slice(0, 3), score: c.score?.total ?? null, priority: c.score?.priority || '',
    website: c.contact?.website || '', websiteStatus: c.websiteStatus || '', phone: c.contact?.phone || '', email: c.contact?.email || '',
    activity: c.activity?.status || '', age: c.age?.status || '', ageWithin: c.age?.withinWindow ?? null, confirmedIssues: (c.issues || []).filter(i => i.status === 'Confirmed Issue').length,
    potentialIssues: (c.issues || []).filter(i => i.status !== 'Confirmed Issue').length, topIssues: (c.issues || []).filter(i => i.status === 'Confirmed Issue').slice(0, 3).map(i => i.title),
    services: (c.services || []).slice(0, 4).map(s => s.name), rating: c.google?.rating ?? null, reviews: c.google?.userRatingCount ?? null,
    pipeline: c.pipeline, lastVerifiedAt: c.lastVerifiedAt, source: c.source?.type };
}

const STAGES = ['New', 'Contacted', 'Follow-up', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, version: require('../package.json').version, time: nowIso(), placesKey: !!effectiveKey(store.settings, 'googlePlacesKey'), pageSpeedKey: !!effectiveKey(store.settings, 'pageSpeedKey'), demoMode: store.settings.demoMode })],
  ['GET', /^\/api\/settings$/, () => publicSettings(store.settings)],
  ['PUT', /^\/api\/settings$/, async req => { store.state.settings = applySettingsPatch(store.settings, await readJson(req)); store.flush(); return publicSettings(store.settings); }],
  ['GET', /^\/api\/dashboard$/, () => reports.dashboard(store)],
  ['GET', /^\/api\/companies$/, (req, m, q) => {
    let list = store.allCompanies();
    const cat = q.get('category'); if (cat && cat !== 'all') list = list.filter(c => (c.validation?.category || 'Unprocessed') === cat);
    if (q.get('pipeline') === '1') list = list.filter(c => c.pipeline?.inPipeline);
    const ind = q.get('industry'); if (ind) list = list.filter(c => c.industryId === ind || c.industryName === ind);
    const pr = q.get('priority'); if (pr) list = list.filter(c => c.score?.priority === pr);
    const city = q.get('city'); if (city) list = list.filter(c => (c.city || '').toLowerCase() === city.toLowerCase());
    const text = (q.get('q') || '').toLowerCase().trim();
    if (text) list = list.filter(c => [c.name, c.contact?.website, c.city, c.area, c.industryName, c.contact?.phone, c.contact?.email].join(' ').toLowerCase().includes(text));
    const sort = q.get('sort') || 'score';
    list.sort(sort === 'recent' ? (a, b) => String(b.updatedAt).localeCompare(a.updatedAt) : sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1));
    const page = Math.max(0, Number(q.get('page')) || 0), size = Math.min(200, Number(q.get('size')) || 50);
    return { total: list.length, page, size, items: list.slice(page * size, (page + 1) * size).map(summary) };
  }],
  ['GET', /^\/api\/companies\/([\w-]+)$/, (req, m) => getCompany(m[1])],
  ['PATCH', /^\/api\/companies\/([\w-]+)$/, async (req, m) => {
    const c = getCompany(m[1]), b = await readJson(req), p = c.pipeline;
    if (b.stage !== undefined) { need(STAGES.includes(b.stage), 'Unknown stage.'); if (b.stage !== p.stage) { p.history.push({ at: nowIso(), event: `Stage: ${p.stage || '—'} → ${b.stage}`, stage: b.stage }); p.stage = b.stage; } if (!p.inPipeline) { need(c.validation?.category === 'Qualified', 'Only qualified leads can enter the sales pipeline.'); p.inPipeline = true; p.transferredAt = nowIso(); } }
    if (b.assignedTo !== undefined) { p.assignedTo = String(b.assignedTo).slice(0, 60); p.history.push({ at: nowIso(), event: 'Assigned to ' + (p.assignedTo || 'nobody') }); }
    if (b.followUpDate !== undefined) { need(!b.followUpDate || isValidDate(b.followUpDate), 'Invalid follow-up date.'); p.followUpDate = b.followUpDate; p.history.push({ at: nowIso(), event: 'Follow-up set: ' + (b.followUpDate || 'cleared') }); }
    if (b.note) { p.notes.push({ at: nowIso(), text: String(b.note).slice(0, 2000) }); p.history.push({ at: nowIso(), event: 'Note added' }); }
    if (typeof b.doNotContact === 'boolean') { p.doNotContact = b.doNotContact; p.history.push({ at: nowIso(), event: b.doNotContact ? 'Marked do-not-contact' : 'Do-not-contact removed' }); }
    if (b.contactVerified === true) { c.contactVerifiedAt = nowIso(); p.history.push({ at: nowIso(), event: 'Contact details confirmed independently by the team' }); }
    return store.put(c);
  }],
  ['DELETE', /^\/api\/companies\/([\w-]+)$/, (req, m) => ({ deleted: store.remove(m[1]) })],
  ['POST', /^\/api\/companies\/([\w-]+)\/evidence$/, async (req, m) => {
    const c = getCompany(m[1]), b = await readJson(req);
    const source = String(b.source || '').trim(); need(source.length >= 3, 'Add the evidence source (e.g. "DED trade licence 123456" or a link).');
    if (b.type === 'establishment') { need(isValidDate(b.date) && new Date(b.date) <= new Date(), 'Enter a valid establishment date.'); c.manual.establishment = { date: new Date(b.date).toISOString().slice(0, 10), source, url: normalizeUrl(b.url) || '', enteredAt: nowIso(), by: 'Team' }; }
    else if (b.type === 'activity') c.manual.activity.push({ label: String(b.label || 'Recent activity verified by team').slice(0, 200), source, url: normalizeUrl(b.url) || '', enteredAt: nowIso(), recent: true });
    else if (b.type === 'no-website') { c.manual.noWebsiteConfirmed = true; c.manual.noWebsiteNote = source; c.manual.noWebsiteAt = nowIso(); }
    else if (b.type === 'identity') c.manualIdentity = { source, url: normalizeUrl(b.url) || '', at: nowIso() };
    else if (b.type === 'invalid') c.invalid = source;
    else throw new HttpError(400, 'Unknown evidence type.');
    await engine.processCompany(c, { settings: store.settings, offline: true });
    return store.put(c);
  }],
  ['POST', /^\/api\/companies\/([\w-]+)\/contact-log$/, async (req, m) => {
    const c = getCompany(m[1]), b = await readJson(req), p = c.pipeline;
    const channel = String(b.channel || ''); need(['email', 'whatsapp', 'call', 'proposal', 'auditOffer'].includes(channel), 'Unknown channel.');
    need(!p.doNotContact, 'This company asked not to be contacted.', 409);
    const last = [...p.contactLog].reverse().find(l => l.channel === channel);
    const days = store.settings.contactCooldownDays;
    if (last && !b.force && (Date.now() - new Date(last.at)) / 86400000 < days) throw new HttpError(409, `Already contacted by ${channel} on ${last.at.slice(0, 10)}. Wait ${days} days or confirm to log again.`);
    p.contactLog.push({ at: nowIso(), channel, note: String(b.note || '').slice(0, 500) });
    p.history.push({ at: nowIso(), event: `Contacted by ${channel} (sent manually)` });
    if (p.stage === 'New') { p.stage = 'Contacted'; p.history.push({ at: nowIso(), event: 'Stage: New → Contacted', stage: 'Contacted' }); }
    return store.put(c);
  }],
  ['POST', /^\/api\/companies\/([\w-]+)\/refresh$/, (req, m) => { getCompany(m[1]); return engine.startRefresh(store, jobs, [m[1]]); }],
  ['POST', /^\/api\/refresh$/, async req => { const b = await readJson(req); const ids = (b.ids || []).filter(id => store.get(id)); need(ids.length, 'No companies selected.'); return engine.startRefresh(store, jobs, ids.slice(0, 500)); }],
  ['POST', /^\/api\/discover$/, async req => engine.startDiscovery(store, jobs, await readJson(req))],
  ['POST', /^\/api\/bulk$/, async req => engine.startBulk(store, jobs, await readJson(req))],
  ['POST', /^\/api\/bulk\/legacy$/, async () => engine.startBulk(store, jobs, { rows: engine.legacyRows(ROOT), fileName: 'Legacy Canvass list (102 records)', legacy: true })],
  ['GET', /^\/api\/jobs$/, () => jobs.list().slice(0, 50).map(j => ({ ...j, log: undefined }))],
  ['GET', /^\/api\/jobs\/([\w-]+)$/, (req, m) => { const j = jobs.get(m[1]); need(j, 'Job not found.', 404); return j; }],
  ['POST', /^\/api\/jobs\/([\w-]+)\/cancel$/, (req, m) => ({ cancelled: jobs.cancel(m[1]) })],
  ['GET', /^\/api\/history$/, () => ({ searches: store.state.searches.slice(0, 200), duplicates: store.state.duplicates.slice(0, 300) })],
  ['GET', /^\/api\/usage$/, () => ({ days: store.usageSummary(60), costPer1000: store.settings.costPer1000, note: 'Estimated from request counts and the prices in Settings. Check your Google Cloud billing for actual charges.' })],
  ['GET', /^\/api\/export$/, (req, m, q) => {
    const t = reports.exportTable(store, q.get('dataset') || 'qualified');
    if (q.get('format') === 'csv') return { raw: reports.toCsv(t), type: 'text/csv; charset=utf-8', file: `canvass-${q.get('dataset') || 'qualified'}-${nowIso().slice(0, 10)}.csv` };
    return t;
  }],
  ['GET', /^\/api\/backup$/, () => ({ raw: JSON.stringify(store.exportForBackup(), null, 1), type: 'application/json', file: `canvass-backup-${nowIso().slice(0, 10)}.json` })],
  ['POST', /^\/api\/backup$/, () => ({ created: store.backup('manual') })],
  ['GET', /^\/api\/backups$/, () => store.listBackups()],
  ['POST', /^\/api\/backups\/([\w.-]+)\/restore$/, (req, m) => ({ restored: store.restore(store.readBackup(m[1])) })],
  ['POST', /^\/api\/restore$/, async req => { const b = await readJson(req); need(b && b.companies, 'This is not a Canvass backup file.'); return { restored: store.restore(b) }; }],
  ['POST', /^\/api\/demo\/load$/, async () => { store.settings.demoMode = true; const n = await demo.loadDemo(store); store.flush(); return { loaded: n }; }],
  ['POST', /^\/api\/demo\/clear$/, () => { const n = demo.clearDemo(store); store.settings.demoMode = false; store.flush(); return { removed: n }; }],
  ['GET', /^\/api\/schedules$/, () => store.settings.schedules],
  ['POST', /^\/api\/schedules$/, async req => {
    const b = await readJson(req); need(b.params?.city && b.params?.industryId, 'Choose a city and industry for the schedule.');
    const sch = { id: newId('sch'), name: String(b.name || `${b.params.category || b.params.industryId} in ${b.params.city}`).slice(0, 80), params: b.params, everyHours: Math.max(24, Number(b.everyHours) || 168), enabled: true, createdAt: nowIso() };
    store.settings.schedules.push(sch); store.flush(); return sch;
  }],
  ['DELETE', /^\/api\/schedules\/([\w-]+)$/, (req, m) => { store.settings.schedules = store.settings.schedules.filter(s => s.id !== m[1]); store.flush(); return { ok: true }; }]
];

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) {
    if (PIN && req.headers['x-canvass-pin'] !== PIN) return send(res, 401, { error: 'Enter the access PIN.' });
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'canvass') return send(res, 403, { error: 'Request blocked.' }); // stops cross-site form posts
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (!m || method !== req.method) continue;
      try {
        const out = await fn(req, m, url.searchParams);
        if (out && out.raw !== undefined) return send(res, 200, out.raw, { 'content-type': out.type, 'content-disposition': `attachment; filename="${out.file}"` });
        return send(res, 200, out);
      } catch (e) {
        const status = e.status || (/not configured|Choose|No companies|Add a Google/i.test(e.message) ? 400 : 500);
        if (status === 500) console.error(e);
        return send(res, status, { error: e.message });
      }
    }
    return send(res, 404, { error: 'Unknown API route.' });
  }
  // static files
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    'cache-control': /\.(js|css|svg)$/.test(file) ? 'no-cache' : 'no-store' });
  fs.createReadStream(file).pipe(res);
}

if (require.main === module) {
  const server = http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { error: 'Server error' }); }));
  server.listen(PORT, HOST, () => {
    console.log(`\n  CANVASS Lead Finder ERP running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  Data folder: ${DATA_DIR}`);
    if (HOST !== '127.0.0.1') console.log(PIN ? '  Network access enabled with PIN.' : '  WARNING: network access enabled without a PIN. Set CANVASS_PIN to protect it.');
    console.log('  Press Ctrl+C to stop.\n');
  });
  engine.startScheduler(store, jobs);
  const shutdown = () => { try { store.flush(); } finally { process.exit(0); } };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

module.exports = { handle, store, jobs };
