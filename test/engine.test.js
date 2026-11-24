'use strict';
// Engine integration: duplicate detection, bulk parsing, Google discovery with a mocked Places API, API failure handling,
// missing-information handling, pipeline transfer and Google data retention.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Website fetches in these tests go to fake domains; allow them without DNS (as if behind a proxy) and mock fetch.
process.env.NODE_USE_ENV_PROXY = '1'; process.env.HTTPS_PROXY = 'http://test-proxy.invalid';
const { Store } = require('../server/lib/db');
const engine = require('../server/lib/engine');
const places = require('../server/lib/places');
const { httpFetch } = require('../server/lib/util');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canvass-test-'));
const realFetch = global.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const iso = d => new Date(Date.now() - d * 86400000).toISOString();

function place(id, over = {}) {
  return { id: 'PLACE_' + id + '_abcdefgh', displayName: { text: over.name || 'Biz ' + id }, formattedAddress: `Office ${id}, Al Quoz, Dubai`, location: { latitude: 25, longitude: 55 },
    addressComponents: [{ longText: 'Al Quoz', types: ['sublocality'] }, { longText: 'Dubai', types: ['locality'] }, { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] }],
    googleMapsUri: 'https://maps.google.com/?cid=' + id, businessStatus: 'OPERATIONAL', nationalPhoneNumber: '04 555 00' + String(id).padStart(2, '0'),
    regularOpeningHours: { weekdayDescriptions: ['Mon 9-6'] }, rating: 4.5, userRatingCount: 8, reviews: [{ rating: 5, text: { text: 'Great team' }, publishTime: iso(20) }],
    photos: [{}], primaryType: 'interior_designer', types: ['interior_designer', 'point_of_interest'], ...over };
}

function mockNetwork(placesPages, { sites = {} } = {}) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('places.googleapis.com')) {
      const body = JSON.parse(init.body || '{}');
      const pageIdx = body.pageToken ? Number(body.pageToken) : 0;
      const page = typeof placesPages === 'function' ? placesPages(body) : placesPages[pageIdx];
      if (page instanceof Response) return page;
      return json({ places: page || [], ...(placesPages[pageIdx + 1] ? { nextPageToken: String(pageIdx + 1) } : {}) });
    }
    if (u.includes('generate_204')) return new Response(null, { status: 204 });
    if (u.includes('rdap.org')) return json({ events: [{ eventAction: 'registration', eventDate: iso(700) }] });
    if (u.includes('web.archive.org')) return json([['timestamp', 'original'], [new Date(Date.now() - 650 * 86400000).toISOString().slice(0, 10).replace(/-/g, '') + '000000', 'http://x']]);
    if (u.includes('pagespeedonline')) return json({ error: { message: 'Quota exceeded' } }, 429);
    for (const [host, body] of Object.entries(sites)) if (u.includes(host)) return typeof body === 'number' ? html('', body) : html(body);
    return html('', 404);
  };
  return calls;
}
const settingsFor = store => { store.settings.googlePlacesKey = 'TEST_KEY'; store.settings.runPageSpeed = false; store.settings.brokenLinkSample = 0; store.settings.concurrency = 2; return store.settings; };
async function waitJob(jobs, id) { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (!['queued', 'running'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 25)); } throw new Error('job timeout'); }

test.afterEach(() => { global.fetch = realFetch; });

test('bulk input parsing: headers, aliases, plain URL lists, Maps links', () => {
  const rows = engine.normalizeBulkInput({ rows: [['Company Name', 'Website URL', 'Phone Number', 'Google Maps Link'], ['Olive LLC', 'olive.ae', '050', ''], ['', '', '', 'https://maps.app.goo.gl/abc'], ['', '', '', '']] });
  assert.equal(rows.length, 2); assert.equal(rows[0].name, 'Olive LLC'); assert.equal(rows[0].website, 'olive.ae'); assert.equal(rows[1].mapsLink, 'https://maps.app.goo.gl/abc');
  const lines = engine.normalizeBulkInput({ text: 'https://a.ae\nBeta Trading\nhttps://www.google.com/maps/place/Gamma+Cafe/@25.1,55.2,17z\ninstagram.com/foo' });
  assert.deepEqual(lines.map(r => Object.keys(r)[0]), ['website', 'name', 'mapsLink', 'name']);
  assert.equal(places.parseMapsLink('https://www.google.com/maps/place/Gamma+Cafe/@25.1,55.2,17z').name, 'Gamma Cafe');
  assert.equal(places.parseMapsLink('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJabc123xyz').placeId, 'ChIJabc123xyz');
});

test('duplicate detection by Place ID, domain, phone, name+location and name↔domain', () => {
  const store = new Store(tmp());
  const a = engine.newRecord({ name: 'Olive Interiors LLC', city: 'Dubai' });
  a.google = { placeId: 'P1' }; a.contact = { phone: '+971 50 123 4567', website: 'https://www.oliveinteriors.ae/' }; a.website = { domain: 'oliveinteriors.ae' };
  store.put(a);
  const cand = over => Object.assign(engine.newRecord({ name: 'Other', city: 'Dubai' }), over);
  assert.equal(store.findDuplicate(cand({ google: { placeId: 'P1' } })).by, 'Google Place ID');
  assert.equal(store.findDuplicate(cand({ contact: { website: 'http://oliveinteriors.ae/about' } })).by, 'website domain');
  assert.equal(store.findDuplicate(cand({ contact: { phone: '050 123 4567' } })).by, 'phone number');
  assert.equal(store.findDuplicate(cand({ name: 'OLIVE INTERIORS L.L.C' })).by, 'business name and location');
  assert.equal(store.findDuplicate(cand({ name: 'Olive Interiors', city: 'Sharjah' })).by, 'business name matches website domain');
  assert.equal(store.findDuplicate(cand({ name: 'Different Co', contact: { phone: '04 999 1111' } })), null);
});

test('Google discovery end-to-end with mocked Places API: pagination, dedupe, validation, pipeline transfer', async () => {
  const store = new Store(tmp()); settingsFor(store);
  const jobs = new engine.Jobs(store);
  const site = '<html><head><title>Biz</title><meta name="viewport" content="width=device-width"></head><body><h1>Biz</h1></body></html>';
  const calls = mockNetwork([
    [place(1, { websiteUri: 'https://biz1.example/' }), place(2), place(3, { businessStatus: 'CLOSED_PERMANENTLY' })],
    [place(4, { formattedAddress: 'Corniche, Abu Dhabi', addressComponents: [{ longText: 'Abu Dhabi', types: ['locality'] }, { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] }] }),
      place(5, { userRatingCount: 4000 }), place(1)]
  ], { sites: { 'biz1.example': site } });
  // a documented age for company 2 cannot exist yet (new search) — expect Unverified for age except none
  const job = engine.startDiscovery(store, jobs, { city: 'Dubai', country: 'United Arab Emirates', industryId: 'interior-design', count: 10 });
  const done = await waitJob(jobs, job.id);
  assert.equal(done.status, 'done', done.error);
  const all = store.allCompanies();
  assert.equal(all.length, 5, 'place 1 appears twice but is stored once');
  const byName = n => all.find(c => c.name === n);
  assert.equal(byName('Biz 3').validation.category, 'Rejected'); assert.match(byName('Biz 3').validation.reasons[0], /Closed permanently/);
  assert.equal(byName('Biz 4').validation.category, 'Rejected'); assert.match(byName('Biz 4').validation.reasons.join(), /outside Dubai/);
  assert.equal(byName('Biz 5').validation.category, 'Rejected'); assert.match(byName('Biz 5').validation.reasons.join(), /large/);
  // Without a documented establishment date, age stays unverified → not in pipeline (honest default)
  assert.equal(byName('Biz 1').validation.category, 'Unverified');
  assert.equal(byName('Biz 1').pipeline.inPipeline, false);
  assert.ok(byName('Biz 1').age.evidence.some(e => e.kind === 'domain'), 'RDAP evidence recorded with source');
  assert.ok(calls.some(u => u.includes('places.googleapis.com')));
  assert.equal(store.state.searches.length, 1);
  // Team adds a documented licence date → re-validated → qualified → transferred automatically
  const c = byName('Biz 1');
  c.manual.establishment = { date: new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10), source: 'DED licence 123', enteredAt: new Date().toISOString() };
  await engine.processCompany(c, { settings: store.settings, offline: true });
  assert.equal(c.validation.category, 'Qualified', c.validation.reasons.join());
  assert.equal(c.pipeline.inPipeline, true); assert.equal(c.pipeline.stage, 'New');
  assert.ok(c.pitch.email.includes('Biz 1'));
});

test('accepting consistent estimates qualifies companies without manual dates', async () => {
  const store = new Store(tmp()); settingsFor(store); store.settings.acceptEstimatedAge = true;
  const jobs = new engine.Jobs(store);
  mockNetwork([[place(7, { websiteUri: 'https://biz7.example/' })]], { sites: { 'biz7.example': '<html><body>tiny</body></html>' } });
  const job = engine.startDiscovery(store, jobs, { city: 'Dubai', industryId: 'interior-design', count: 1 });
  await waitJob(jobs, job.id);
  const c = store.allCompanies()[0];
  assert.equal(c.age.status, 'Estimated'); assert.equal(c.age.acceptedEstimate, true);
  assert.equal(c.validation.category, 'Qualified'); assert.equal(c.pipeline.inPipeline, true);
});

test('Places API failure stops the job with a clear message and stores nothing fake', async () => {
  const store = new Store(tmp()); settingsFor(store);
  const jobs = new engine.Jobs(store);
  mockNetwork(() => json({ error: { message: 'API key not valid' } }, 403));
  const job = engine.startDiscovery(store, jobs, { city: 'Dubai', industryId: 'interior-design', count: 5 });
  const done = await waitJob(jobs, job.id);
  assert.equal(done.status, 'failed'); assert.match(done.error, /API key not valid/); assert.match(done.error, /Places API \(New\) is enabled/);
  assert.equal(store.allCompanies().length, 0);
});

test('discovery refuses to start without an API key', () => {
  const store = new Store(tmp()); const jobs = new engine.Jobs(store);
  assert.throws(() => engine.startDiscovery(store, jobs, { city: 'Dubai', industryId: 'interior-design' }), /Google Places API key/);
});

test('HTTP retries on 429 then succeeds', async () => {
  let n = 0;
  global.fetch = async () => (++n < 2 ? new Response('busy', { status: 429, headers: { 'retry-after': '0' } }) : json({ ok: true }));
  const res = await httpFetch('https://api.example/x', { api: 'rdap', retries: 2 });
  assert.equal(res.status, 200); assert.equal(n, 2);
});

test('private network addresses are blocked (SSRF guard)', async () => {
  delete process.env.NODE_USE_ENV_PROXY;
  await assert.rejects(httpFetch('http://127.0.0.1/admin', { guard: true, retries: 0 }), /Private/);
  await assert.rejects(httpFetch('http://localhost:4321/api', { guard: true, retries: 0 }), /Private/);
  await assert.rejects(httpFetch('file:///etc/passwd', { guard: true, retries: 0 }), /http/);
  process.env.NODE_USE_ENV_PROXY = '1';
});

test('bulk upload without Google key: missing information stays Unverified, never invented', async () => {
  const store = new Store(tmp()); settingsFor(store); store.settings.googlePlacesKey = '';
  const jobs = new engine.Jobs(store);
  mockNetwork([], { sites: { 'shop.example': '<html><head><title>Shop</title></head><body><a href="mailto:info@shop.example">mail</a></body></html>' } });
  const job = engine.startBulk(store, jobs, { rows: [['Company', 'Website'], ['Shop One', 'https://shop.example'], ['Shop One', 'shop.example'], ['Name Only Co', '']], fileName: 'test.xlsx' });
  const done = await waitJob(jobs, job.id);
  assert.equal(done.counts.Duplicates, 1, 'same company repeated in the file');
  const list = store.allCompanies();
  assert.equal(list.length, 2);
  for (const c of list) { assert.equal(c.validation.category, 'Unverified'); assert.equal(c.pipeline.inPipeline, false); assert.equal(c.google, null); assert.equal(c.pitch, null); }
  const shop = list.find(c => c.name === 'Shop One');
  assert.equal(shop.contact.email, 'info@shop.example'); assert.equal(shop.contactSources.email, 'Website: shop.example');
  const nameOnly = list.find(c => c.name === 'Name Only Co');
  assert.equal(nameOnly.websiteStatus, 'Not found'); assert.equal(nameOnly.age.status, 'Not Available');
  assert.equal(nameOnly.issues.find(i => i.id === 'no-website-found').status, 'Potential Improvement', 'missing data is not a confirmed issue');
});

test('Google content is purged after the retention period; Place ID kept', () => {
  const store = new Store(tmp());
  const c = engine.newRecord({ name: 'Old' });
  engine.mergeGoogle(c, places.toGoogleBlock(place(9)));
  c.google.fetchedAt = new Date(Date.now() - 31 * 86400000).toISOString();
  store.put(c);
  assert.equal(store.purgeExpiredGoogleData(), 1);
  const after = store.get(c.id);
  assert.equal(after.google.placeId, 'PLACE_9_abcdefgh'); assert.equal(after.google.rating, undefined); assert.equal(after.google.reviews, undefined);
  assert.equal(after.contact.phone, undefined, 'Google-only phone removed'); assert.equal(after.google.expired, true);
});

test('backups exclude API keys and restore round-trips', () => {
  const store = new Store(tmp()); store.settings.googlePlacesKey = 'SECRET';
  store.put(engine.newRecord({ name: 'Keep me' }));
  const exported = store.exportForBackup();
  assert.equal(exported.settings.googlePlacesKey, '');
  const other = new Store(tmp()); other.settings.googlePlacesKey = 'MINE';
  assert.equal(other.restore(JSON.stringify(exported)), 1);
  assert.equal(other.settings.googlePlacesKey, 'MINE', 'restore keeps this PC’s key');
  assert.throws(() => other.restore('{"nope":1}'), /Not a Canvass/);
});
