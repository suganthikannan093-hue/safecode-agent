// Runs against a disposable, operator-controlled demo workspace. Never executes code on this host.
import '../server/config.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { verifyReceipt } from '../server/receipts.js';
const base = process.env.SAFECODE_URL || 'http://127.0.0.1:4321';
const token = process.env.SAFECODE_ACCESS_TOKEN_FILE ? readFileSync(process.env.SAFECODE_ACCESS_TOKEN_FILE, 'utf8').trim() : process.env.SAFECODE_ACCESS_TOKEN;
const headers = token ? { authorization: `Bearer ${token}` } : {};
const results = []; const output = process.env.SAFECODE_DEMO_OUTPUT || 'data/demo-evidence';
mkdirSync(output, { recursive: true });
async function request(path, data, method) {
  const r = await fetch(base + path, { headers: { ...headers, 'content-type': 'application/json' }, method: method || (data === undefined ? 'GET' : 'POST'), body: data === undefined ? undefined : JSON.stringify(data) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`); return r.json();
}
const live = x => x?.source === 'live-inference' && typeof x.responseId === 'string' && x.responseId.length > 0 && x.finishReason === 'stop' && x.contentLength > 0;
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function scenario(name, fn) {
  try { const evidence = await fn(); results.push({ name, status: 'passed', evidence }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, status: 'failed', error: e.message }); console.error(`FAIL ${name}: ${e.message}`); }
}
async function run(draft, options = {}, started) {
  const res = await fetch(base + '/api/run', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: draft.id, ...options }) });
  if (!res.ok) throw new Error(`Run HTTP ${res.status}: ${await res.text()}`);
  let buffer = ''; const events = [];
  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString(); let i;
    while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line) continue; const e = JSON.parse(line); events.push(e); if (e.type === 'start' && started) await started(e.id); }
  }
  const last = events.at(-1); check(last?.type === 'result', last?.error || 'Run has no result');
  const receipt = await request(last.receipt.json); writeFileSync(`${output}/${receipt.runId}.json`, JSON.stringify(receipt, null, 2));
  return { ...last, receiptRecord: receipt, events };
}
try {
  const status = await request('/api/status');
  check(status.sandbox.mode !== 'none', 'No sandbox. Run this suite against the prepared Linux VM; no host fallback exists.');
  check(!status.controls.paused, 'Workspace paused; operator must resume before demo');
  if (process.argv.includes('--competition')) {
    check(status.sandbox.runtime === 'runsc', 'Competition recording profile requires runsc');
    check(status.llm.provider === 'vultr', 'Competition profile requires live Vultr inference');
    check(status.signedReceipts && status.accessRequired, 'Competition profile requires signatures and access control');
  }
  let csvRun, draft;
  await scenario('authenticated access', async () => {
    check(status.accessRequired, 'Configure access token to demonstrate protection');
    check((await fetch(base + '/api/audit')).status === 401, 'Anonymous audit access succeeded'); return 'Anonymous API request rejected';
  });
  await scenario('CSV analysis, chart and independent expected answer', async () => {
    const upload = await fetch(base + '/api/upload?name=sales.csv', { method: 'POST', headers, body: readFileSync(new URL('../docs/demo-sales.csv', import.meta.url)) });
    check(upload.ok, 'Upload failed'); const file = await upload.json();
    draft = await request('/api/generate', { task: 'Sum revenue by region. Use csv.DictReader. Print RESULTS_JSON with a totals object. Draw an SVG chart in /work/out/chart.svg.', fileId: file.fileId });
    if (process.argv.includes('--competition')) check(live(draft.inference), 'CSV lacks completed live inference provenance');
    csvRun = await run(draft, { heal: false }); check(csvRun.exitCode === 0, csvRun.stderr);
    const totals = csvRun.verified?.totals; check(totals?.north === 320 && totals?.south === 80 && totals?.east === 50, 'Result does not match independently specified fixture totals');
    check(csvRun.artifacts.length > 0, 'No chart returned'); return { runId: csvRun.receiptRecord.runId, expected: { north: 320, south: 80, east: 50 } };
  });
  await scenario('receipt signature and tamper rejection', async () => {
    check(csvRun, 'CSV scenario required');
    const keyPath = process.env.SAFECODE_TRUSTED_PUBLIC_KEY_FILE;
    check(keyPath, 'Set SAFECODE_TRUSTED_PUBLIC_KEY_FILE to an independently distributed public key');
    const key = readFileSync(keyPath, 'utf8'); check(verifyReceipt(csvRun.receiptRecord, key).valid, 'Signature failed');
    const changed = structuredClone(csvRun.receiptRecord); changed.output.stdout += 'tampered'; check(!verifyReceipt(changed, key).valid, 'Tampering was accepted'); return 'Original accepted; tampered copy rejected';
  });
  await scenario('repeated draft preserves distinct receipts', async () => {
    check(csvRun && draft, 'CSV scenario required'); const second = await run(draft, { heal: false });
    check(second.receiptRecord.runId !== csvRun.receiptRecord.runId, 'Execution ID reused');
    check((await request(csvRun.receipt.json)).runId === csvRun.receiptRecord.runId, 'Original receipt lost'); return { first: csvRun.receiptRecord.runId, second: second.receiptRecord.runId };
  });
  await scenario('self-healing in a fresh sandbox', async () => {
    const d = await request('/api/generate', { task: status.healDemo.task }); const r = await run(d, { heal: true });
    check(r.healed && r.attempts >= 2, 'Healing unavailable or unsuccessful; check output-sharing setting and inference');
    if (process.argv.includes('--competition')) check(r.receiptRecord.selfHeal.timeline.slice(1).some(t => t.model?.provider === 'vultr' && live(t.model?.inference)), 'Repair lacks completed live inference provenance');
    const ids = r.receiptRecord.selfHeal.timeline.map(t => t.sandboxId); check(new Set(ids).size === ids.length, 'Sandbox reused'); return { runId: r.receiptRecord.runId, attempts: r.attempts };
  });
  const presetControl = { rmrf: ['readonly-fs', 'caps', 'non-root'], fork: ['pids'], loop: ['timeout'], exfil: ['network'], shadow: ['secrets'], mem: ['memory'] };
  for (const demo of status.demos) await scenario(`control preset: ${demo.id}`, async () => {
    const d = await request('/api/generate', { task: demo.task }); const r = await run(d, { heal: false });
    const got = r.limits.filter(l => l.triggered).map(l => l.id);
    const want = presetControl[demo.id];
    check(want ? want.some(id => got.includes(id)) : got.length > 0, `Expected ${want ? want.join('|') : 'a control'}; got ${got.join(',') || 'none'}`);
    check(r.attempts === 1, 'Preset retried unexpectedly');
    return { runId: r.receiptRecord.runId, evidence: r.receiptRecord.containment.events, limitation: 'Controller-observed events are runtime telemetry. Output-derived signals are not independent enforcement proof.' };
  });
  await scenario('spoofed error remains labelled as inference', async () => {
    const d = await request('/api/generate', { task: 'Print a diagnostic' }); const r = await run(d, { code: 'print("MemoryError")', language: 'python', heal: false });
    const memory = r.receiptRecord.containment.events.find(e => e.id === 'memory'); check(r.exitCode === 0 && memory?.evidence === 'untrusted-output-inference', 'Evidence classification incorrect'); return r.receiptRecord.runId;
  });
  await scenario('active execution cancellation', async () => {
    const d = await request('/api/generate', { task: 'Print a diagnostic' });
    const r = await run(d, { code: 'while True: pass', language: 'python', heal: false }, id => new Promise((resolve, reject) => setTimeout(() => { request('/api/cancel', { id }).then(resolve, reject); }, 500)));
    check(r.cancelled, 'Cancellation not recorded'); return r.receiptRecord.runId;
  });
  await scenario('budgets and live dashboard', async () => { const c = await request('/api/controls'); const s = await request('/api/stats'); check(c.attempts >= s.runs && c.active.length === 0, 'Budget/activity accounting mismatch'); return { attempts: c.attempts, runs: s.runs, active: c.active.length }; });
  // Pause is restored even on a failed assertion. No stored-data deletion is performed by this runner.
  await scenario('operator pause blocks new work', async () => {
    const d = await request('/api/generate', { task: 'Print a diagnostic' });
    try { await request('/api/controls', { paused: true }); const r = await fetch(base + '/api/run', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id }) }); check(r.status === 503, 'Paused run was admitted'); }
    finally { await request('/api/controls', { paused: false }); } return 'New execution rejected while paused';
  });
} catch (e) { results.push({ name: 'preflight', status: 'failed', error: e.message }); console.error(e.message); }
writeFileSync(`${output}/report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), base, results, limitations: 'Scripted functional demonstrations, not independent escape or multitenant isolation testing.' }, null, 2));
console.log(`Evidence: ${output}/report.json`); process.exitCode = results.some(r => r.status === 'failed') ? 1 : 0;
