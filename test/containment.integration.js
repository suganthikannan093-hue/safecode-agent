import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execute, detectMode } from '../server/sandbox.js'; import { DEMOS } from '../server/demos.js'; import { scan } from '../server/policy.js';
const demo = id => DEMOS.find(d => d.id === id);
const trig = r => r.limits.filter(l => l.triggered).map(l => l.id);
const mode = detectMode();
test('a sandbox is available (never runs unsandboxed)', () => assert.notEqual(mode.mode, 'none'));
test('normal code runs and returns verified output', async () => {
  const r = await execute({ code: 'print(sum(range(101)))' });
  assert.equal(r.exitCode, 0); assert.equal(r.stdout.trim(), '5050'); assert.equal(r.contained, false);
});
test('bash works', async () => { const r = await execute({ language: 'bash', code: 'echo $((6*7))' }); assert.equal(r.stdout.trim(), '42'); });
test('rm -rf / is absorbed by read-only fs and host is intact', async () => {
  const r = await execute({ ...demo('rmrf') }); assert.ok(trig(r).some(t => ['readonly-fs', 'caps', 'non-root'].includes(t)), trig(r).join());
  assert.match(r.stdout, /still alive/);
});
test('fork bomb is stopped by pid limit', async () => { const r = await execute({ ...demo('fork') }); assert.ok(trig(r).includes('pids'), r.stdout + r.stderr); });
test('infinite loop is killed by timeout', async () => { const r = await execute({ ...demo('loop') }); assert.ok(r.timedOut); assert.ok(trig(r).includes('timeout')); assert.ok(r.durationMs < 9000); });
test('network exfiltration fails, and no secrets in sandbox env', async () => {
  process.env.FAKE_SECRET_KEY = 'sk-should-not-leak';
  const r = await execute({ ...demo('exfil') }); assert.ok(trig(r).includes('network'), r.stderr); assert.doesNotMatch(r.stdout + r.stderr, /should-not-leak|OPENAI|VULTR/);
});
// Image /etc/passwd is mode 0644 and contains "root:x:...:/root:". That file is not a host secret.
// Shadow and private keys must be unreadable, and no password hash or key body may appear.
test('/etc/shadow and ssh keys are not readable', async () => {
  const r = await execute({ ...demo('shadow') });
  assert.ok(trig(r).includes('secrets'));
  assert.match(r.stdout, /\/etc\/shadow -> (PermissionError|FileNotFoundError)/);
  assert.match(r.stdout, /\/root\/\.ssh\/id_rsa -> (PermissionError|FileNotFoundError)/);
  assert.doesNotMatch(r.stdout, /\$[1567]\$|\$y\$|BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY/);
});
test('memory bomb hits the memory cap', async () => { const r = await execute({ ...demo('mem') }); assert.ok(trig(r).includes('memory'), r.stderr.slice(-300)); assert.doesNotMatch(r.stdout, /allocated 4096 MB/); });
test('policy scan flags every escape demo', () => { for (const d of DEMOS) assert.notEqual(scan(d.code).findings.length, 0, d.id); assert.equal(scan('print(1+1)').risk, 'low'); });
