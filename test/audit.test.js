'use strict';
// Website HTML analysis, issue derivation, Google Business audit, review analysis, pitches.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS } = require('../server/lib/config');
const { analyzeHtml, deriveIssues } = require('../server/lib/website-audit');
const { auditGbp, analyzeReviews } = require('../server/lib/gbp-audit');
const { generatePitches } = require('../server/lib/pitch');
const S = JSON.parse(JSON.stringify(DEFAULTS));

const GOOD_HTML = `<!doctype html><html lang="en"><head><title>Olive Interiors | Fit-out company in Dubai</title>
<meta name="viewport" content="width=device-width"><meta name="description" content="Interior fit-out in Dubai.">
<link rel="canonical" href="https://olive.example/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Olive"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script></head><body><h1>Interior fit-out in Dubai</h1>
<a href="/contact">Contact us</a><a href="https://wa.me/971500000000">WhatsApp us</a><a href="tel:+97140000000">Call</a>
<a href="mailto:hello@olive.example">Email</a><a href="https://instagram.com/olive">IG</a>
<form><input type="email"><textarea></textarea></form><p>Office 4, Al Quoz, Dubai. ${'word '.repeat(300)}</p>
<a href="/cdn-cgi/l/email-protection#4e262b22222e29213d27">x</a>
<footer>© 2021-${new Date().getFullYear()} Olive</footer></body></html>`;

test('HTML analysis extracts real on-page facts', () => {
  const p = analyzeHtml(GOOD_HTML, 'https://olive.example/', { city: 'Dubai' });
  assert.equal(p.viewport, true); assert.equal(p.h1s.length, 1); assert.equal(p.forms, 1);
  assert.equal(p.whatsapp, true); assert.equal(p.tel, true); assert.ok(p.emails.includes('hello@olive.example'));
  assert.ok(p.ldTypes.includes('LocalBusiness')); assert.equal(p.addressOnSite, true);
  assert.equal(p.contactPage, 'https://olive.example/contact'); assert.ok(p.social.instagram);
  assert.equal(p.copyrightYear, new Date().getFullYear()); assert.ok(p.ctas.length >= 1);
});
test('Cloudflare-protected emails are decoded', () => {
  // key 0x4e XOR "hello@go.ai"
  const enc = '4e' + Buffer.from('hello@go.ai').map(b => b ^ 0x4e).toString('hex');
  const p = analyzeHtml(`<a href="/cdn-cgi/l/email-protection#${enc}">x</a>`, 'https://x.example/');
  assert.ok(p.emails.includes('hello@go.ai'));
});

const audit = (page, extra = {}) => ({ url: 'https://x.example/', finalUrl: 'https://x.example/', checkedAt: new Date().toISOString(), availability: { ok: true, httpStatus: 200, responseMs: 500 }, https: { usesHttps: true, httpRedirectsToHttps: true }, sitemap: true, brokenLinks: { checked: 5, broken: [] }, pagespeed: { status: 'Not tested' }, page, ...extra });

test('a well-built site has no confirmed issues', () => {
  const issues = deriveIssues(audit(analyzeHtml(GOOD_HTML, 'https://olive.example/', { city: 'Dubai' })));
  assert.deepEqual(issues.filter(i => i.status === 'Confirmed Issue'), []);
});
test('measured problems become confirmed issues', () => {
  const bad = analyzeHtml('<html><body><p>hi</p></body></html>', 'http://x.example/');
  const issues = deriveIssues(audit(bad, { https: { usesHttps: false }, brokenLinks: { checked: 3, broken: [{ url: 'https://x.example/a', status: 404 }] } }));
  const ids = issues.filter(i => i.status === 'Confirmed Issue').map(i => i.id);
  for (const id of ['no-https', 'no-viewport', 'no-title', 'no-meta-desc', 'no-h1', 'broken-links']) assert.ok(ids.includes(id), id);
  assert.ok(issues.every(i => i.services.length), 'every issue maps to services');
});
test('PageSpeed scores are only used when the test actually ran', () => {
  const page = analyzeHtml(GOOD_HTML, 'https://olive.example/', { city: 'Dubai' });
  assert.equal(deriveIssues(audit(page, { pagespeed: { status: 'Failed', error: 'quota' } })).filter(i => i.id.startsWith('ps-')).length, 0);
  assert.ok(deriveIssues(audit(page, { pagespeed: { status: 'Tested', performance: 30, seo: 95, accessibility: 95, bestPractices: 95 } })).some(i => i.id === 'ps-performance' && i.status === 'Confirmed Issue'));
});
test('our own network failure is never reported as the business’s problem', () => {
  assert.deepEqual(deriveIssues({ availability: { ok: false, networkProblem: true, error: 'offline' } }), []);
  assert.equal(deriveIssues({ availability: { ok: false, httpStatus: 500 }, url: 'https://x' })[0].id, 'site-down');
});
test('JavaScript-rendered sites get potential (not confirmed) content issues', () => {
  const p = analyzeHtml('<html><body><div id="root"></div><script src="app.js"></script></body></html>', 'https://spa.example/');
  assert.equal(p.jsRendered, true);
  const conf = deriveIssues(audit(p)).filter(i => i.status === 'Confirmed Issue').map(i => i.id);
  assert.ok(!conf.includes('no-h1') && !conf.includes('no-title'));
});

// ---------- Google Business Profile ----------
const g = over => ({ placeId: 'p', fetchedAt: new Date().toISOString(), formattedAddress: 'Shop 4, Al Wasl Road, Dubai', addressComponents: [{ types: ['route'] }], location: { latitude: 1, longitude: 2 }, googleMapsUri: 'https://maps.google.com/?cid=1',
  websiteUri: 'https://x.example', nationalPhoneNumber: '04', regularOpeningHours: { weekdayDescriptions: ['Mon'] }, editorialSummary: 'Nice', primaryType: 'interior_designer', types: ['interior_designer', 'furniture_store'],
  photoCount: 10, userRatingCount: 80, rating: 4.7, reviews: [{ rating: 5, text: 'Great', publishTime: new Date().toISOString() }], ...over });
test('complete profile → no confirmed Google issues', () => {
  assert.equal(auditGbp(g(), { industryId: 'interior-design' }, S).issues.filter(i => i.status === 'Confirmed Issue').length, 0);
});
test('missing profile items become issues; missing website link is not proof of no website', () => {
  const r = auditGbp(g({ websiteUri: '', nationalPhoneNumber: '', regularOpeningHours: null, photoCount: 0, userRatingCount: 5, rating: 3.2 }), { industryId: 'interior-design', websiteKnown: false }, S);
  const by = Object.fromEntries(r.issues.map(i => [i.id, i.status]));
  assert.equal(by['gbp-no-phone'], 'Confirmed Issue'); assert.equal(by['gbp-no-hours'], 'Confirmed Issue'); assert.equal(by['gbp-no-photos'], 'Confirmed Issue');
  assert.equal(by['gbp-low-reviews'], 'Confirmed Issue'); assert.equal(by['gbp-low-rating'], 'Confirmed Issue');
  assert.equal(by['gbp-no-website'], 'Potential Improvement');
  const linked = auditGbp(g({ websiteUri: '' }), { websiteKnown: true, websiteUrl: 'https://x.example' }, S);
  assert.equal(linked.issues.find(i => i.id === 'gbp-website-not-linked').status, 'Confirmed Issue');
});
test('industry benchmarks are applied', () => {
  const r = auditGbp(g({ userRatingCount: 40 }), { industryId: 'restaurants-cafes' }, S); // benchmark 50
  assert.ok(r.issues.some(i => i.id === 'gbp-low-reviews'));
  assert.ok(!auditGbp(g({ userRatingCount: 40 }), { industryId: 'interior-design' }, S).issues.some(i => i.id === 'gbp-low-reviews'));
});
test('no Google profile or expired data → Not Available, no invented issues', () => {
  assert.equal(auditGbp(null, {}, S).status, 'Not Available');
  assert.equal(auditGbp({ placeId: 'p', expired: true }, {}, S).issues.length, 0);
});

// ---------- reviews ----------
test('review analysis is honest about sample size, authenticity and owner replies', () => {
  const r = analyzeReviews(g({ reviews: [
    { rating: 1, text: 'Waited an hour, very slow and late', publishTime: new Date().toISOString(), author: 'A' },
    { rating: 2, text: 'Long wait again, delay on delivery', publishTime: new Date().toISOString(), author: 'B' },
    { rating: 5, text: 'Friendly staff, excellent quality', publishTime: new Date().toISOString(), author: 'C' }] }), S);
  assert.equal(r.status, 'Analysed'); assert.equal(r.sampleSize, 3); assert.equal(r.confidence, 'Low');
  assert.match(r.authenticityNote, /not been independently verified/); assert.equal(r.ownerReplies.status, 'Not Available');
  assert.equal(r.repeatedComplaints[0].theme, 'Waiting time and speed');
  assert.ok(r.positiveThemes.some(t => t.theme === 'Staff and service'));
});
test('no reviews → no invented themes', () => {
  const r = analyzeReviews(g({ reviews: [], userRatingCount: 0 }), S);
  assert.equal(r.status, 'No reviews'); assert.deepEqual(r.negativeThemes, []);
});

// ---------- pitches ----------
test('pitches only for qualified leads, built from real findings, with opt-out and no guarantees', () => {
  const c = { name: 'Olive Interiors', industryName: 'Interior design', city: 'Dubai', contact: { website: 'https://olive.example' }, website: { domain: 'olive.example' },
    validation: { category: 'Qualified' }, issues: [{ id: 'no-meta-desc', status: 'Confirmed Issue', title: 'Missing meta description', detail: 'Search results will show auto-generated text.' }],
    services: [{ name: 'Technical SEO', group: 'search', reasons: ['Missing meta description'] }] };
  const p = generatePitches(c, S);
  for (const k of ['email', 'whatsapp', 'call', 'proposal', 'auditOffer']) { assert.ok(p[k].includes('Olive Interiors'), k); }
  assert.ok(p.email.includes('Missing meta description')); assert.ok(p.email.includes('Technical SEO'));
  assert.match(p.email, /unsubscribe/i); assert.match(p.whatsapp, /STOP/); assert.match(p.proposal, /no rankings, traffic or revenue outcomes are guaranteed/i);
  assert.doesNotMatch(p.email + p.proposal, /\d+%/); // no invented statistics
  assert.equal(generatePitches({ ...c, validation: { category: 'Unverified' } }, S), null);
});
