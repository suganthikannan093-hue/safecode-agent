// Agent run loop: execute -> (on failure) self-heal with the model -> re-run in a FRESH sandbox, max 3 attempts.
// Also builds the proof receipt and the live safety stats. Pure functions + injected deps so it is unit-testable.
import { createHash } from 'node:crypto';
import { scan } from './policy.js';
export const MAX_ATTEMPTS = 3;
export const sha256 = d => createHash('sha256').update(d).digest('hex');

// A run is healable only if it failed on its own (bug), NOT if a containment limit fired:
// we never ask the model to "fix" code so it gets past the sandbox.
export const healable = r => r.exitCode !== 0 && !r.contained;

export async function runWithHealing({ task, code, language, inputs = [], file, heal = true, execute, fix, onEvent = () => {}, log = () => {} }) {
  const attempts = [];
  let cur = { code, language, explanation: null, by: 'user-approved' };
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const policy = scan(cur.code);
    onEvent({ type: 'attempt', n, code: cur.code, language: cur.language, by: cur.by, fixNote: cur.explanation, policy });
    const r = await execute({ code: cur.code, language: cur.language, inputs, onChunk: c => onEvent({ type: 'chunk', n, ...c }) });
    const a = { n, by: cur.by, fixNote: cur.explanation, code: cur.code, codeSha256: sha256(cur.code), language: cur.language, policy, result: r };
    attempts.push(a);
    log('run.attempt', { attempt: n, by: cur.by, sandboxId: r.sandboxId, exitCode: r.exitCode, contained: r.contained, triggered: r.limits.filter(l => l.triggered).map(l => l.id), durationMs: r.durationMs, codeSha256: a.codeSha256, environment: 'destroyed' });
    onEvent({ type: 'attempt.result', n, exitCode: r.exitCode, contained: r.contained, durationMs: r.durationMs, sandboxId: r.sandboxId, stderrTail: r.stderr.slice(-400) });
    if (!heal || !healable(r) || n === MAX_ATTEMPTS) break;
    onEvent({ type: 'healing', n, stderrTail: r.stderr.slice(-400) });
    let f = null;
    try { f = await fix({ task, code: cur.code, language: cur.language, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, file }); }
    catch (e) { log('heal.error', { attempt: n, message: e.message }); onEvent({ type: 'heal.error', n, error: e.message }); }
    if (!f || !f.code || f.code === cur.code) { log('heal.gaveup', { attempt: n }); break; }
    log('heal.fix', { attempt: n + 1, model: f.provider?.model, codeSha256: sha256(f.code) });
    cur = { code: f.code, language: f.language || cur.language, explanation: f.explanation, by: `self-heal (${f.provider?.model || 'model'})` };
  }
  const last = attempts.at(-1);
  return { attempts, final: last, healed: attempts.length > 1 && last.result.exitCode === 0 && !last.result.contained };
}

const VERIFIED = /^RESULTS_JSON=(.*)$/m;
export function verifiedNumbers(stdout) { const m = stdout.match(VERIFIED); if (!m) return null; try { return JSON.parse(m[1]); } catch { try { return JSON.parse(m[1].replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')); } catch { return null; } } }

export function buildReceipt({ id, task, model, provider, inputs = [], run }) {
  const f = run.final, r = f.result;
  return {
    receipt: 'safecode-proof/v1', runId: id, generatedAt: new Date().toISOString(),
    prompt: task, model: { provider, model },
    code: { language: f.language, sha256: f.codeSha256, source: f.code },
    inputs: inputs.map(i => ({ name: i.name, bytes: i.data.length, sha256: sha256(i.data), mount: `/work/input/${i.name} (read-only)` })),
    output: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, sha256: sha256(r.stdout + '\u0000' + r.stderr), truncated: r.truncated, verified: verifiedNumbers(r.stdout),
      artifacts: r.artifacts.map(a => ({ name: a.name, mime: a.mime, bytes: a.bytes, sha256: a.sha256 })) },
    resourceLimits: r.resources,
    sandbox: { id: r.sandboxId, backend: r.mode.label, production: r.mode.production, lifecycle: r.lifecycle },
    containment: { contained: r.contained, events: r.limits.filter(l => l.triggered).map(l => ({ id: l.id, label: l.label })), activeControls: r.limits.filter(l => l.active).map(l => l.id) },
    selfHeal: { attempts: run.attempts.length, healed: run.healed, timeline: run.attempts.map(a => ({ n: a.n, by: a.by, fixNote: a.fixNote, codeSha256: a.codeSha256, sandboxId: a.result.sandboxId, exitCode: a.result.exitCode, contained: a.result.contained, durationMs: a.result.durationMs, lifecycle: a.result.lifecycle })) },
  };
}
const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function receiptHtml(x) {
  const row = (k, v) => `<tr><th>${e(k)}</th><td>${v}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>SafeCode proof ${e(x.runId)}</title>
<style>body{font:14px system-ui;max-width:900px;margin:24px auto;color:#111}th{text-align:left;padding:4px 10px 4px 0;vertical-align:top;white-space:nowrap}td{padding:4px 0}pre{background:#f4f6fb;padding:10px;overflow:auto;white-space:pre-wrap}code{font-size:12px}.c{color:#b00020;font-weight:700}.ok{color:#08703a;font-weight:700}</style>
<h1>⛨ SafeCode Agent — proof of execution</h1><p>Receipt <code>${e(x.receipt)}</code>, run <code>${e(x.runId)}</code>, generated ${e(x.generatedAt)}</p>
<table>${row('Prompt', e(x.prompt))}${row('Model', e(`${x.model.provider} · ${x.model.model}`))}
${row('Code SHA-256', `<code>${e(x.code.sha256)}</code> (${e(x.code.language)})`)}
${row('Inputs', x.inputs.length ? x.inputs.map(i => `${e(i.name)} · ${i.bytes} B · <code>${e(i.sha256)}</code>`).join('<br>') : 'none')}
${row('Output SHA-256', `<code>${e(x.output.sha256)}</code> · exit ${e(x.output.exitCode)}`)}
${row('Artifacts', x.output.artifacts.length ? x.output.artifacts.map(a => `${e(a.name)} · ${a.bytes} B · <code>${e(a.sha256)}</code>`).join('<br>') : 'none')}
${row('Sandbox', `<code>${e(x.sandbox.id)}</code> · ${e(x.sandbox.backend)}`)}
${row('Lifecycle', Object.entries(x.sandbox.lifecycle).map(([k, v]) => `${e(k)}: ${e(v)}`).join('<br>'))}
${row('Limits', Object.entries(x.resourceLimits).map(([k, v]) => `${e(k)}=${e(v)}`).join(' · '))}
${row('Containment', x.containment.contained ? `<span class="c">CONTAINED: ${x.containment.events.map(v => e(v.label)).join(', ')}</span>` : '<span class="ok">No limit triggered</span>')}
${row('Self-heal', `${x.selfHeal.attempts} attempt(s)${x.selfHeal.healed ? ' · <span class="ok">healed</span>' : ''}<br>` + x.selfHeal.timeline.map(t => `#${t.n} ${e(t.by)} → exit ${e(t.exitCode)} in ${t.durationMs} ms (<code>${e(t.sandboxId)}</code>)${t.fixNote ? ' — ' + e(t.fixNote) : ''}`).join('<br>'))}
</table><h2>Code</h2><pre><code>${e(x.code.source)}</code></pre><h2>stdout</h2><pre>${e(x.output.stdout)}</pre>${x.output.stderr ? `<h2>stderr</h2><pre>${e(x.output.stderr)}</pre>` : ''}
${x.output.verified ? `<h2>Verified numbers</h2><pre>${e(JSON.stringify(x.output.verified, null, 2))}</pre>` : ''}
<p><small>Verify: sha256 of the code above must equal the code hash; output hash = sha256(stdout + "\\0" + stderr). JSON receipt: <code>/api/runs/${e(x.runId)}/receipt.json</code></small></p>`;
}

// Live safety stats. Attack categories map sandbox limit ids -> dashboard buckets.
const BUCKET = { pids: 'pids', network: 'network', 'readonly-fs': 'fs', secrets: 'fs', caps: 'fs', 'non-root': 'fs', timeout: 'timeout', memory: 'memory' };
export function createStats() {
  const s = { runs: 0, sandboxes: 0, success: 0, failed: 0, contained: 0, healed: 0, attacks: { pids: 0, network: 0, fs: 0, timeout: 0, memory: 0 }, lifetimeTotalMs: 0, recent: [] };
  return {
    record(run, task) {
      s.runs++;
      for (const a of run.attempts) { s.sandboxes++; s.lifetimeTotalMs += Date.parse(a.result.lifecycle.destroyed) - Date.parse(a.result.lifecycle.created); }
      const r = run.final.result;
      if (r.contained) { s.contained++; for (const b of new Set(r.limits.filter(l => l.triggered).map(l => BUCKET[l.id]).filter(Boolean))) s.attacks[b]++; }
      else if (r.exitCode === 0) s.success++; else s.failed++;
      if (run.healed) s.healed++;
      s.recent.unshift({ ts: new Date().toISOString(), task: task.slice(0, 80), sandboxId: r.sandboxId, attempts: run.attempts.length, healed: run.healed, exitCode: r.exitCode, contained: r.contained, triggered: r.limits.filter(l => l.triggered).map(l => l.id) });
      s.recent.length = Math.min(s.recent.length, 20);
    },
    snapshot() { const { lifetimeTotalMs, ...rest } = s; return { ...rest, avgSandboxLifetimeMs: s.sandboxes ? Math.round(lifetimeTotalMs / s.sandboxes) : 0 }; },
  };
}
