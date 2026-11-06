import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const config = new URL('../server/config.js', import.meta.url).href;
const probe = env => execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(config)}); process.stdout.write(JSON.stringify(process.env.VULTR_INFERENCE_API_KEY ?? null))`], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const temporary = fn => { const dir = mkdtempSync(join(tmpdir(), 'safecode-cfg-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
test('VULTR_INFERENCE_API_KEY_FILE loads trimmed key from file', () => temporary(dir => {
  const f = join(dir, 'k'); writeFileSync(f, '  file-key-123\n', { mode: 0o600 });
  assert.equal(JSON.parse(probe({ VULTR_INFERENCE_API_KEY_FILE: f })), 'file-key-123');
}));
test('inline VULTR_INFERENCE_API_KEY takes precedence over _FILE', () => temporary(dir => {
  const f = join(dir, 'k'); writeFileSync(f, 'file-key');
  assert.equal(JSON.parse(probe({ VULTR_INFERENCE_API_KEY: 'inline', VULTR_INFERENCE_API_KEY_FILE: f })), 'inline');
}));
test('missing key file fails startup without echoing contents', () => {
  assert.throws(() => probe({ VULTR_INFERENCE_API_KEY_FILE: '/nonexistent/safecode-key' }));
});
