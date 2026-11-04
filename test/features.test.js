import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execute } from '../server/sandbox.js';
import { runWithHealing, buildReceipt, createStats, healable, MAX_ATTEMPTS, verifiedNumbers } from '../server/agent.js';
import { DEMOS, HEAL_DEMO, MOCK_CSV_CODE } from '../server/demos.js';
const sha = d => createHash('sha256').update(d).digest('hex');
const CSV = 'region,revenue\nnorth,120\nsouth,80\nnorth,200\neast,50\n';

test('CSV is mounted read-only and chart artifacts are collected, then destroyed', async () => {
  const r = await execute({ code: MOCK_CSV_CODE('sales.csv') + '\ntry:\n    open("/work/input/sales.csv","w")\nexcept OSError as e: print("ro:", e.errno)', inputs: [{ name: 'sales.csv', data: Buffer.from(CSV) }] });
  assert.equal(r.exitCode, 0, r.stderr); assert.match(r.stdout, /ro: 30/);
  assert.deepEqual(verifiedNumbers(r.stdout).totals, { north: 320, south: 80, east: 50 });
  assert.equal(r.artifacts.length, 1); assert.equal(r.artifacts[0].mime, 'image/svg+xml'); assert.match(r.artifacts[0].dataUrl, /^data:image\/svg\+xml;base64,/);
  assert.ok(r.lifecycle.created <= r.lifecycle.started && r.lifecycle.finished <= r.lifecycle.destroyed); assert.match(r.sandboxId, /^safecode-/);
});
test('oversized input is refused before execution', async () => {
  await assert.rejects(execute({ code: 'print(1)', inputs: [{ name: 'big.csv', data: Buffer.alloc(2 * 1024 * 1024, 97) }] }), /exceeds/);
});
test('CSV run still has no network and no secrets', async () => {
  process.env.FAKE_SECRET_KEY = 'sk-nope';
  const r = await execute({ code: 'import os,socket\nprint(sorted(os.environ))\nsocket.create_connection(("1.1.1.1",80),timeout=2)', inputs: [{ name: 'a.csv', data: Buffer.from(CSV) }] });
  assert.doesNotMatch(r.stdout, /FAKE_SECRET|OPENAI|VULTR/); assert.ok(r.limits.find(l => l.id === 'network').triggered);
});
test('self-heal: failing code is fixed and re-run in a FRESH sandbox', async () => {
  const logs = []; const events = [];
  const run = await runWithHealing({ task: HEAL_DEMO.task, code: HEAL_DEMO.code, language: 'python', execute,
    fix: async () => ({ code: HEAL_DEMO.fixed, language: 'python', explanation: 'fixed key + types', provider: { model: 'test' } }),
    onEvent: e => events.push(e.type), log: (e, x) => logs.push([e, x]) });
  assert.equal(run.attempts.length, 2); assert.equal(run.healed, true);
  assert.notEqual(run.attempts[0].result.exitCode, 0); assert.match(run.attempts[0].result.stderr, /KeyError/);
  assert.match(run.final.result.stdout, /north 160/);
  assert.notEqual(run.attempts[0].result.sandboxId, run.attempts[1].result.sandboxId);
  assert.equal(logs.filter(([e]) => e === 'run.attempt').length, 2); assert.ok(events.includes('healing'));
});
test('self-heal is capped at 3 attempts', async () => {
  let n = 0; const run = await runWithHealing({ task: 't', code: 'raise SystemExit(3)', language: 'python', execute, fix: async () => ({ code: `raise SystemExit(${4 + n++})`, provider: {} }) });
  assert.equal(run.attempts.length, MAX_ATTEMPTS); assert.equal(run.healed, false);
});
test('contained attacks are never sent for "healing"', async () => {
  let called = false; const d = DEMOS.find(x => x.id === 'exfil');
  const run = await runWithHealing({ task: d.task, code: d.code, language: 'python', execute, fix: async () => { called = true; return null; } });
  assert.equal(called, false); assert.equal(run.attempts.length, 1); assert.equal(healable(run.final.result), false);
});
test('proof receipt has hashes, limits, lifecycle, containment and model', async () => {
  const inputs = [{ name: 'sales.csv', data: Buffer.from(CSV) }];
  const run = await runWithHealing({ task: 'sum', code: MOCK_CSV_CODE('sales.csv'), language: 'python', inputs, execute, fix: async () => null });
  const rc = buildReceipt({ id: 'r1', task: 'sum', provider: 'Offline mock', model: 'offline-mock', inputs, run });
  assert.equal(rc.code.sha256, sha(rc.code.source)); assert.equal(rc.inputs[0].sha256, sha(CSV));
  assert.equal(rc.output.sha256, sha(rc.output.stdout + '\u0000' + rc.output.stderr));
  assert.equal(rc.resourceLimits.memoryMb, 256); assert.ok(rc.sandbox.id && rc.sandbox.lifecycle.destroyed); assert.equal(rc.model.model, 'offline-mock');
  assert.equal(rc.output.artifacts.length, 1); assert.ok(Array.isArray(rc.containment.events));
});
test('stats bucket attacks by type and count outcomes', async () => {
  const s = createStats(); const mk = (exitCode, trig = []) => ({ attempts: [{ result: { lifecycle: { created: '2026-01-01T00:00:00.000Z', destroyed: '2026-01-01T00:00:00.100Z' } } }], healed: false,
    final: { result: { exitCode, contained: trig.length > 0, sandboxId: 'x', limits: trig.map(id => ({ id, triggered: true })) } } });
  s.record(mk(0), 'ok'); s.record(mk(1), 'bad'); s.record(mk(1, ['pids']), 'fork'); s.record(mk(1, ['readonly-fs', 'caps']), 'rm'); s.record(mk(137, ['timeout']), 'loop');
  const x = s.snapshot(); assert.equal(x.runs, 5); assert.equal(x.success, 1); assert.equal(x.failed, 1); assert.equal(x.contained, 3);
  assert.deepEqual(x.attacks, { pids: 1, network: 0, fs: 1, timeout: 1, memory: 0 }); assert.equal(x.avgSandboxLifetimeMs, 100);
});
