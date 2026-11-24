'use strict';
// Local document database: one JSON file, atomic writes, automatic rotating backups.
// Chosen so the ERP runs on any Windows/macOS/Linux PC with only Node.js installed (no native modules).
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS } = require('./config');
const { nowIso, normName, normPhone, normPlace, domainOf, setUsageSink, setBudgetGuard, ApiError } = require('./util');
// Google bills by calendar month in Pacific Time, so limits are counted the same way.
const pacific = (d, withDay) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', ...(withDay ? { day: '2-digit' } : {}) }).format(d);

const SCHEMA = 1;
const GOOGLE_RESTRICTED_FIELDS = ['rating', 'userRatingCount', 'reviews', 'photos', 'photoCount', 'editorialSummary', 'regularOpeningHours', 'location', 'addressComponents', 'formattedAddress', 'types', 'primaryType', 'primaryTypeDisplayName', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'displayName', 'businessStatus'];

function emptyState() {
  return { meta: { schema: SCHEMA, createdAt: nowIso(), lastBackupDay: '' }, settings: JSON.parse(JSON.stringify(DEFAULTS)),
    companies: {}, jobs: [], searches: [], duplicates: [], usage: {} };
}

function mergeDefaults(settings) {
  const s = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...(settings || {}) };
  for (const k of ['weights', 'priority', 'company', 'costPer1000', 'budget']) s[k] = { ...DEFAULTS[k], ...(settings?.[k] || {}) };
  s.benchmarks = { ...DEFAULTS.benchmarks, ...(settings?.benchmarks || {}) };
  return s;
}

class Store {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'canvass-db.json'); this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.state = this.load();
    this.timer = null;
    setUsageSink((api, ok) => this.trackUsage(api, ok));
    setBudgetGuard(api => this.assertWithinBudget(api));
  }
  load() {
    if (!fs.existsSync(this.file)) { const s = emptyState(); this.writeNow(s); return s; }
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    return this.normalize(raw);
  }
  normalize(raw) {
    if (!raw || typeof raw !== 'object' || !raw.companies) throw new Error('Not a Canvass database file');
    const s = { ...emptyState(), ...raw };
    s.settings = mergeDefaults(raw.settings);
    s.meta = { ...emptyState().meta, ...raw.meta, schema: SCHEMA };
    return s;
  }
  writeNow(state = this.state) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, this.file);
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    this.writeNow();
    const day = new Date().toISOString().slice(0, 10);
    if (this.state.meta.lastBackupDay !== day) { this.state.meta.lastBackupDay = day; this.backup('auto'); }
  }
  // ---------- backups ----------
  backup(kind = 'manual') {
    const name = `canvass-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.json`;
    fs.writeFileSync(path.join(this.backupDir, name), JSON.stringify(this.state));
    const autos = this.listBackups().filter(b => b.name.endsWith('-auto.json'));
    for (const old of autos.slice(14)) fs.rmSync(path.join(this.backupDir, old.name), { force: true });
    return name;
  }
  listBackups() {
    return fs.readdirSync(this.backupDir).filter(f => /^canvass-backup-.*\.json$/.test(f))
      .map(name => ({ name, size: fs.statSync(path.join(this.backupDir, name)).size, createdAt: fs.statSync(path.join(this.backupDir, name)).mtime.toISOString() }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  readBackup(name) {
    if (!/^canvass-backup-[\w-]+\.json$/.test(name)) throw new Error('Invalid backup name');
    return fs.readFileSync(path.join(this.backupDir, name), 'utf8');
  }
  restore(json, { keepKeys = true } = {}) {
    const incoming = this.normalize(typeof json === 'string' ? JSON.parse(json) : json);
    this.backup('pre-restore');
    if (keepKeys) { incoming.settings.googlePlacesKey = this.state.settings.googlePlacesKey; incoming.settings.pageSpeedKey = this.state.settings.pageSpeedKey; }
    this.state = incoming; this.flush();
    return Object.keys(incoming.companies).length;
  }
  exportForBackup() {
    const copy = JSON.parse(JSON.stringify(this.state));
    copy.settings.googlePlacesKey = ''; copy.settings.pageSpeedKey = ''; // never put secrets in a downloadable file
    return copy;
  }
  // ---------- companies ----------
  get settings() { return this.state.settings; }
  allCompanies({ includeDemo } = {}) {
    const demo = includeDemo ?? this.state.settings.demoMode;
    return Object.values(this.state.companies).filter(c => demo || !c.demo);
  }
  get(id) { return this.state.companies[id] || null; }
  put(c) { c.updatedAt = nowIso(); this.state.companies[c.id] = c; this.save(); return c; }
  remove(id) { const had = !!this.state.companies[id]; delete this.state.companies[id]; this.save(); return had; }

  /** Duplicate detection: Place ID → website domain → phone → normalised name + city/area. */
  findDuplicate(candidate, { excludeId } = {}) {
    const placeId = candidate.google?.placeId || candidate.placeId;
    const domain = candidate.website?.domain || domainOf(candidate.contact?.website);
    const phone = normPhone(candidate.contact?.phone);
    const name = normName(candidate.name);
    const loc = normPlace(candidate.city || candidate.area);
    const compact = name.replace(/ /g, '');
    const label = d => (d || '').split('.')[0].replace(/[^a-z0-9]/g, '');
    for (const c of Object.values(this.state.companies)) {
      if (c.id === excludeId || !!c.demo !== !!candidate.demo) continue;
      if (placeId && c.google?.placeId === placeId) return { match: c, by: 'Google Place ID' };
      if (domain && c.website?.domain && c.website.domain === domain) return { match: c, by: 'website domain' };
      if (phone && normPhone(c.contact?.phone) === phone) return { match: c, by: 'phone number' };
      if (name && name === normName(c.name) && (!loc || !normPlace(c.city || c.area) || normPlace(c.city || c.area) === loc)) return { match: c, by: 'business name and location' };
      const otherDomain = c.website?.domain || domainOf(c.contact?.website);
      if (compact.length >= 5 && ((otherDomain && label(otherDomain) === compact) || (domain && label(domain) === normName(c.name).replace(/ /g, '')))) return { match: c, by: 'business name matches website domain' };
    }
    return null;
  }
  logDuplicate(entry) { this.state.duplicates.unshift({ at: nowIso(), ...entry }); this.state.duplicates = this.state.duplicates.slice(0, 2000); this.save(); }

  // ---------- jobs, searches, usage ----------
  addSearch(s) { this.state.searches.unshift(s); this.state.searches = this.state.searches.slice(0, 500); this.save(); }
  upsertJob(job) {
    const i = this.state.jobs.findIndex(j => j.id === job.id);
    const slim = { ...job, log: (job.log || []).slice(-200) };
    if (i >= 0) this.state.jobs[i] = slim; else this.state.jobs.unshift(slim);
    this.state.jobs = this.state.jobs.slice(0, 300); this.save();
  }
  /** Free-tier protection: refuse a Google Places request once the monthly or daily limit is reached. */
  budgetStatus(now = new Date()) {
    const b = this.state.settings.budget, month = pacific(now), day = pacific(now, true);
    const used = this.state.billing?.months?.[month]?.places || 0, dayUsed = this.state.billing?.days?.[day]?.places || 0;
    return { enabled: b.enabled, month, used, limit: b.placesMonthlyLimit, remaining: b.enabled ? Math.max(0, b.placesMonthlyLimit - used) : null,
      dayUsed, dayLimit: b.placesDailyLimit, dayRemaining: b.enabled ? Math.max(0, b.placesDailyLimit - dayUsed) : null };
  }
  assertWithinBudget(api) {
    if (api !== 'places') return;
    const s = this.budgetStatus();
    if (!s.enabled) return;
    if (s.remaining <= 0) throw new ApiError(`Monthly Google Places limit reached (${s.used} of ${s.limit} requests in ${s.month}). Canvass stopped before making a billable request. It resets next month, or raise the limit in Settings.`, { api, code: 'BUDGET' });
    if (s.dayRemaining <= 0) throw new ApiError(`Daily Google Places limit reached (${s.dayUsed} of ${s.dayLimit} today). Canvass stopped before making a billable request. Try again tomorrow, or raise the limit in Settings.`, { api, code: 'BUDGET' });
  }
  trackUsage(api, ok) {
    if (api === 'places') { // every attempt counts (including failures) so the cap errs on the safe side
      const b = this.state.billing ||= { months: {}, days: {} }, m = pacific(new Date()), d = pacific(new Date(), true);
      (b.months[m] ||= { places: 0 }).places++; (b.days[d] ||= { places: 0 }).places++;
      for (const k of Object.keys(b.days).sort().slice(0, -60)) delete b.days[k];
    }
    const day = new Date().toISOString().slice(0, 10);
    const d = this.state.usage[day] ||= {};
    const a = d[api] ||= { ok: 0, failed: 0 };
    ok ? a.ok++ : a.failed++;
    this.save();
  }
  usageSummary(days = 30) {
    const cost = this.state.settings.costPer1000;
    return Object.entries(this.state.usage).sort((a, b) => b[0].localeCompare(a[0])).slice(0, days).map(([day, apis]) => ({
      day, apis, estimatedCostUsd: Object.entries(apis).reduce((s, [api, v]) => s + ((v.ok + v.failed) / 1000) * (cost[api] || 0), 0)
    }));
  }

  /** Google Maps Platform terms: Places content may be cached for at most 30 days; Place IDs may be kept. */
  purgeExpiredGoogleData() {
    const days = this.state.settings.googleRetentionDays;
    let purged = 0;
    for (const c of Object.values(this.state.companies)) {
      const g = c.google;
      if (!g || !g.fetchedAt || g.expired) continue;
      if ((Date.now() - new Date(g.fetchedAt)) / 86400000 <= days) continue;
      for (const f of GOOGLE_RESTRICTED_FIELDS) delete g[f];
      g.expired = true; g.expiredAt = nowIso();
      // Contact details that only came from Google are removed too, unless a team member confirmed them independently.
      if (!c.contactVerifiedAt) for (const [field, src] of Object.entries(c.contactSources || {})) {
        if (String(src).startsWith('Google') && c.contact) { delete c.contact[field]; delete c.contactSources[field]; }
      }
      if (c.reviewAnalysis) c.reviewAnalysis = { status: 'Not Available', note: 'Google review content removed after the retention period. Refresh to re-analyse.' };
      purged++;
    }
    if (purged) this.save();
    return purged;
  }
}

module.exports = { Store, GOOGLE_RESTRICTED_FIELDS };
