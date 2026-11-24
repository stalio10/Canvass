'use strict';
// HTTP API: security headers, key masking, pipeline rules, contact cooldown, exports, demo data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.CANVASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'canvass-api-'));
const { handle, store } = require('../server/index');
let base, server;
test.before(async () => { server = http.createServer(handle); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); clearTimeout(store.timer); });

const call = async (method, p, body, headers = { 'x-requested-with': 'canvass' }) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
};

test('write requests without the app header are refused (cross-site protection)', async () => {
  assert.equal((await call('POST', '/api/demo/load', null, {})).status, 403);
});
test('API keys are masked and never returned', async () => {
  const r = await call('PUT', '/api/settings', { googlePlacesKey: 'AIzaSECRETKEY1234' });
  assert.equal(r.status, 200); assert.equal(r.data.googlePlacesKey, '••••1234'); assert.equal(r.data.googlePlacesKeyConfigured, true);
  const again = await call('PUT', '/api/settings', { googlePlacesKey: '••••1234', eligibilityYears: 99 });
  assert.equal(again.data.eligibilityYears, 20, 'values are clamped'); assert.equal(store.settings.googlePlacesKey, 'AIzaSECRETKEY1234', 'masked value does not overwrite');
  await call('PUT', '/api/settings', { eligibilityYears: 5 });
  const bk = await call('GET', '/api/backup');
  assert.ok(!String(bk.data).includes('SECRETKEY'), 'backup download excludes keys');
});
test('demo data loads, is labelled, and powers the dashboard only in demo mode', async () => {
  const r = await call('POST', '/api/demo/load');
  assert.equal(r.data.loaded, 10);
  const d = await call('GET', '/api/dashboard');
  assert.equal(d.data.demoMode, true); assert.equal(d.data.totals.discovered, 10);
  assert.deepEqual(Object.keys(d.data.charts.validation).sort(), ['No Opportunity', 'Qualified', 'Rejected', 'Unverified']);
  const list = await call('GET', '/api/companies?category=all&size=50');
  assert.ok(list.data.items.every(c => c.name.startsWith('[DEMO]') && c.demo));
});
test('pipeline: only qualified leads, stage validation, notes and history', async () => {
  const list = (await call('GET', '/api/companies?category=Unverified')).data.items;
  const unv = list[0];
  assert.equal((await call('PATCH', '/api/companies/' + unv.id, { stage: 'Contacted' })).status, 400);
  const q = (await call('GET', '/api/companies?category=Qualified')).data.items[0];
  assert.equal(q.pipeline.inPipeline, true);
  assert.equal((await call('PATCH', '/api/companies/' + q.id, { stage: 'Nonsense' })).status, 400);
  const r = await call('PATCH', '/api/companies/' + q.id, { stage: 'Proposal sent', assignedTo: 'Member 1', followUpDate: '2026-12-01', note: 'Asked for pricing' });
  assert.equal(r.data.pipeline.stage, 'Proposal sent'); assert.equal(r.data.pipeline.notes.length, 1);
  assert.ok(r.data.pipeline.history.length >= 3);
  const pipe = await call('GET', '/api/companies?pipeline=1&category=all');
  assert.ok(pipe.data.items.every(c => c.pipeline.inPipeline));
});
test('contact log prevents duplicate messages and respects do-not-contact', async () => {
  const q = (await call('GET', '/api/companies?category=Qualified')).data.items[1];
  assert.equal((await call('POST', `/api/companies/${q.id}/contact-log`, { channel: 'email' })).status, 200);
  const dup = await call('POST', `/api/companies/${q.id}/contact-log`, { channel: 'email' });
  assert.equal(dup.status, 409); assert.match(dup.data.error, /Already contacted/);
  assert.equal((await call('POST', `/api/companies/${q.id}/contact-log`, { channel: 'email', force: true })).status, 200);
  await call('PATCH', '/api/companies/' + q.id, { doNotContact: true });
  assert.equal((await call('POST', `/api/companies/${q.id}/contact-log`, { channel: 'whatsapp' })).status, 409);
});
test('evidence requires a source and re-validates immediately', async () => {
  const c = (await call('GET', '/api/companies?category=Unverified&q=Nomad')).data.items[0];
  assert.equal((await call('POST', `/api/companies/${c.id}/evidence`, { type: 'establishment', date: '2024-01-10' })).status, 400);
  assert.equal((await call('POST', `/api/companies/${c.id}/evidence`, { type: 'establishment', date: '2999-01-01', source: 'Licence 1' })).status, 400);
  const r = await call('POST', `/api/companies/${c.id}/evidence`, { type: 'establishment', date: '2024-01-10', source: 'DEMO licence 555' });
  assert.equal(r.status, 200); assert.equal(r.data.age.status, 'Verified'); assert.equal(r.data.validation.category, 'Qualified');
  assert.equal(r.data.pipeline.inPipeline, true);
});
test('exports exclude Google content by default and produce CSV', async () => {
  const t = await call('GET', '/api/export?dataset=all');
  assert.ok(!t.data.header.includes('Google rating')); assert.match(t.data.note, /excluded/);
  await call('PUT', '/api/settings', { includeGoogleContentInExports: true });
  assert.ok((await call('GET', '/api/export?dataset=all')).data.header.includes('Google rating'));
  await call('PUT', '/api/settings', { includeGoogleContentInExports: false });
  const csv = await call('GET', '/api/export?dataset=qualified&format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(String(csv.data), /Company/);
});
test('clearing demo data turns demo mode off and leaves production figures empty', async () => {
  const r = await call('POST', '/api/demo/clear');
  assert.ok(r.data.removed >= 10);
  const d = await call('GET', '/api/dashboard');
  assert.equal(d.data.demoMode, false); assert.equal(d.data.totals.discovered, 0);
});
test('static files are served with a strict content security policy; path traversal blocked', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  const t = await fetch(base + '/..%2f..%2fpackage.json'); const body = await t.text();
  assert.ok(!body.includes('"name": "canvass'), 'no file outside public/');
});
