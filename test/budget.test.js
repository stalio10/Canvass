'use strict';
// Free-tier protection: Canvass must refuse Google Places requests beyond the configured limits, before sending them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../server/lib/db');
const engine = require('../server/lib/engine');
const places = require('../server/lib/places');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canvass-budget-'));
const placeOk = n => new Response(JSON.stringify({ places: Array.from({ length: 20 }, (_, i) => ({ id: `PLACE_${n}_${i}_abcdefgh`, displayName: { text: `Biz ${n}-${i}` }, businessStatus: 'CLOSED_PERMANENTLY' })), nextPageToken: 'more' }), { status: 200 });

test('requests stop at the monthly limit and nothing is sent beyond it', async () => {
  const store = new Store(tmp()); store.settings.budget = { enabled: true, placesMonthlyLimit: 3, placesDailyLimit: 100 };
  let sent = 0; global.fetch = async () => { sent++; return placeOk(sent); };
  for (let i = 0; i < 3; i++) await places.textSearch('KEY', { textQuery: 'x' });
  await assert.rejects(places.textSearch('KEY', { textQuery: 'x' }), e => e.code === 'BUDGET' && /Monthly Google Places limit reached \(3 of 3/.test(e.message));
  assert.equal(sent, 3, 'the 4th request was never sent');
  assert.equal(store.budgetStatus().used, 3);
});

test('daily limit is enforced separately', async () => {
  const store = new Store(tmp()); store.settings.budget = { enabled: true, placesMonthlyLimit: 1000, placesDailyLimit: 2 };
  let sent = 0; global.fetch = async () => { sent++; return placeOk(sent); };
  await places.textSearch('KEY', { textQuery: 'x' }); await places.textSearch('KEY', { textQuery: 'x' });
  await assert.rejects(places.textSearch('KEY', { textQuery: 'x' }), /Daily Google Places limit reached/);
  assert.equal(sent, 2);
});

test('failed requests also count, so the cap errs on the safe side', async () => {
  const store = new Store(tmp()); store.settings.budget = { enabled: true, placesMonthlyLimit: 5, placesDailyLimit: 5 };
  global.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 403 });
  await assert.rejects(places.textSearch('KEY', { textQuery: 'x' }), /bad key/);
  assert.equal(store.budgetStatus().used, 1);
});

test('other free services are never blocked by the Places limit', async () => {
  const store = new Store(tmp()); store.settings.budget = { enabled: true, placesMonthlyLimit: 0, placesDailyLimit: 0 };
  global.fetch = async () => new Response('{}', { status: 200 });
  const { httpFetch } = require('../server/lib/util');
  assert.equal((await httpFetch('https://rdap.example/x', { api: 'rdap' })).status, 200);
});

test('discovery refuses to start at the limit, and stops mid-search keeping what was found', async () => {
  const store = new Store(tmp()); store.settings.googlePlacesKey = 'KEY'; store.settings.runPageSpeed = false;
  const jobs = new engine.Jobs(store);
  store.settings.budget = { enabled: true, placesMonthlyLimit: 0, placesDailyLimit: 10 };
  assert.throws(() => engine.startDiscovery(store, jobs, { city: 'Dubai', industryId: 'interior-design', count: 5 }), /free-tier limit reached.*No requests were made/);
  store.settings.budget = { enabled: true, placesMonthlyLimit: 2, placesDailyLimit: 10 };
  let sent = 0; global.fetch = async () => { sent++; return placeOk(sent); };
  const job = engine.startDiscovery(store, jobs, { city: 'Dubai', industryId: 'interior-design', count: 50 });
  for (let i = 0; i < 400 && ['queued', 'running'].includes(jobs.get(job.id).status); i++) await new Promise(r => setTimeout(r, 25));
  const done = jobs.get(job.id);
  assert.equal(done.status, 'done'); assert.match(done.note, /Monthly Google Places limit reached/);
  assert.equal(sent, 2, 'exactly the allowed number of requests');
  assert.equal(store.allCompanies().length, 40, 'companies from the 2 allowed pages were still processed');
});

test('limits can be switched off deliberately', async () => {
  const store = new Store(tmp()); store.settings.budget = { enabled: false, placesMonthlyLimit: 0, placesDailyLimit: 0 };
  global.fetch = async () => placeOk(1);
  await places.textSearch('KEY', { textQuery: 'x' });
  assert.equal(store.budgetStatus().remaining, null);
});
