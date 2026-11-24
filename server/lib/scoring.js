'use strict';
// Validation categories, 100-point lead score, service recommendations. Pure functions — fully unit-tested.

const CATEGORIES = ['Qualified', 'Unverified', 'Rejected', 'No Opportunity'];

/**
 * Mandatory rules decide the category; the score never overrides them.
 * Order: Rejected > Unverified > No Opportunity > Qualified.
 */
function validate(c, settings) {
  const checks = [];
  const rule = (id, label, state, detail = '') => checks.push({ id, label, state, detail }); // state: pass | fail-reject | fail-unverified | n/a
  const act = c.activity || {}, age = c.age || {}, ind = c.industryCheck || {}, loc = c.locationCheck || {}, size = c.sizeCheck || {};

  if (c.duplicateOf) rule('duplicate', 'Not a duplicate', 'fail-reject', `Duplicate of ${c.duplicateOf}`); else rule('duplicate', 'Not a duplicate', 'pass');

  if (act.status === 'Closed permanently' || act.status === 'Closed temporarily') rule('operational', 'Currently operating', 'fail-reject', act.status);
  else if (act.status === 'Verified') rule('operational', 'Currently operating', 'pass', `${act.signals} activity signals`);
  else rule('operational', 'Currently operating', 'fail-unverified', act.note || 'Not enough evidence of current activity');

  if (c.invalid) rule('genuine', 'Genuine business', 'fail-reject', c.invalid);
  else if (c.google?.placeId || c.manualIdentity) rule('genuine', 'Genuine business', 'pass', c.google?.placeId ? 'Listed on Google Business' : 'Verified by team');
  else if (c.websiteAudit?.availability?.ok) rule('genuine', 'Genuine business', 'fail-unverified', 'Working website, but no business listing or registration evidence');
  else rule('genuine', 'Genuine business', 'fail-unverified', 'No business listing, registration or working website found');

  if (ind.status === 'Irrelevant') rule('industry', 'Relevant industry', 'fail-reject', ind.note);
  else if (ind.status === 'Uncertain') rule('industry', 'Relevant industry', 'fail-unverified', ind.note);
  else rule('industry', 'Relevant industry', ind.status === 'Relevant' ? 'pass' : 'n/a', ind.by || ind.note || '');

  if (loc.status === 'Out of location') rule('location', 'Within selected location', 'fail-reject', loc.note);
  else if (loc.status === 'Unknown') rule('location', 'Within selected location', 'fail-unverified', loc.note);
  else rule('location', 'Within selected location', loc.status === 'Matching' ? 'pass' : 'n/a', loc.note || '');

  if (size.status === 'Large') rule('size', 'Small or growing business', 'fail-reject', size.note); else rule('size', 'Small or growing business', 'pass');

  const yrs = settings.eligibilityYears;
  if (age.withinWindow === false) rule('age', `Established within ${yrs} years`, 'fail-reject', (age.notes || [])[0] || 'Older than the eligibility window');
  else if (age.withinWindow === true) rule('age', `Established within ${yrs} years`, 'pass', `${age.status}: ${age.basis}`);
  else rule('age', `Established within ${yrs} years`, 'fail-unverified', (age.notes || []).slice(-1)[0] || 'Age not verified');

  const hasContact = !!(c.contact?.phone || c.contact?.email || c.contact?.website);
  rule('contact', 'Public contact information', hasContact ? 'pass' : 'fail-unverified', hasContact ? '' : 'No public phone, email or website found');

  const issues = c.issues || [];
  const confirmed = issues.filter(i => i.status === 'Confirmed Issue').length, potential = issues.length - confirmed;
  const hasOpp = settings.requireConfirmedIssue ? confirmed > 0 : issues.length > 0;
  rule('opportunity', 'Digital improvement opportunity', hasOpp ? 'pass' : 'no-opportunity', `${confirmed} confirmed, ${potential} potential`);

  const rejected = checks.filter(x => x.state === 'fail-reject'), unverified = checks.filter(x => x.state === 'fail-unverified');
  let category = 'Qualified';
  if (rejected.length) category = 'Rejected'; else if (unverified.length) category = 'Unverified'; else if (!hasOpp) category = 'No Opportunity';
  const reasons = (category === 'Rejected' ? rejected : category === 'Unverified' ? unverified : category === 'No Opportunity' ? checks.filter(x => x.state === 'no-opportunity') : [])
    .map(x => `${x.label}: ${x.detail || 'failed'}`);
  return { category, reasons, checks, validatedAt: new Date().toISOString() };
}

/** Configurable 100-point sales-opportunity score (not a measure of trustworthiness). */
function score(c, settings) {
  const w = settings.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const age = c.age || {};
  const ageFrac = age.withinWindow === true ? (age.status === 'Verified' ? (age.yearsOld != null && age.yearsOld <= 2 ? 1 : 0.85) : 0.5) : 0;
  const act = c.activity || {};
  const actFrac = act.status === 'Verified' ? Math.min(1, 0.6 + 0.1 * (act.signals || 0)) : act.status === 'Unverified' ? Math.min(0.4, 0.1 * (act.signals || 0)) : 0;
  const pts = list => list.reduce((s, i) => s + (i.status === 'Confirmed Issue' ? 1 : 0.4), 0);
  const gbpIssues = (c.issues || []).filter(i => i.area === 'gbp'), webIssues = (c.issues || []).filter(i => i.area === 'website');
  const gbpFrac = Math.min(1, pts(gbpIssues) / 5);
  const noSite = !c.contact?.website && c.websiteStatus === 'Not found';
  const webFrac = noSite ? 1 : Math.min(1, pts(webIssues) / 5);
  const ct = c.contact || {};
  const ctFrac = (ct.phone ? 0.4 : 0) + (ct.email ? 0.3 : 0) + (ct.website || ct.address ? 0.3 : 0);
  const parts = { age: ageFrac * w.age, activity: actFrac * w.activity, gbp: gbpFrac * w.gbp, website: webFrac * w.website, contact: ctFrac * w.contact };
  for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;
  const value = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 100 / total);
  const priority = value >= settings.priority.high ? 'High' : value >= settings.priority.medium ? 'Medium' : 'Low';
  return { total: value, parts, priority, max: w, note: 'Sales-opportunity score. It does not measure trustworthiness or business quality.' };
}

/** Recommend only enabled services that are tied to an actual finding. */
function recommendServices(c, settings) {
  const enabled = new Set(settings.services.filter(s => s.enabled).map(s => s.name));
  const map = new Map();
  const add = (name, reason) => { if (!enabled.has(name)) return; if (!map.has(name)) map.set(name, new Set()); map.get(name).add(reason); };
  for (const i of c.issues || []) for (const s of i.services || []) add(s, i.title);
  if (c.websiteStatus === 'Not found') for (const s of ['Website design', 'Website development', 'Branding', 'Domain and hosting support']) add(s, 'No website found in checked sources');
  if (c.websiteAudit?.page && !Object.keys(c.websiteAudit.page.social || {}).length && !c.social?.instagram) add('Social media management', 'No social media profiles found');
  const group = Object.fromEntries(settings.services.map(s => [s.name, s.group]));
  return [...map.entries()].map(([name, reasons]) => ({ name, group: group[name] || 'other', reasons: [...reasons].slice(0, 4) }))
    .sort((a, b) => b.reasons.length - a.reasons.length);
}

module.exports = { validate, score, recommendServices, CATEGORIES };
