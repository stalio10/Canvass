'use strict';
// Mandatory validation rules, age/activity logic, scoring and services — pure functions, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS } = require('../server/lib/config');
const { assessAge, assessActivity, assessIndustry, assessLocation, assessSize } = require('../server/lib/verify');
const { validate, score, recommendServices } = require('../server/lib/scoring');

const S = JSON.parse(JSON.stringify(DEFAULTS));
const TODAY = new Date('2026-11-24T12:00:00Z');
const ago = (days, from = TODAY) => new Date(from - days * 86400000).toISOString().slice(0, 10);
const goodGoogle = (over = {}) => ({ placeId: 'p1', fetchedAt: TODAY.toISOString(), businessStatus: 'OPERATIONAL', formattedAddress: 'Al Quoz, Dubai', location: { latitude: 1, longitude: 1 },
  nationalPhoneNumber: '04 1234567', regularOpeningHours: { weekdayDescriptions: ['Mon 9-5'] }, reviews: [{ rating: 5, text: 'Great', publishTime: TODAY.toISOString() }], types: ['interior_designer'], userRatingCount: 12, ...over });
function lead(over = {}) {
  return { name: 'Test Interiors', contact: { phone: '0501234567', website: 'https://t.example' }, google: goodGoogle(),
    activity: { status: 'Verified', signals: 4, recentSignals: 1 }, age: { status: 'Verified', withinWindow: true, basis: 'Documented', yearsOld: 1.5, notes: [] },
    industryCheck: { status: 'Relevant' }, locationCheck: { status: 'Matching' }, sizeCheck: { status: 'SME' },
    issues: [{ id: 'x', area: 'website', status: 'Confirmed Issue', title: 'Missing meta description', services: ['Technical SEO'] }], ...over };
}

test('qualified only when every mandatory rule passes', () => {
  assert.equal(validate(lead(), S).category, 'Qualified');
});
test('closed businesses are rejected', () => {
  for (const st of ['Closed permanently', 'Closed temporarily']) assert.equal(validate(lead({ activity: { status: st } }), S).category, 'Rejected');
});
test('companies older than the window are rejected', () => {
  const v = validate(lead({ age: { status: 'Verified', withinWindow: false, notes: ['Established 2015'] } }), S);
  assert.equal(v.category, 'Rejected'); assert.match(v.reasons[0], /2015/);
});
test('unverified age keeps a lead out of the pipeline', () => {
  assert.equal(validate(lead({ age: { status: 'Estimated', withinWindow: null, notes: ['Supporting evidence only'] } }), S).category, 'Unverified');
});
test('unverified activity, uncertain industry, unknown location → Unverified', () => {
  assert.equal(validate(lead({ activity: { status: 'Unverified', note: 'x' } }), S).category, 'Unverified');
  assert.equal(validate(lead({ industryCheck: { status: 'Uncertain', note: 'x' } }), S).category, 'Unverified');
  assert.equal(validate(lead({ locationCheck: { status: 'Unknown', note: 'x' } }), S).category, 'Unverified');
});
test('irrelevant industry, out of location, large, duplicate, invalid → Rejected', () => {
  assert.equal(validate(lead({ industryCheck: { status: 'Irrelevant', note: 'x' } }), S).category, 'Rejected');
  assert.equal(validate(lead({ locationCheck: { status: 'Out of location', note: 'x' } }), S).category, 'Rejected');
  assert.equal(validate(lead({ sizeCheck: { status: 'Large', note: 'x' } }), S).category, 'Rejected');
  assert.equal(validate(lead({ duplicateOf: 'cmp_1' }), S).category, 'Rejected');
  assert.equal(validate(lead({ invalid: 'Fake listing' }), S).category, 'Rejected');
});
test('no public contact information → Unverified', () => {
  assert.equal(validate(lead({ contact: {} }), S).category, 'Unverified');
});
test('only potential improvements → No Opportunity (default), Qualified when setting allows', () => {
  const l = lead({ issues: [{ id: 'p', area: 'website', status: 'Potential Improvement', title: 'x', services: [] }] });
  assert.equal(validate(l, S).category, 'No Opportunity');
  assert.equal(validate(l, { ...S, requireConfirmedIssue: false }).category, 'Qualified');
  assert.equal(validate(lead({ issues: [] }), S).category, 'No Opportunity');
});
test('a high score never overrides a failed mandatory rule', () => {
  const l = lead({ sizeCheck: { status: 'Large', note: 'chain' }, issues: Array.from({ length: 10 }, (_, i) => ({ id: 'i' + i, area: i % 2 ? 'gbp' : 'website', status: 'Confirmed Issue', title: 't', services: [] })) });
  assert.ok(score(l, S).total >= 80, 'score should be high');
  assert.equal(validate(l, S).category, 'Rejected');
});
test('score is 0–100 with configurable priority bands', () => {
  const sc = score(lead(), S);
  assert.ok(sc.total >= 0 && sc.total <= 100);
  assert.equal(sc.priority, sc.total >= 80 ? 'High' : sc.total >= 60 ? 'Medium' : 'Low');
  const zero = score({ issues: [], contact: {} }, S); assert.equal(zero.total, 0); assert.equal(zero.priority, 'Low');
  const custom = score(lead({ contact: { phone: '050', email: 'a@b.example', website: 'https://t.example' } }), { ...S, weights: { age: 0, activity: 0, gbp: 0, website: 0, contact: 10 } });
  assert.equal(custom.total, 100); // full contact info, only contact weighted
});

// ---------- age ----------
test('documented establishment date inside the window verifies age', () => {
  const a = assessAge({ manual: { date: ago(400), source: 'DED licence' }, reviews: [] }, S, TODAY);
  assert.equal(a.status, 'Verified'); assert.equal(a.withinWindow, true);
});
test('documented date older than the window → verified but outside', () => {
  const a = assessAge({ manual: { date: ago(365 * 7), source: 'Licence' } }, S, TODAY);
  assert.equal(a.withinWindow, false);
});
test('the five-year window moves with the current date', () => {
  const est = '2021-11-01';
  assert.equal(assessAge({ manual: { date: est, source: 'x' } }, S, new Date('2026-10-01')).withinWindow, true);
  assert.equal(assessAge({ manual: { date: est, source: 'x' } }, S, new Date('2026-12-01')).withinWindow, false);
});
test('domain and archive dates alone are only an estimate (not verified)', () => {
  const a = assessAge({ rdap: { status: 'Found', date: ago(600) }, wayback: { status: 'Found', date: ago(500) }, hasWebsite: true }, S, TODAY);
  assert.equal(a.status, 'Estimated'); assert.equal(a.withinWindow, null);
  const b = assessAge({ rdap: { status: 'Found', date: ago(600) }, wayback: { status: 'Found', date: ago(500) }, hasWebsite: true }, { ...S, acceptEstimatedAge: true }, TODAY);
  assert.equal(b.withinWindow, true); assert.equal(b.acceptedEstimate, true);
});
test('old domain alone does not reject (domain may predate the business)', () => {
  const a = assessAge({ rdap: { status: 'Found', date: '2003-12-17' }, hasWebsite: true }, S, TODAY);
  assert.equal(a.status, 'Unverified'); assert.equal(a.withinWindow, null);
});
test('a customer review older than the window proves the business is older', () => {
  const a = assessAge({ reviews: [{ publishTime: ago(365 * 6) + 'T00:00:00Z' }] }, S, TODAY);
  assert.equal(a.withinWindow, false); assert.equal(a.status, 'Verified');
});
test('no evidence → Not Available, never an invented date', () => {
  const a = assessAge({ reviews: [] }, S, TODAY);
  assert.equal(a.status, 'Not Available'); assert.equal(a.earliestDate, null); assert.equal(a.withinWindow, null);
});

// ---------- activity ----------
test('a Google listing alone is not proof of activity', () => {
  const a = assessActivity({ google: { placeId: 'x', fetchedAt: TODAY.toISOString(), businessStatus: 'OPERATIONAL' } }, S, TODAY);
  assert.equal(a.status, 'Unverified');
});
test('operational + recent review + hours + phone → Verified', () => {
  assert.equal(assessActivity({ google: goodGoogle() }, S, TODAY).status, 'Verified');
});
test('few or old reviews do not make a business inactive, just unverified', () => {
  const a = assessActivity({ google: goodGoogle({ reviews: [{ rating: 4, publishTime: ago(900) }] }) }, S, TODAY);
  assert.equal(a.status, 'Unverified'); assert.notEqual(a.status, 'Closed permanently');
  const b = assessActivity({ google: goodGoogle({ reviews: [{ rating: 4, publishTime: ago(900) }] }), websiteAudit: { availability: { ok: true }, finalUrl: 'https://x', checkedAt: TODAY.toISOString() } }, S, TODAY);
  assert.equal(b.status, 'Verified');
});
test('closed statuses are detected', () => {
  assert.equal(assessActivity({ google: goodGoogle({ businessStatus: 'CLOSED_TEMPORARILY' }) }, S).status, 'Closed temporarily');
});

// ---------- industry / location / size ----------
test('industry relevance uses Google types and keywords', () => {
  const ind = S.industries;
  assert.equal(assessIndustry({ industryId: 'interior-design', google: { types: ['interior_designer'] }, name: 'X' }, ind).status, 'Relevant');
  assert.equal(assessIndustry({ industryId: 'interior-design', google: { types: ['restaurant', 'food'] }, name: 'Tasty Grill' }, ind).status, 'Irrelevant');
  assert.equal(assessIndustry({ industryId: 'interior-design', google: { types: ['point_of_interest'] }, name: 'ABC Group' }, ind).status, 'Uncertain');
  assert.equal(assessIndustry({ industryId: 'restaurants-cafes', google: { types: ['indian_restaurant'] }, name: 'Spice' }, ind).status, 'Relevant');
});
test('location matching rejects other cities and flags unknown addresses', () => {
  const g = city => ({ formattedAddress: `Street, ${city}`, addressComponents: [{ longText: city, types: ['locality'] }, { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] }] });
  assert.equal(assessLocation({ google: g('Dubai'), country: 'United Arab Emirates', city: 'Dubai' }).status, 'Matching');
  assert.equal(assessLocation({ google: g('Abu Dhabi'), country: 'United Arab Emirates', city: 'Dubai' }).status, 'Out of location');
  assert.equal(assessLocation({ google: null, country: 'United Arab Emirates', city: 'Dubai' }).status, 'Unknown');
});
test('large and chain businesses are detected', () => {
  assert.equal(assessSize({ google: { userRatingCount: 5000 }, name: 'Big' }, S).status, 'Large');
  assert.equal(assessSize({ google: { userRatingCount: 30 }, name: 'Cafe Nero' }, S, { 'cafe nero': 4 }).status, 'Large');
  assert.equal(assessSize({ google: { userRatingCount: 30 }, name: 'Small Co' }, S).status, 'SME');
});

// ---------- services ----------
test('services come only from findings and enabled catalogue entries', () => {
  const l = lead();
  assert.deepEqual(recommendServices(l, S).map(s => s.name), ['Technical SEO']);
  const off = { ...S, services: S.services.map(s => ({ ...s, enabled: s.name !== 'Technical SEO' })) };
  assert.deepEqual(recommendServices(l, off), []);
});
