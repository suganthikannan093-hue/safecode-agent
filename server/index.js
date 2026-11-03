import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execute, detectMode, LIMITS } from './sandbox.js';
import { generate, explain, provider } from './llm.js';
import { scan } from './policy.js';
import { DEMOS, EXAMPLES } from './demos.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const DATA = join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });
const history = []; const audit = [];
const drafts = new Map(); // id -> generated code the user has SEEN; runs reference it (code shown before run)
function log(event, detail) { const e = { ts: new Date().toISOString(), event, ...detail }; audit.unshift(e); audit.length = Math.min(audit.length, 500); appendFileSync(join(DATA, 'audit.jsonl'), JSON.stringify(e) + '\n'); }
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) bad(new Error('too large')); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/status') { const p = provider(); return json(res, 200, { sandbox: detectMode(), limits: LIMITS, llm: { provider: p.name, model: p.model, label: p.label }, demos: DEMOS.map(({ id, title, task }) => ({ id, title, task })), examples: EXAMPLES }); }
    if (url.pathname === '/api/history') return json(res, 200, history);
    if (url.pathname === '/api/audit') return json(res, 200, audit);
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const { task } = await body(req); if (!task || typeof task !== 'string') return json(res, 400, { error: 'task required' });
      const g = await generate(task.slice(0, 2000));
      const id = randomUUID(); const policy = scan(g.code);
      drafts.set(id, { task, ...g, policy });
      log('generate', { id, task: task.slice(0, 200), provider: g.provider.name, model: g.provider.model, language: g.language, risk: policy.risk });
      return json(res, 200, { id, language: g.language, code: g.code, explanation: g.explanation, policy, provider: g.provider.label, model: g.provider.model });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const { id, code, language } = await body(req);
      const d = drafts.get(id); if (!d) return json(res, 400, { error: 'Generate (and review) code first' });
      const final = typeof code === 'string' ? code : d.code; const edited = final !== d.code;
      const lang = language || d.language; const policy = scan(final);
      log('run.approved', { id, edited, language: lang, risk: policy.risk, flags: policy.findings.map(f => f.id) });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const send = o => res.write(JSON.stringify(o) + '\n');
      send({ type: 'start', mode: detectMode(), policy });
      const r = await execute({ code: final, language: lang, onChunk: c => send({ type: 'chunk', ...c }) });
      const explanation = await explain(d.task, final, r);
      const rec = { id, ts: new Date().toISOString(), task: d.task, language: lang, exitCode: r.exitCode, durationMs: r.durationMs, contained: r.contained, triggered: r.limits.filter(l => l.triggered).map(l => l.id), mode: r.mode.mode, risk: policy.risk };
      history.unshift(rec); history.length = Math.min(history.length, 100);
      log('run.finished', { ...rec, task: undefined, environment: 'destroyed' });
      send({ type: 'result', ...r, explanation }); return res.end();
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
