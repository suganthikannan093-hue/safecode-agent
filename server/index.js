import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execute, detectMode, LIMITS } from './sandbox.js';
import { generate, explain, provider, fix } from './llm.js';
import { runWithHealing, buildReceipt, receiptHtml, createStats, verifiedNumbers, sha256 } from './agent.js';
import { scan } from './policy.js';
import { DEMOS, EXAMPLES, HEAL_DEMO } from './demos.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const DATA = join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });
const history = []; const audit = [];
const drafts = new Map(); // id -> generated code the user has SEEN; runs reference it (code shown before run)
const uploads = new Map(); // fileId -> { name, data, sha256 } (CSV kept in server memory, mounted read-only per run)
const receipts = new Map(); const stats = createStats(); const sse = new Set();
mkdirSync(join(DATA, 'receipts'), { recursive: true });
function broadcast(type, data) { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of sse) r.write(msg); }
function log(event, detail) { const e = { ts: new Date().toISOString(), event, ...detail }; audit.unshift(e); audit.length = Math.min(audit.length, 500); appendFileSync(join(DATA, 'audit.jsonl'), JSON.stringify(e) + '\n'); broadcast('audit', e); }
const MAX_CSV = LIMITS.maxInputBytes;
const raw = req => new Promise((ok, bad) => { // drain but stop buffering past the cap, then answer 413
  const tooBig = () => Object.assign(new Error(`CSV too large (max ${MAX_CSV} bytes)`), { code: 413 });
  if (Number(req.headers['content-length']) > MAX_CSV) { req.resume(); return bad(tooBig()); }
  const c = []; let n = 0; req.on('data', d => { n += d.length; if (n <= MAX_CSV) c.push(d); }); req.on('end', () => n > MAX_CSV ? bad(tooBig()) : ok(Buffer.concat(c))); });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) bad(new Error('too large')); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/status') { const p = provider(); return json(res, 200, { sandbox: detectMode(), limits: LIMITS, llm: { provider: p.name, model: p.model, label: p.label }, demos: DEMOS.map(({ id, title, task }) => ({ id, title, task })), healDemo: { title: HEAL_DEMO.title, task: HEAL_DEMO.task }, examples: EXAMPLES, maxCsvBytes: MAX_CSV }); }
    if (url.pathname === '/api/history') return json(res, 200, history);
    if (url.pathname === '/api/audit') return json(res, 200, audit);
    if (url.pathname === '/api/stats') return json(res, 200, stats.snapshot());
    if (url.pathname === '/api/events') { // live safety dashboard (SSE)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: stats\ndata: ${JSON.stringify(stats.snapshot())}\n\n`); sse.add(res);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000); req.on('close', () => { clearInterval(ka); sse.delete(res); }); return;
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const name = (url.searchParams.get('name') || 'data.csv').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
      if (!/\.csv$/i.test(name)) return json(res, 400, { error: 'Only .csv files are accepted' });
      let data; try { data = await raw(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
      if (!data.length) return json(res, 400, { error: 'empty file' });
      if (data.includes(0)) return json(res, 400, { error: 'binary content is not a CSV' });
      const fileId = randomUUID(); const f = { name, data, sha256: sha256(data) }; uploads.set(fileId, f);
      log('upload', { fileId, name, bytes: data.length, sha256: f.sha256 });
      return json(res, 200, { fileId, name, bytes: data.length, sha256: f.sha256, preview: data.toString('utf8').split('\n').slice(0, 6).join('\n') });
    }
    const rm = url.pathname.match(/^\/api\/runs\/([\w-]+)\/receipt\.(json|html)$/);
    if (rm) {
      let rc = receipts.get(rm[1]); const fp = join(DATA, 'receipts', rm[1] + '.json');
      if (!rc && existsSync(fp)) rc = JSON.parse(readFileSync(fp, 'utf8'));
      if (!rc) return json(res, 404, { error: 'no receipt' });
      const dl = url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="safecode-proof-${rm[1].slice(0, 8)}.${rm[2]}"` } : {};
      if (rm[2] === 'json') { res.writeHead(200, { 'content-type': 'application/json', ...dl }); return res.end(JSON.stringify(rc, null, 2)); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...dl }); return res.end(receiptHtml(rc));
    }
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const { task, fileId } = await body(req); if (!task || typeof task !== 'string') return json(res, 400, { error: 'task required' });
      const up = fileId ? uploads.get(fileId) : null; if (fileId && !up) return json(res, 400, { error: 'unknown fileId (upload again)' });
      const file = up && { name: up.name, bytes: up.data.length, preview: up.data.toString('utf8').split('\n').slice(0, 6).join('\n').slice(0, 1500) };
      const g = await generate(task.slice(0, 2000), { file });
      const id = randomUUID(); const policy = scan(g.code);
      drafts.set(id, { task, ...g, policy, fileId: up ? fileId : null, file });
      log('generate', { id, task: task.slice(0, 200), provider: g.provider.name, model: g.provider.model, language: g.language, risk: policy.risk });
      return json(res, 200, { id, language: g.language, code: g.code, explanation: g.explanation, policy, provider: g.provider.label, model: g.provider.model });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const { id, code, language, heal = true } = await body(req);
      const d = drafts.get(id); if (!d) return json(res, 400, { error: 'Generate (and review) code first' });
      const final = typeof code === 'string' ? code : d.code; const edited = final !== d.code;
      const lang = language || d.language; const policy = scan(final);
      log('run.approved', { id, edited, language: lang, risk: policy.risk, flags: policy.findings.map(f => f.id) });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const send = o => res.write(JSON.stringify(o) + '\n');
      send({ type: 'start', mode: detectMode(), policy, heal });
      const up = d.fileId ? uploads.get(d.fileId) : null; const inputs = up ? [{ name: up.name, data: up.data }] : [];
      const run = await runWithHealing({ task: d.task, code: final, language: lang, inputs, file: d.file, heal: heal !== false && d.provider?.model !== 'escape-preset',
        execute, fix, onEvent: send, log: (ev, x) => log(ev, { id, ...x }) });
      const r = run.final.result; const finalCode = run.final.code;
      const explanation = await explain(d.task, finalCode, r);
      const p = provider(); const usedLlm = run.attempts.length > 1 || d.provider?.name !== 'preset';
      const receipt = buildReceipt({ id, task: d.task, provider: usedLlm ? p.label : d.provider.label, model: usedLlm ? p.model : d.provider.model, inputs, run });
      receipts.set(id, receipt); writeFileSync(join(DATA, 'receipts', id + '.json'), JSON.stringify(receipt));
      const rec = { id, ts: new Date().toISOString(), task: d.task, language: run.final.language, exitCode: r.exitCode, durationMs: r.durationMs, contained: r.contained, triggered: r.limits.filter(l => l.triggered).map(l => l.id), mode: r.mode.mode, risk: policy.risk, attempts: run.attempts.length, healed: run.healed, sandboxId: r.sandboxId };
      history.unshift(rec); history.length = Math.min(history.length, 100);
      stats.record(run, d.task); broadcast('stats', stats.snapshot());
      log('run.finished', { ...rec, task: undefined, codeSha256: run.final.codeSha256, environment: 'destroyed' });
      send({ type: 'result', ...r, explanation, attempts: run.attempts.length, healed: run.healed, finalCode, verified: verifiedNumbers(r.stdout), receipt: { json: `/api/runs/${id}/receipt.json`, html: `/api/runs/${id}/receipt.html` } }); return res.end();
    }
    const file = join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\.+/g, ''));
    if (file.startsWith(join(ROOT, 'public')) && existsSync(file)) { res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); return res.end(readFileSync(file)); }
    json(res, 404, { error: 'not found' });
  } catch (e) { log('error', { path: url.pathname, message: e.message }); if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(JSON.stringify({ type: 'error', error: e.message }) + '\n'); }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4321);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`SafeCode Agent on http://${process.env.HOST || '127.0.0.1'}:${port} | sandbox=${detectMode().label} | llm=${provider().label}`));
}
