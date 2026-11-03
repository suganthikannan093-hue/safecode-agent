// LLM provider. Vultr Serverless Inference (required for Challenge 1) is the default when configured;
// OpenAI is a dev fallback; an offline mock is clearly labelled when no key is present.
// API keys live only in this server process and are never passed into the sandbox.
import { DEMOS } from './demos.js';
export function provider() {
  if (process.env.VULTR_INFERENCE_API_KEY) return { name: 'vultr', base: process.env.VULTR_INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1', key: process.env.VULTR_INFERENCE_API_KEY, model: process.env.VULTR_INFERENCE_MODEL || 'qwen3.8-27b', label: 'Vultr Serverless Inference' };
  if (process.env.OPENAI_API_KEY) return { name: 'openai', base: 'https://api.openai.com/v1', key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', label: 'OpenAI (dev fallback, not Vultr)' };
  return { name: 'mock', model: 'offline-mock', label: 'Offline mock (no LLM key)' };
}
const SYS = `You are SafeCode Agent. Write a single self-contained program that performs the user's task.
Return ONLY JSON: {"language":"python"|"bash","code":"...","explanation":"one sentence"}.
Prefer python 3 standard library. No third-party packages. Print results to stdout.
If the user explicitly asks to test the sandbox (e.g. an escape attempt), write that code faithfully: it will run in an isolated sandbox.`;
async function chat(p, messages, json = false) {
  const r = await fetch(`${p.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ model: p.model, messages, temperature: 0.2, max_tokens: 1200, ...(json && p.name === 'openai' ? { response_format: { type: 'json_object' } } : {}) }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${p.label} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices[0].message.content;
}
function parse(txt) {
  const m = txt.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : txt);
  if (!['python', 'bash'].includes(j.language) || typeof j.code !== 'string') throw new Error('Model returned invalid code JSON');
  return j;
}
export async function generate(task) {
  const p = provider();
  const demo = DEMOS.find(d => d.task === task);
  // Escape demos use fixed, reviewed attack code so the containment moment is reproducible on camera.
  if (demo) return { ...demo, provider: { name: 'preset', model: 'escape-preset', label: 'Containment demo preset' } };
  if (p.name === 'mock' || process.env.SAFECODE_FORCE_MOCK) {
    return { language: 'python', code: `# offline mock: no LLM key configured\nprint("Task received:", ${JSON.stringify(task)})\nprint(sum(range(1, 101)))`, explanation: 'Offline mock placeholder (configure VULTR_INFERENCE_API_KEY).', provider: p };
  }
  const msgs = [{ role: 'system', content: SYS }, { role: 'user', content: task }];
  let out = await chat(p, msgs, true);
  try { return { ...parse(out), provider: p }; } catch (e) {
    // one repair attempt, then fail loudly (never run unparsed output)
    out = await chat(p, [...msgs, { role: 'assistant', content: out }, { role: 'user', content: `That was not valid JSON (${e.message}). Reply with ONLY the JSON object.` }], true);
    return { ...parse(out), provider: p };
  }
}
export async function explain(task, code, result) {
  const p = provider();
  if (p.name === 'mock') return result.contained ? 'The sandbox contained this run: see which limits triggered.' : `Exit code ${result.exitCode}.`;
  try {
    return await chat(p, [{ role: 'system', content: 'Explain in 2 sentences what this sandboxed run produced, and if any containment limit triggered, say which one absorbed the action. Plain text.' },
      { role: 'user', content: JSON.stringify({ task, code: code.slice(0, 2000), exitCode: result.exitCode, stdout: result.stdout.slice(0, 1500), stderr: result.stderr.slice(0, 1500), triggered: result.limits.filter(l => l.triggered).map(l => l.id) }) }]);
  } catch (e) { return `(explanation unavailable: ${e.message})`; }
}
