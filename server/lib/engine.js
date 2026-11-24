'use strict';
// Orchestration: discover → verify → audit → validate → score → pitch → pipeline. Same engine for both lead finder modules.
const fs = require('node:fs');
const path = require('node:path');
const { newId, nowIso, normalizeUrl, domainOf, registrableDomain, isSocialOrPlatformUrl, normName, nameSimilarity, httpFetch, sleep } = require('./util');
const places = require('./places');
const verify = require('./verify');
const { auditWebsite } = require('./website-audit');
const { auditGbp, analyzeReviews } = require('./gbp-audit');
const { validate, score, recommendServices } = require('./scoring');
const { generatePitches } = require('./pitch');
const { effectiveKey } = require('./config');

const REGION = { 'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA', ksa: 'SA', qatar: 'QA', oman: 'OM', bahrain: 'BH', kuwait: 'KW', india: 'IN', 'united kingdom': 'GB', uk: 'GB', 'united states': 'US', usa: 'US', egypt: 'EG', jordan: 'JO', pakistan: 'PK' };
const regionCode = country => REGION[String(country || '').trim().toLowerCase()] || undefined;

function newRecord(base) {
  return { id: newId(), createdAt: nowIso(), updatedAt: nowIso(), name: base.name || 'Unnamed business', demo: !!base.demo,
    industryId: base.industryId || '', industryName: base.industryName || '', industry: base.industry || '', category: base.category || '',
    country: base.country || '', city: base.city || '', area: base.area || '',
    source: base.source || { type: 'manual' }, contact: {}, contactSources: {}, social: {}, manual: { activity: [] },
    google: null, website: null, issues: [], services: [], auditHistory: [],
    pipeline: { inPipeline: false, stage: '', assignedTo: '', followUpDate: '', notes: [], history: [], contactLog: [], doNotContact: false } };
}

function setContact(c, field, value, source) {
  if (!value) return;
  if (!c.contact[field] || c.contactSources[field] === source || String(c.contactSources[field] || '').startsWith('Google') && !String(source).startsWith('Google')) {
    c.contact[field] = String(value).trim(); c.contactSources[field] = source;
  }
}

function mergeGoogle(c, g) {
  c.google = g;
  if (!c.name || c.name === 'Unnamed business' || c.source?.type === 'google') c.name = g.displayName || c.name;
  setContact(c, 'phone', g.internationalPhoneNumber || g.nationalPhoneNumber, 'Google Places');
  setContact(c, 'address', g.formattedAddress, 'Google Places');
  if (g.websiteUri && !isSocialOrPlatformUrl(g.websiteUri)) setContact(c, 'website', g.websiteUri, 'Google Places');
  else if (g.websiteUri) { const d = domainOf(g.websiteUri); c.social[d.split('.')[0]] = g.websiteUri; }
  if (g.googleMapsUri) { c.contact.mapsUrl = g.googleMapsUri; c.contactSources.mapsUrl = 'Google Places'; }
  if (g.location) {
    c.contact.directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.name + ' ' + (g.formattedAddress || ''))}&destination_place_id=${encodeURIComponent(g.placeId)}`;
    c.contactSources.directionsUrl = 'Google Places';
  }
}

/** Run every check for one company and store the result. Network steps are skipped when a mandatory rule already rejects it. */
async function processCompany(c, ctx) {
  const { settings } = ctx;
  const keys = { places: effectiveKey(settings, 'googlePlacesKey'), pagespeed: effectiveKey(settings, 'pageSpeedKey') };
  const step = msg => ctx.log && ctx.log(`${c.name}: ${msg}`);
  // 1. Google profile
  if (!ctx.offline && c.google?.placeId && keys.places && (ctx.refreshGoogle || !c.google.fetchedAt || c.google.expired)) {
    try { mergeGoogle(c, places.toGoogleBlock(await places.placeDetails(keys.places, c.google.placeId))); step('Google profile refreshed'); }
    catch (e) { step('Google profile refresh failed: ' + e.message); c.errors = [...(c.errors || []), { at: nowIso(), step: 'google', message: e.message }].slice(-10); }
  }
  // 2. Fast checks from listing data
  c.activity = verify.assessActivity({ google: c.google, websiteAudit: null, manualActivity: c.manual.activity }, settings);
  c.industryCheck = verify.assessIndustry({ industryId: c.industryId, category: c.category, google: c.google, name: c.name, uploadIndustry: c.industry }, settings.industries);
  c.locationCheck = verify.assessLocation({ google: c.google, address: c.contact.address, country: c.country, city: c.city, area: c.area });
  c.sizeCheck = verify.assessSize({ google: c.google, name: c.name }, settings, ctx.chainCounts || {});
  const earlyReject = ['Closed permanently', 'Closed temporarily'].includes(c.activity.status) || c.industryCheck.status === 'Irrelevant' || c.locationCheck.status === 'Out of location' || c.sizeCheck.status === 'Large' || !!c.duplicateOf;
  // 3. Website
  const siteUrl = normalizeUrl(c.contact.website);
  if (ctx.offline && siteUrl && c.websiteAudit) {
    c.website ||= { url: siteUrl, domain: domainOf(siteUrl) };
    c.websiteStatus = c.websiteAudit.availability?.ok ? 'Working' : 'Not loading';
  } else if (siteUrl && !earlyReject && !ctx.offline) {
    step('auditing website');
    c.websiteAudit = await auditWebsite(siteUrl, { pageSpeedKey: keys.pagespeed, runPageSpeedTest: settings.runPageSpeed && !ctx.skipPageSpeed, brokenLinkSample: settings.brokenLinkSample, city: c.city, industryId: c.industryId });
    c.website = { url: c.websiteAudit.finalUrl || siteUrl, domain: domainOf(c.websiteAudit.finalUrl || siteUrl) };
    c.websiteStatus = c.websiteAudit.availability.ok ? 'Working' : 'Not loading';
    for (const e of c.websiteAudit.page?.emails || []) { setContact(c, 'email', e, 'Website: ' + c.website.domain); break; }
    for (const [k, v] of Object.entries(c.websiteAudit.page?.social || {})) c.social[k] ||= v;
  } else if (siteUrl) {
    c.website = { url: siteUrl, domain: domainOf(siteUrl) }; c.websiteStatus = 'Not checked';
  } else {
    c.website = null; c.websiteAudit = null;
    c.websiteStatus = c.manual.noWebsiteConfirmed ? 'Confirmed none' : 'Not found';
  }
  // 4. Age
  if (!earlyReject && !ctx.offline) {
    const domain = c.website?.domain;
    const fresh = x => x && (Date.now() - new Date(x.checkedAt)) / 86400000 < 30;
    if (domain) {
      if (!fresh(c.ageSources?.rdap) || c.ageSources?.rdap?.domain !== registrableDomain(domain)) { step('checking domain registration'); c.ageSources = { ...(c.ageSources || {}), rdap: await verify.rdapRegistration(domain) }; }
      if (!fresh(c.ageSources?.wayback) || c.ageSources?.waybackDomain !== domain) { step('checking website history'); c.ageSources = { ...c.ageSources, wayback: await verify.waybackFirstCapture(domain), waybackDomain: domain }; }
    }
  }
  c.age = verify.assessAge({ manual: c.manual.establishment, rdap: c.ageSources?.rdap, wayback: c.ageSources?.wayback, reviews: c.google?.reviews || [], hasWebsite: !!c.website }, settings);
  // 5. Activity again, now including the website result
  c.activity = verify.assessActivity({ google: c.google, websiteAudit: c.websiteAudit, manualActivity: c.manual.activity }, settings);
  // 6. Google Business + reviews
  c.reviewAnalysis = analyzeReviews(c.google, settings);
  c.gbpAudit = auditGbp(c.google, { industryId: c.industryId, websiteKnown: !!c.website && c.websiteStatus === 'Working', websiteUrl: c.website?.url, reviewAnalysis: c.reviewAnalysis }, settings);
  // 7. Issues, services, validation, score, pitch
  const issues = [...(c.gbpAudit.issues || []), ...(c.websiteAudit?.issues || [])];
  if (c.websiteStatus === 'Not found' && !issues.some(i => i.id === 'gbp-no-website'))
    issues.push({ id: 'no-website-found', area: 'website', status: 'Potential Improvement', title: 'No website found', detail: 'No website in the uploaded data or Google profile. Not proof that none exists.', services: ['Website design', 'Website development'], evidence: 'Checked sources', checkedAt: nowIso() });
  if (c.websiteStatus === 'Confirmed none')
    issues.push({ id: 'no-website-confirmed', area: 'website', status: 'Confirmed Issue', title: 'Business has no website', detail: c.manual.noWebsiteNote || 'Confirmed by the team.', services: ['Website design', 'Website development', 'Branding'], evidence: 'Team verification', checkedAt: c.manual.noWebsiteAt });
  c.issues = issues;
  c.services = recommendServices(c, settings);
  c.validation = validate(c, settings);
  c.score = score(c, settings);
  c.pitch = generatePitches(c, settings);
  c.lastVerifiedAt = nowIso();
  c.partial = earlyReject;
  // 8. Pipeline transfer (qualified only). Existing pipeline work is never discarded.
  if (c.validation.category === 'Qualified' && !c.pipeline.inPipeline) {
    c.pipeline.inPipeline = true; c.pipeline.stage = 'New'; c.pipeline.transferredAt = nowIso();
    c.pipeline.history.push({ at: nowIso(), event: 'Transferred to sales pipeline after validation', stage: 'New' });
  }
  c.pipeline.validationWarning = c.pipeline.inPipeline && c.validation.category !== 'Qualified' ? `Latest validation: ${c.validation.category}` : '';
  c.auditHistory = [...(c.auditHistory || []), { at: nowIso(), category: c.validation.category, score: c.score.total, issues: c.issues.length }].slice(-20);
  step(`${c.validation.category} · score ${c.score.total}`);
  return c;
}

// ---------------- jobs ----------------
class Jobs {
  constructor(store) { this.store = store; this.queue = []; this.running = null; this.live = new Map(); }
  list() { return this.store.state.jobs.map(j => this.live.get(j.id) || j); }
  get(id) { return this.live.get(id) || this.store.state.jobs.find(j => j.id === id) || null; }
  enqueue(type, params, run) {
    const job = { id: newId('job'), type, params, status: 'queued', createdAt: nowIso(), progress: { done: 0, total: 0, phase: 'Queued' }, counts: {}, log: [] };
    this.live.set(job.id, job); this.store.upsertJob(job);
    this.queue.push({ job, run }); this.pump();
    return job;
  }
  cancel(id) { const j = this.live.get(id); if (!j) return false; j.cancelRequested = true; if (j.status === 'queued') { j.status = 'cancelled'; this.queue = this.queue.filter(q => q.job.id !== id); this.store.upsertJob(j); } return true; }
  async pump() {
    if (this.running || !this.queue.length) return;
    const { job, run } = this.queue.shift();
    this.running = job; job.status = 'running'; job.startedAt = nowIso();
    const log = m => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (job.log.length > 400) job.log.shift(); };
    try { await run(job, log); job.status = job.cancelRequested ? 'cancelled' : 'done'; }
    catch (e) { job.status = 'failed'; job.error = e.message; log('Stopped: ' + e.message); }
    job.finishedAt = nowIso(); job.progress.phase = job.status;
    this.store.upsertJob(job); this.live.delete(job.id); this.running = null;
    this.store.save(); setImmediate(() => this.pump());
  }
}

async function pool(items, size, fn, shouldStop) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, size) }, async () => { while (i < items.length && !shouldStop()) { const it = items[i++]; await fn(it); } });
  await Promise.all(workers);
}

function tally(job, c) { const k = c.validation?.category || 'Unprocessed'; job.counts[k] = (job.counts[k] || 0) + 1; }

// ---------------- Module A: Google automatic lead finder ----------------
function discoveryQueries(p, industries) {
  const ind = industries.find(i => i.id === p.industryId);
  const terms = [p.category, ...(p.category ? [] : [ind?.name, ...(ind?.keywords || []).slice(0, 4)])].filter(Boolean);
  const where = [p.area, p.city, p.country].filter(Boolean).join(', ');
  return [...new Set(terms.map(t => `${t} in ${where}`))];
}

function startDiscovery(store, jobs, params) {
  const s = store.settings;
  const p = { country: String(params.country || s.defaultCountry).trim(), city: String(params.city || '').trim(), area: String(params.area || '').trim(),
    industryId: String(params.industryId || ''), category: String(params.category || '').trim(), count: Math.max(1, Math.min(200, Number(params.count) || 10)), scheduleId: params.scheduleId };
  if (!p.city) throw new Error('Choose a city.');
  if (!p.industryId) throw new Error('Choose an industry.');
  if (!effectiveKey(s, 'googlePlacesKey')) throw new Error('Add a Google Places API key in Settings to use automatic discovery. Bulk Upload works without it.');
  const budget = store.budgetStatus();
  if (budget.enabled && (budget.remaining <= 0 || budget.dayRemaining <= 0)) throw new Error(`Google Places free-tier limit reached (${budget.used}/${budget.limit} this month, ${budget.dayUsed}/${budget.dayLimit} today). No requests were made.`);
  const ind = s.industries.find(i => i.id === p.industryId);
  return jobs.enqueue('discovery', p, async (job, log) => {
    const key = effectiveKey(store.settings, 'googlePlacesKey');
    const maxCandidates = Math.min(store.settings.maxCandidatesPerSearch, Math.max(p.count * 6, 20));
    const search = { id: job.id, at: nowIso(), type: 'Google discovery', params: p, status: 'running' };
    job.progress.phase = 'Searching Google Places';
    const found = new Map();
    for (const q of discoveryQueries(p, store.settings.industries)) {
      let token = '';
      for (let page = 0; page < 3 && found.size < maxCandidates && !job.cancelRequested; page++) {
        log(`Search "${q}" page ${page + 1}`);
        let r;
        try { r = await places.textSearch(key, { textQuery: q, pageToken: token, pageSize: 20, regionCode: regionCode(p.country) }); }
        catch (e) { if (e.code !== 'BUDGET') throw e; log(e.message); job.budgetStopped = e.message; break; }
        for (const pl of r.places) if (!found.has(pl.id) && found.size < maxCandidates) found.set(pl.id, pl);
        token = r.nextPageToken; job.progress.total = found.size;
        if (!token) break;
        await sleep(300);
      }
      if (found.size >= maxCandidates || job.cancelRequested || job.budgetStopped) break;
    }
    if (job.budgetStopped && !found.size) throw new Error(job.budgetStopped);
    log(`${found.size} candidate businesses found`);
    const chainCounts = {};
    for (const pl of found.values()) { const n = normName(pl.displayName?.text); chainCounts[n] = (chainCounts[n] || 0) + 1; }
    const candidates = [...found.values()];
    job.progress = { done: 0, total: candidates.length, phase: 'Verifying and auditing' };
    let qualified = 0;
    await pool(candidates, store.settings.concurrency, async pl => {
      const g = places.toGoogleBlock(pl);
      const c = newRecord({ name: g.displayName, industryId: p.industryId, industryName: ind?.name, category: p.category, country: p.country, city: p.city, area: p.area,
        source: { type: 'google', detail: `Google Places search: ${p.category || ind?.name} in ${[p.area, p.city].filter(Boolean).join(', ')}`, searchId: job.id, at: nowIso() } });
      mergeGoogle(c, g);
      const dup = store.findDuplicate(c);
      if (dup) { store.logDuplicate({ name: c.name, matchedId: dup.match.id, matchedName: dup.match.name, by: dup.by, source: 'Google discovery', jobId: job.id }); job.counts.Duplicates = (job.counts.Duplicates || 0) + 1; log(`${c.name}: duplicate of existing record (${dup.by}) — skipped`); }
      else {
        await processCompany(c, { settings: store.settings, chainCounts, log });
        store.put(c); tally(job, c);
        if (c.validation.category === 'Qualified') qualified++;
      }
      job.progress.done++;
      if (qualified >= p.count && !job.cancelRequested) { job.cancelRequested = true; job.reachedTarget = true; log(`Target of ${p.count} qualified leads reached`); }
    }, () => job.cancelRequested);
    if (job.reachedTarget) job.cancelRequested = false;
    if (job.budgetStopped) job.note = 'Stopped early: ' + job.budgetStopped;
    store.addSearch({ ...search, status: 'done', finishedAt: nowIso(), candidates: candidates.length, processed: job.progress.done, counts: job.counts });
    log('Finished');
  });
}

// ---------------- Module B: bulk lead finder ----------------
const FIELD_ALIASES = {
  name: ['company', 'companyname', 'business', 'businessname', 'name', 'tradename', 'organisation', 'organization'],
  website: ['website', 'websiteurl', 'url', 'site', 'domain', 'web', 'websitelink', 'link'],
  phone: ['phone', 'phonenumber', 'telephone', 'mobile', 'contactnumber', 'tel'],
  email: ['email', 'emailaddress', 'companyemail', 'contactemail'],
  address: ['address', 'businessaddress', 'location', 'fulladdress'],
  city: ['city', 'emirate', 'town'], area: ['area', 'district', 'neighbourhood', 'neighborhood'], country: ['country'],
  industry: ['industry', 'category', 'sector', 'businesscategory', 'businesstype'],
  mapsLink: ['googlemapslink', 'mapslink', 'googlemaps', 'mapsurl', 'gmb', 'googlebusiness', 'maplink'],
  instagram: ['instagram', 'instagramurl'], linkedin: ['linkedin', 'linkedinurl'], facebook: ['facebook', 'facebookurl'],
  establishedDate: ['establisheddate', 'establishmentdate', 'founded', 'foundeddate', 'licenseissuedate', 'licenceissuedate', 'registrationdate', 'incorporationdate'],
  establishedSource: ['establishedsource', 'licensesource', 'registrationsource']
};

/** Turn uploaded table rows or pasted lines into normalised rows. Pure (unit-tested). */
function normalizeBulkInput({ rows, text }) {
  const out = [];
  if (Array.isArray(rows) && rows.length) {
    const header = rows[0].map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const known = Object.values(FIELD_ALIASES).some(list => header.some(h => list.includes(h)));
    const body = known ? rows.slice(1) : rows;
    for (const r of body) {
      if (!r || !r.some(v => String(v ?? '').trim())) continue;
      const row = {};
      if (known) for (const [field, aliases] of Object.entries(FIELD_ALIASES)) { const i = header.findIndex(h => aliases.includes(h)); if (i >= 0 && String(r[i] ?? '').trim()) row[field] = String(r[i]).trim(); }
      else Object.assign(row, classifyLine(String(r.find(v => String(v ?? '').trim()) || '')));
      if (row.website && places.isMapsLink(row.website)) { row.mapsLink = row.website; delete row.website; }
      if (row.name || row.website || row.mapsLink) out.push(row);
    }
  }
  if (text) for (const line of String(text).split(/\r?\n/)) { const l = line.trim(); if (l) out.push(classifyLine(l)); }
  return out.slice(0, 2000);
}
function classifyLine(l) {
  if (places.isMapsLink(l)) return { mapsLink: /^https?:/i.test(l) ? l : 'https://' + l };
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(l)) return isSocialOrPlatformUrl(l) ? { name: '', instagram: l } : { website: l };
  return { name: l };
}

async function resolveGoogle(row, key, p, log) {
  if (!key) return null;
  try {
    if (row.mapsLink) {
      let link = row.mapsLink;
      if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(link)) { const r = await httpFetch(link, { api: 'website', guard: true, timeoutMs: 15000, retries: 1 }); link = r.finalUrl; try { await r.body?.cancel(); } catch { /* ignore */ } }
      const ref = places.parseMapsLink(link);
      if (ref.placeId) return places.toGoogleBlock(await places.placeDetails(key, ref.placeId));
      if (ref.name) row.name ||= ref.name;
    }
    const where = [row.city || p.city, row.country || p.country].filter(Boolean).join(', ');
    const domain = domainOf(row.website);
    const query = row.name ? `${row.name}${where ? ' ' + where : ''}` : domain;
    if (!query) return null;
    const r = await places.textSearch(key, { textQuery: query, pageSize: 5, regionCode: regionCode(row.country || p.country) });
    const best = r.places.map(pl => ({ pl, sim: row.name ? nameSimilarity(row.name, pl.displayName?.text) : 0, dom: domain && domainOf(pl.websiteUri) === domain }))
      .filter(x => x.dom || x.sim >= 0.6).sort((a, b) => (b.dom - a.dom) || (b.sim - a.sim))[0];
    if (!best) { log(`${row.name || domain}: no confident Google Business match`); return null; }
    return places.toGoogleBlock(best.pl);
  } catch (e) { log(`${row.name || row.website || 'row'}: Google lookup failed — ${e.message}`); return null; }
}

function startBulk(store, jobs, params) {
  const s = store.settings;
  const rows = normalizeBulkInput({ rows: params.rows, text: params.text });
  if (!rows.length) throw new Error('No companies found in the upload. Include a company name, website or Google Maps link column.');
  const p = { country: String(params.country || '').trim(), city: String(params.city || '').trim(), industryId: String(params.industryId || ''), fileName: String(params.fileName || 'Pasted list').slice(0, 120), rows: rows.length, legacy: !!params.legacy };
  const ind = s.industries.find(i => i.id === p.industryId);
  return jobs.enqueue('bulk', p, async (job, log) => {
    const key = effectiveKey(store.settings, 'googlePlacesKey');
    if (!key) log('No Google Places key — Google Business checks are skipped; affected companies will stay Unverified.');
    job.progress = { done: 0, total: rows.length, phase: 'Processing upload' };
    const chainCounts = {};
    for (const r of rows) { const n = normName(r.name); if (n) chainCounts[n] = (chainCounts[n] || 0) + 1; }
    // De-duplicate inside the upload first (rows run in parallel, so the database check alone could miss same-file repeats).
    const seen = new Map(), unique = [];
    for (const r of rows) {
      const d = domainOf(r.website), n = normName(r.name).replace(/ /g, ''), keys = [d && 'd:' + d, d && 'n:' + d.split('.')[0].replace(/[^a-z0-9]/g, ''), n.length >= 5 && 'n:' + n, r.mapsLink && 'm:' + r.mapsLink].filter(Boolean);
      const hit = keys.map(k => seen.get(k)).find(Boolean);
      if (hit) { store.logDuplicate({ name: r.name || d || r.mapsLink, matchedId: '', matchedName: hit, by: 'repeated in the same upload', source: p.fileName, jobId: job.id }); job.counts.Duplicates = (job.counts.Duplicates || 0) + 1; continue; }
      keys.forEach(k => seen.set(k, r.name || d || r.mapsLink)); unique.push(r);
    }
    job.progress.total = unique.length;
    await pool(unique, store.settings.concurrency, async row => {
      const google = await resolveGoogle(row, key, p, log);
      const c = newRecord({ name: row.name || google?.displayName || domainOf(row.website) || 'Unnamed business', industryId: p.industryId, industryName: ind?.name, industry: row.industry || '',
        country: row.country || p.country, city: row.city || p.city, area: row.area || '', source: { type: p.legacy ? 'legacy' : 'bulk', detail: p.fileName, searchId: job.id, at: nowIso() } });
      const src = 'Upload: ' + p.fileName;
      if (row.website && !isSocialOrPlatformUrl(row.website)) setContact(c, 'website', normalizeUrl(row.website), src);
      setContact(c, 'phone', row.phone, src); setContact(c, 'email', row.email, src); setContact(c, 'address', row.address, src);
      for (const k of ['instagram', 'linkedin', 'facebook']) if (row[k]) c.social[k] = row[k];
      if (row.establishedDate && !Number.isNaN(new Date(row.establishedDate).getTime()) && row.establishedSource)
        c.manual.establishment = { date: new Date(row.establishedDate).toISOString().slice(0, 10), source: row.establishedSource, enteredAt: nowIso(), by: 'Upload' };
      if (google) mergeGoogle(c, google);
      if (!c.google) c.google = null;
      const dup = store.findDuplicate(c);
      if (dup) { store.logDuplicate({ name: c.name, matchedId: dup.match.id, matchedName: dup.match.name, by: dup.by, source: p.fileName, jobId: job.id }); job.counts.Duplicates = (job.counts.Duplicates || 0) + 1; log(`${c.name}: duplicate (${dup.by}) — skipped`); }
      else { await processCompany(c, { settings: store.settings, chainCounts, log }); store.put(c); tally(job, c); }
      job.progress.done++;
    }, () => job.cancelRequested);
    store.addSearch({ id: job.id, at: job.startedAt, type: p.legacy ? 'Legacy import' : 'Bulk upload', params: { ...p }, status: 'done', finishedAt: nowIso(), candidates: rows.length, processed: job.progress.done, counts: job.counts });
    log('Finished');
  });
}

function startRefresh(store, jobs, ids) {
  return jobs.enqueue('refresh', { ids: ids.length }, async (job, log) => {
    job.progress = { done: 0, total: ids.length, phase: 'Re-verifying' };
    await pool(ids, store.settings.concurrency, async id => {
      const c = store.get(id); if (c) { await processCompany(c, { settings: store.settings, refreshGoogle: true, log }); store.put(c); tally(job, c); }
      job.progress.done++;
    }, () => job.cancelRequested);
  });
}

function legacyRows(rootDir) {
  const file = path.join(rootDir, 'legacy', 'analyzed-leads-data.js');
  if (!fs.existsSync(file)) throw new Error('Legacy data file not found (legacy/analyzed-leads-data.js).');
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const json = txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1);
  const list = JSON.parse(json);
  const header = ['company', 'website', 'phone', 'email', 'address', 'industry', 'instagram', 'linkedin'];
  return [header, ...list.map(x => [x.name, x.website, x.phone, x.email, x.address, x.industry, x.instagram, x.linkedin])];
}

// ---------------- scheduled discovery ----------------
function startScheduler(store, jobs) {
  const tick = () => {
    for (const sch of store.settings.schedules || []) {
      if (!sch.enabled) continue;
      const due = !sch.lastRunAt || Date.now() - new Date(sch.lastRunAt) >= sch.everyHours * 3600000;
      if (!due) continue;
      sch.lastRunAt = nowIso();
      try { startDiscovery(store, jobs, { ...sch.params, scheduleId: sch.id }); sch.lastResult = 'Started'; }
      catch (e) { sch.lastResult = 'Not started: ' + e.message; }
      store.save();
    }
    store.purgeExpiredGoogleData();
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 60000);
}

module.exports = { processCompany, newRecord, mergeGoogle, setContact, Jobs, startDiscovery, startBulk, startRefresh, normalizeBulkInput, discoveryQueries, legacyRows, startScheduler, regionCode };
