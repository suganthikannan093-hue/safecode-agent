import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SAFECODE_FORCE_MOCK = '1'; process.env.SANDBOX_MODE = 'none';
process.env.SAFECODE_ACCESS_TOKEN = 'api-test-token-not-a-deployment-secret';
process.env.SAFECODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'safecode-api-'));
const { server } = await import('../server/index.js');
let base;
before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(process.env.SAFECODE_DATA_DIR, { recursive: true, force: true }); });
const headers = { authorization: `Bearer ${process.env.SAFECODE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
test('all sensitive APIs require authentication including event streams and receipts', async () => {
  for (const path of ['/api/status', '/api/audit', '/api/events', '/api/history', '/api/stats', '/api/runs/x/receipt.json', '/api/receipt-key', '/api/controls']) assert.equal((await fetch(base + path)).status, 401, path);
  assert.equal((await fetch(base + '/api/upload?name=x.csv', { method: 'POST', body: 'a,b' })).status, 401);
});
test('login cookies unlock requests, cross-origin posts fail, logout revokes', async () => {
  const login = await post('/api/session', { token: process.env.SAFECODE_ACCESS_TOKEN }); const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/status', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/controls', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{"paused":true}' })).status, 403);
  await fetch(base + '/api/session', { method: 'DELETE', headers: { cookie } }); assert.equal((await fetch(base + '/api/status', { headers: { cookie } })).status, 401);
});
test('oversized JSON/CSV requests return 413 and service remains available', async () => {
  assert.equal((await post('/api/generate', { task: 'a'.repeat(100001) })).status, 413);
  assert.equal((await fetch(base + '/api/upload?name=x.csv', { method: 'POST', headers, body: 'a'.repeat(1048577) })).status, 413);
  assert.equal((await fetch(base + '/api/status', { headers })).status, 200);
});
test('pause rejects execution; disabled runtime fails closed and releases concurrency', async () => {
  const draft = await (await post('/api/generate', { task: 'sum' })).json();
  await post('/api/controls', { paused: true }); assert.equal((await post('/api/run', { id: draft.id })).status, 503);
  await post('/api/controls', { paused: false });
  const response = await (await post('/api/run', { id: draft.id, heal: false })).text(); assert.match(response, /No sandbox available/);
  const state = await (await fetch(base + '/api/controls', { headers })).json(); assert.deepEqual(state.active, []);
});
test('delete removes drafts and history, preserving budget counters', async () => {
  const draft = await (await post('/api/generate', { task: 'sum' })).json();
  assert.equal((await fetch(base + '/api/data', { method: 'DELETE', headers })).status, 200);
  assert.equal((await post('/api/run', { id: draft.id })).status, 400);
  assert.deepEqual(await (await fetch(base + '/api/history', { headers })).json(), []);
  assert.equal((await (await fetch(base + '/api/controls', { headers })).json()).attempts, 1);
});
test('chunked oversized body is rejected without buffering the rest', async () => {
  const { Readable } = await import('node:stream');
  const response = await fetch(base + '/api/generate', { method: 'POST', headers, duplex: 'half', body: Readable.from(['{"task":"', 'x'.repeat(60000), 'x'.repeat(60000), '"}']) });
  assert.equal(response.status, 413); assert.match((await response.json()).error, /too large/);
});
