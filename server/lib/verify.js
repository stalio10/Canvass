'use strict';
// Verification engine: age, activity, industry relevance, location, size. Every finding carries its source and timestamp.
const { httpFetch, registrableDomain, yearsBetween, monthsBetween, isValidDate, normName, normPlace } = require('./util');

// ---------- external age sources ----------
async function rdapRegistration(domain) {
  const root = registrableDomain(domain);
  const checkedAt = new Date().toISOString();
  try {
    const res = await httpFetch('https://rdap.org/domain/' + encodeURIComponent(root), { api: 'rdap', timeoutMs: 20000, retries: 1, headers: { accept: 'application/rdap+json, application/json' } });
    if (res.status === 404) return { status: 'Not Available', source: 'RDAP (rdap.org)', checkedAt, note: `No RDAP record published for ${root}` };
    if (!res.ok) return { status: 'Not Available', source: 'RDAP (rdap.org)', checkedAt, note: `RDAP lookup returned HTTP ${res.status}` };
    const data = await res.json();
    const ev = (data.events || []).find(e => /registration/i.test(e.eventAction));
    if (!ev || !isValidDate(ev.eventDate)) return { status: 'Not Available', source: 'RDAP', checkedAt, note: 'Registry did not publish a registration date' };
    const self = (data.links || []).find(l => l.rel === 'self')?.href || `https://rdap.org/domain/${root}`;
    return { status: 'Found', date: ev.eventDate.slice(0, 10), source: 'RDAP domain registration record', url: self, checkedAt, domain: root };
  } catch (e) { return { status: 'Not Available', source: 'RDAP', checkedAt, note: 'Lookup failed: ' + e.message }; }
}

async function waybackFirstCapture(domain) {
  const checkedAt = new Date().toISOString();
  try {
    const u = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&limit=1&output=json&fl=timestamp,original&filter=statuscode:200`;
    const res = await httpFetch(u, { api: 'wayback', timeoutMs: 30000, retries: 1 });
    if (!res.ok) return { status: 'Not Available', source: 'Internet Archive', checkedAt, note: `Archive returned HTTP ${res.status}` };
    const rows = await res.json().catch(() => []);
    const first = rows[1];
    if (!first) return { status: 'Not Found', source: 'Internet Archive Wayback Machine', checkedAt, note: 'No archived captures of this domain' };
    const ts = first[0];
    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    return { status: 'Found', date, source: 'Internet Archive first capture', url: `https://web.archive.org/web/${ts}/${first[1]}`, checkedAt };
  } catch (e) { return { status: 'Not Available', source: 'Internet Archive', checkedAt, note: 'Lookup failed: ' + e.message }; }
}

/**
 * Decide company age from evidence. Pure function (unit-tested).
 * Statuses: Verified | Estimated | Unverified | Not Available.
 * - "documented" evidence (registration/licence entered with a source) can verify age.
 * - an old customer review is direct proof the business operated before that date.
 * - domain registration and archive history are supporting evidence only.
 */
function assessAge({ manual, rdap, wayback, reviews = [], hasWebsite }, settings, today = new Date()) {
  const years = settings.eligibilityYears;
  const windowStart = new Date(today); windowStart.setFullYear(windowStart.getFullYear() - years);
  const ws = windowStart.toISOString().slice(0, 10);
  const evidence = [];
  if (manual?.date) evidence.push({ kind: 'establishment', label: 'Documented establishment / licence date', date: manual.date, source: manual.source, url: manual.url || '', checkedAt: manual.enteredAt, strength: 'documented' });
  if (rdap?.status === 'Found') evidence.push({ kind: 'domain', label: 'Domain registered', date: rdap.date, source: rdap.source, url: rdap.url, checkedAt: rdap.checkedAt, strength: 'supporting' });
  if (wayback?.status === 'Found') evidence.push({ kind: 'archive', label: 'Website first archived', date: wayback.date, source: wayback.source, url: wayback.url, checkedAt: wayback.checkedAt, strength: 'supporting' });
  const dated = reviews.filter(r => isValidDate(r.publishTime)).map(r => r.publishTime.slice(0, 10)).sort();
  if (dated.length) evidence.push({ kind: 'review', label: 'Earliest review in available sample', date: dated[0], source: 'Google Places reviews (sample of up to 5)', url: '', checkedAt: new Date().toISOString(), strength: 'upper-bound' });

  const notes = [];
  const result = (status, withinWindow, basis, extra = {}) => ({ status, withinWindow, basis, windowStart: ws, eligibilityYears: years, evidence, notes, ...extra,
    earliestDate: extra.earliestDate || (evidence.length ? evidence.map(e => e.date).sort()[0] : null),
    yearsOld: extra.earliestDate ? Math.round(yearsBetween(extra.earliestDate, today) * 10) / 10 : null });

  // Website age (separate from company age).
  const websiteAge = !hasWebsite ? { status: 'Not Applicable' }
    : wayback?.status === 'Found' ? { status: 'Estimated', firstSeen: wayback.date, source: wayback.source, url: wayback.url, withinWindow: wayback.date >= ws, note: 'Earliest public archive capture — the site may have launched earlier than archiving began.' }
    : { status: 'Not Available', note: wayback?.note || 'No archive record' };

  const doc = evidence.find(e => e.strength === 'documented');
  if (doc) {
    const within = doc.date >= ws;
    if (!within) notes.push(`Established ${doc.date}, before the ${years}-year window (${ws}).`);
    const olderReview = within && dated.length && dated[0] < doc.date;
    if (olderReview) notes.push(`A customer review dated ${dated[0]} predates the documented date — check the record.`);
    return result(olderReview ? 'Unverified' : 'Verified', olderReview ? null : within, 'Documented establishment evidence', { earliestDate: doc.date, websiteAge });
  }
  if (dated.length && dated[0] < ws) {
    notes.push(`A customer review dated ${dated[0]} shows the business was operating more than ${years} years ago.`);
    return result('Verified', false, 'Dated customer review predates the window', { earliestDate: dated[0], websiteAge });
  }
  if (settings.rejectOldWebsiteArchive && wayback?.status === 'Found' && wayback.date < ws) {
    notes.push(`The website has been online since at least ${wayback.date}. Add a documented establishment date if the business is newer than its domain.`);
    return result('Estimated', false, 'Website archive history predates the window', { earliestDate: wayback.date, websiteAge });
  }
  const supporting = evidence.filter(e => e.strength === 'supporting');
  if (!supporting.length) {
    notes.push('No reliable age evidence found. Add the trade licence or registration date to verify.');
    return result(evidence.length ? 'Unverified' : 'Not Available', null, 'Insufficient evidence', { websiteAge });
  }
  const older = supporting.filter(e => e.date < ws);
  if (older.length) {
    notes.push(`${older.map(e => e.label + ' ' + e.date).join('; ')} — older than the window, but a domain can predate the business. Age left unverified.`);
    return result('Unverified', null, 'Conflicting supporting evidence', { websiteAge });
  }
  const earliest = supporting.map(e => e.date).sort()[0];
  notes.push(`Supporting evidence only (${supporting.map(e => e.label).join(', ')}). Domain or archive dates are not proof of the company's establishment date.`);
  const accepted = settings.acceptEstimatedAge && supporting.length >= settings.ageMinSources;
  if (accepted) notes.push('Accepted as an estimate because "Accept consistent estimates" is switched on in Settings.');
  return result('Estimated', accepted ? true : null, accepted ? 'Consistent supporting evidence (accepted estimate)' : 'Supporting evidence only', { earliestDate: earliest, websiteAge, acceptedEstimate: accepted });
}

/** Active-business assessment. Pure function. */
function assessActivity({ google, websiteAudit, manualActivity = [] }, settings, today = new Date()) {
  const evidence = [], now = new Date().toISOString();
  const bs = google?.businessStatus;
  if (bs === 'CLOSED_PERMANENTLY') return { status: 'Closed permanently', evidence: [{ label: 'Google Business status: permanently closed', source: 'Google Places API', checkedAt: google.fetchedAt }], recentSignals: 0 };
  if (bs === 'CLOSED_TEMPORARILY') return { status: 'Closed temporarily', evidence: [{ label: 'Google Business status: temporarily closed', source: 'Google Places API', checkedAt: google.fetchedAt }], recentSignals: 0 };
  let recent = 0, total = 0;
  if (bs === 'OPERATIONAL') evidence.push({ label: 'Google Business status: operational', source: 'Google Places API', checkedAt: google.fetchedAt, counted: false, note: 'Listing status alone is not proof of activity' });
  const latest = (google?.reviews || []).map(r => r.publishTime).filter(isValidDate).sort().pop();
  if (latest) {
    const m = monthsBetween(latest, today);
    if (m <= settings.recentReviewMonths) { recent++; total++; evidence.push({ label: `Recent customer review (${latest.slice(0, 10)})`, source: 'Google Places reviews', checkedAt: google.fetchedAt, counted: true }); }
    else evidence.push({ label: `Latest review in sample is ${Math.round(m)} months old`, source: 'Google Places reviews', checkedAt: google.fetchedAt, counted: false, note: 'Few or old reviews do not mean the business is inactive' });
  }
  if (websiteAudit?.availability?.ok) { recent++; total++; evidence.push({ label: 'Website is online', source: websiteAudit.finalUrl, checkedAt: websiteAudit.checkedAt, counted: true }); }
  if (google?.regularOpeningHours?.weekdayDescriptions?.length) { total++; evidence.push({ label: 'Working hours published', source: 'Google Places API', checkedAt: google.fetchedAt, counted: true }); }
  if (google?.nationalPhoneNumber || google?.internationalPhoneNumber) { total++; evidence.push({ label: 'Public business phone listed', source: 'Google Places API', checkedAt: google.fetchedAt, counted: true }); }
  if (google?.formattedAddress && google?.location) { total++; evidence.push({ label: 'Valid map location and address', source: 'Google Places API', checkedAt: google.fetchedAt, counted: true }); }
  for (const m of manualActivity) {
    total++; if (m.recent !== false) recent++;
    evidence.push({ label: m.label || 'Team-verified activity', source: m.source, url: m.url, checkedAt: m.enteredAt || now, counted: true, manual: true });
  }
  const base = bs === 'OPERATIONAL' || manualActivity.length > 0;
  const verified = base && recent >= 1 && total >= settings.activeMinEvidence;
  return { status: verified ? 'Verified' : 'Unverified', evidence, recentSignals: recent, signals: total,
    note: verified ? '' : !base ? 'Operational status not confirmed by Google or the team.' : recent < 1 ? 'No recent activity evidence (recent review, working website or verified social activity).' : `Only ${total} activity signal(s); ${settings.activeMinEvidence} required.` };
}

const GENERIC_TYPES = new Set(['point_of_interest', 'establishment', 'store', 'food', 'health', 'finance', 'premise', 'service', 'local_business', 'business']);
function industryMatch(ind, types = [], text = '') {
  const t = types.filter(x => !GENERIC_TYPES.has(x));
  const byType = t.find(x => (ind.types || []).includes(x) || (ind.typeSuffix && x.endsWith(ind.typeSuffix)));
  if (byType) return { match: true, by: 'Google category: ' + byType };
  const low = ' ' + String(text).toLowerCase() + ' ';
  const kw = (ind.keywords || []).find(k => low.includes(k.toLowerCase()));
  if (kw) return { match: true, by: `Name/category contains "${kw.trim()}"` };
  return { match: false };
}

/** Industry relevance. Relevant | Irrelevant | Uncertain. */
function assessIndustry({ industryId, category, google, name, uploadIndustry }, industries) {
  if (!industryId) return { status: 'Not Applicable', note: 'No industry selected for this batch' };
  const ind = industries.find(i => i.id === industryId);
  if (!ind) return { status: 'Uncertain', note: 'Unknown industry setting' };
  if (ind.matchesAny) return { status: 'Relevant', by: 'Any small or medium business accepted' };
  const types = google?.types || [];
  const text = [name, google?.primaryTypeDisplayName, google?.editorialSummary, uploadIndustry, (google?.primaryType || '').replace(/_/g, ' ')].filter(Boolean).join(' | ');
  const m = industryMatch(ind, types, text);
  if (m.match) {
    if (category) {
      const c = normName(category);
      const catHit = c.split(' ').some(w => w.length > 3 && normName(text).includes(w)) || types.some(t => t.replace(/_/g, ' ').includes(c));
      return { status: 'Relevant', by: m.by + (catHit ? `; matches category "${category}"` : ''), categoryMatch: catHit };
    }
    return { status: 'Relevant', by: m.by };
  }
  const specific = types.filter(x => !GENERIC_TYPES.has(x));
  const other = industries.find(i => i.id !== ind.id && !i.matchesAny && specific.some(x => (i.types || []).includes(x) || (i.typeSuffix && x.endsWith(i.typeSuffix))));
  if (other) return { status: 'Irrelevant', note: `Google lists it as ${google?.primaryTypeDisplayName || other.name}, not ${ind.name}` };
  return { status: 'Uncertain', note: 'Industry could not be confirmed from the available category data' };
}

/** Location check against the requested country/city/area. Matching | Out of location | Unknown. */
function assessLocation({ google, address, country, city, area }) {
  if (!country && !city) return { status: 'Not Applicable' };
  const comps = google?.addressComponents || [];
  const formatted = google?.formattedAddress || address || '';
  if (!comps.length && !formatted) return { status: 'Unknown', note: 'No address available' };
  const has = (typeList, value) => comps.some(c => (c.types || []).some(t => typeList.includes(t)) && [c.longText, c.shortText].some(v => normPlace(v) === normPlace(value)));
  const textHas = v => normPlace(formatted).includes(normPlace(v));
  const countryOk = !country || (comps.length ? has(['country'], country) || textHas(country) || (normPlace(country) === 'united arab emirates' && has(['country'], 'AE')) : textHas(country) || null);
  const cityOk = !city || (comps.length ? has(['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'postal_town'], city) || textHas(city) : textHas(city) || null);
  if (countryOk === false || cityOk === false) return { status: 'Out of location', note: `Address "${formatted}" is outside ${[city, country].filter(Boolean).join(', ')}` };
  if (countryOk === null || cityOk === null) return { status: 'Unknown', note: 'Address does not state the city or country' };
  const areaOk = !area || textHas(area) || has(['sublocality', 'sublocality_level_1', 'neighborhood', 'locality'], area);
  return { status: 'Matching', note: areaOk ? '' : `Within ${city || country}, but "${area}" is not in the address`, areaMatch: areaOk, address: formatted };
}

/** Large or chain businesses are excluded (we target new and growing SMEs). */
function assessSize({ google, name }, settings, chainCounts = {}) {
  const reviews = google?.userRatingCount;
  if (Number.isFinite(reviews) && reviews > settings.largeCompanyReviewThreshold)
    return { status: 'Large', note: `${reviews} Google reviews (over ${settings.largeCompanyReviewThreshold}) suggests a large established business` };
  const n = chainCounts[normName(name)] || 0;
  if (n >= settings.chainLocationThreshold) return { status: 'Large', note: `${n} locations with the same name found — likely a chain` };
  return { status: 'SME' };
}

module.exports = { rdapRegistration, waybackFirstCapture, assessAge, assessActivity, assessIndustry, assessLocation, assessSize, industryMatch, GENERIC_TYPES };
