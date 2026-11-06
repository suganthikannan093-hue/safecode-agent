import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signer, verifyReceipt } from '../server/receipts.js';
import { governor, access } from '../server/controls.js';
import { collectArtifacts, classify } from '../server/sandbox.js';
import { runWithHealing, buildReceipt, sha256 } from '../server/agent.js';
const temporary = fn => { const dir = mkdtempSync(join(tmpdir(), 'safecode-test-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
test('signed receipt survives key ordering, rejects modification, wrong key and unsigned records', () => temporary(dir => {
  const keys = generateKeyPairSync('ed25519'); const path = join(dir, 'key'); writeFileSync(path, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const s = signer(path); const receipt = s.seal({ id: 'one', output: { b: 2, a: 1 } });
  assert.equal(verifyReceipt(receipt, s.publicKey).valid, true);
  assert.equal(verifyReceipt({ ...receipt, output: { a: 1, b: 2 } }, s.publicKey).valid, true);
  assert.equal(verifyReceipt({ ...receipt, output: { a: 1, b: 3 } }, s.publicKey).valid, false);
  assert.equal(verifyReceipt(receipt, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })).valid, false);
  assert.equal(verifyReceipt(signer().seal({ id: 'one' }), s.publicKey).reason, 'unsigned');
}));
test('artifact collector rejects host symlinks, directories and oversized files', () => temporary(dir => {
  const out = join(dir, 'out'); mkdirSync(out); writeFileSync(join(dir, 'private'), 'HOST SECRET');
  symlinkSync(join(dir, 'private'), join(out, 'leak.svg')); mkdirSync(join(out, 'dir.png'));
  writeFileSync(join(out, 'large.png'), Buffer.alloc(3 * 1024 * 1024)); writeFileSync(join(out, 'ok.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const items = collectArtifacts(out); assert.deepEqual(items.map(x => x.name), ['ok.svg']); assert.doesNotMatch(JSON.stringify(items), /HOST SECRET/);
}));
test('printed error strings are explicitly untrusted inferences; timeout is observed separately', () => {
  const limits = classify({ stdout: 'MemoryError\nRead-only file system', stderr: '', exitCode: 0, timedOut: false, mode: { mode: 'docker' } });
  assert.equal(limits.find(l => l.id === 'memory').evidence, 'untrusted-output-inference');
  assert.equal(limits.find(l => l.id === 'timeout').triggered, false);
});
test('budgets count every attempt, survive restart, cancel active work and persist pause', () => temporary(dir => {
  const path = join(dir, 'budget'); process.env.SAFECODE_DAILY_ATTEMPTS = '2'; process.env.SAFECODE_CONCURRENCY = '1';
  try {
    const g = governor(path); const signal = g.begin('a'); assert.throws(() => g.begin('b'), /Concurrency/);
    g.consume('attempt'); g.consume('attempt'); assert.throws(() => g.consume('attempt'), /exhausted/);
    assert.equal(governor(path).snapshot().attempts, 2); g.pause(true); assert.equal(signal.aborted, true); g.finish('a');
    assert.throws(() => governor(path).begin('c'), /paused/); g.pause(false); const second = g.begin('b'); g.cancel('b'); assert.equal(second.aborted, true); g.finish('b');
  } finally { delete process.env.SAFECODE_DAILY_ATTEMPTS; delete process.env.SAFECODE_CONCURRENCY; }
}));
test('sessions require token, reject cross-origin mutation and revoke on logout', () => {
  process.env.SAFECODE_ACCESS_TOKEN = 'unit-test-token-not-a-deployment-secret';
  try { const a = access(); assert.equal(a.allowed({ headers: {} }), false); assert.throws(() => a.login('wrong'), /Invalid/);
    const cookie = a.login(process.env.SAFECODE_ACCESS_TOKEN).split(';')[0]; const req = { headers: { cookie } };
    assert.equal(a.allowed(req), true); a.logout(req); assert.equal(a.allowed(req), false);
    assert.throws(() => a.mutation({ method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost' } }), /Origin/);
  } finally { delete process.env.SAFECODE_ACCESS_TOKEN; }
});
const result = (exitCode = 0, contained = false) => ({ exitCode, contained, stdout: 'RESULTS_JSON={"total":42}', stderr: '', limits: [], resources: { memoryMb: 256 }, mode: { label: 'test fixture', production: false }, artifacts: [], lifecycle: { created: '2026-01-01', destroyed: '2026-01-02' }, sandboxId: 'fixture', durationMs: 1 });
test('healing is bounded and cancelled/containment runs never request a fix', async () => {
  let calls = 0;
  const run = await runWithHealing({ task: 'fixture', code: 'x', language: 'python', execute: async () => result(1), fix: async () => ({ code: 'x' + ++calls, provider: { model: 'fixture' } }) });
  assert.equal(run.attempts.length, 3);
  for (const r of [{ ...result(1), cancelled: true }, result(1, true)]) {
    let fixed = false; await runWithHealing({ task: 'fixture', code: 'x', language: 'python', execute: async () => r, fix: async () => { fixed = true; } }); assert.equal(fixed, false);
  }
});
test('receipt separates evidence limitations and retains output hashes', () => {
  const r = result(); const a = { code: 'print(42)', codeSha256: sha256('print(42)'), language: 'python', result: r };
  const rc = buildReceipt({ id: 'one', task: 'fixture', model: 'fixture', provider: 'fixture', run: { final: a, attempts: [a], healed: false } });
  assert.match(rc.evidence.results, /not independently/); assert.equal(rc.output.sha256, sha256(r.stdout + '\0')); assert.equal(rc.receipt, 'safecode-execution/v2');
});
test('signed records verify after JSON serialization omits optional fields', () => temporary(dir => {
  const { privateKey } = generateKeyPairSync('ed25519'); const path = join(dir, 'key'); writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const s = signer(path); const rc = JSON.parse(JSON.stringify(s.seal({ id: 'one', optional: undefined, nested: { optional: undefined, value: 42 } })));
  assert.equal(verifyReceipt(rc, s.publicKey).valid, true);
}));
