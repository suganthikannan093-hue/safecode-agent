import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
process.env.NODE_ENV = 'development'; process.env.SAFECODE_ACCESS_TOKEN_FILE = ''; process.env.SAFECODE_ACCESS_TOKEN = '';
process.env.SAFECODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'safecode-integration-'));
// HTTP-level test in offline-mock mode (no LLM calls, no credit spent).
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
delete process.env.VULTR_INFERENCE_API_KEY; delete process.env.OPENAI_API_KEY; process.env.SAFECODE_FORCE_MOCK = '1';
const { server } = await import('../server/index.js');
let base; before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }))); after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(process.env.SAFECODE_DATA_DIR, { recursive: true, force: true }); });
const post = (p, b, h = { 'content-type': 'application/json' }) => fetch(base + p, { method: 'POST', headers: h, body: typeof b === 'string' || Buffer.isBuffer(b) ? b : JSON.stringify(b) });
const runAll = async id => (await (await post('/api/run', { id })).text()).trim().split('\n').map(JSON.parse);
test('upload is size-capped and CSV-only', async () => {
  assert.equal((await post('/api/upload?name=x.csv', Buffer.alloc(1024 * 1024 + 10, 97), { 'content-type': 'text/csv' })).status, 413);
  assert.equal((await post('/api/upload?name=x.exe', 'a,b', { 'content-type': 'text/csv' })).status, 400);
});
test('CSV -> chart + verified numbers + downloadable receipt + live stats', async () => {
  const up = await (await post('/api/upload?name=sales.csv', 'region,revenue\nnorth,10\nsouth,5\n', { 'content-type': 'text/csv' })).json();
  const g = await (await post('/api/generate', { task: 'chart it', fileId: up.fileId })).json();
  const ev = await runAll(g.id); const r = ev.at(-1);
  assert.equal(r.type, 'result'); assert.equal(r.exitCode, 0); assert.equal(r.artifacts.length, 1); assert.deepEqual(r.verified.totals, { north: 10, south: 5 });
  const rc = await (await fetch(base + r.receipt.json)).json(); assert.equal(rc.inputs[0].sha256, up.sha256);
  const html = await fetch(base + r.receipt.html + '?download'); assert.match(html.headers.get('content-disposition'), /attachment/); assert.match(await html.text(), /execution receipt/);
  const st = await (await fetch(base + '/api/stats')).json(); assert.ok(st.runs >= 1 && st.success >= 1);
});
test('self-heal demo heals in 2 attempts over HTTP', async () => {
  const s = await (await fetch(base + '/api/status')).json();
  const g = await (await post('/api/generate', { task: s.healDemo.task })).json();
  const ev = await runAll(g.id); const r = ev.at(-1);
  assert.equal(ev.filter(e => e.type === 'attempt').length, 2); assert.equal(r.healed, true); assert.equal(r.exitCode, 0);
  const audit = await (await fetch(base + '/api/audit')).json(); assert.ok(audit.filter(a => a.event === 'run.attempt' && a.id === ev.find(e => e.type === 'start').id).length === 2);
});
test('SSE dashboard stream sends stats', async () => {
  const ac = new AbortController(); const res = await fetch(base + '/api/events', { signal: ac.signal });
  const { value } = await res.body.getReader().read(); ac.abort(); assert.match(new TextDecoder().decode(value), /event: stats/);
});
test('running a draft twice retains two distinct receipts', async () => {
  const d = await (await post('/api/generate', { task: 'sum' })).json();
  const first = (await runAll(d.id)).at(-1); const second = (await runAll(d.id)).at(-1);
  assert.equal(first.type, 'result'); assert.equal(second.type, 'result'); assert.notEqual(first.receipt.json, second.receipt.json);
  assert.equal((await fetch(base + first.receipt.json)).status, 200); assert.equal((await fetch(base + second.receipt.json)).status, 200);
});
