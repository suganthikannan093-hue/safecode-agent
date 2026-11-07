import './config.js';
import { production, integer } from './config.js';
import { access, governor, readBody, error } from './controls.js';
import { signer } from './receipts.js';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execute, detectMode, LIMITS } from './sandbox.js';
import { generate, explain, provider, fix, setModelBudget } from './llm.js';
import { runWithHealing, buildReceipt, receiptHtml, createStats, verifiedNumbers, sha256 } from './agent.js';
import { scan } from './policy.js';
import { DEMOS, EXAMPLES, HEAL_DEMO } from './demos.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SAFECODE_DATA_DIR || join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });
const auth = access();
const receiptSigner = signer(process.env.SAFECODE_SIGNING_KEY_FILE);
if (production && !receiptSigner.publicKey) throw new Error('Production requires SAFECODE_SIGNING_KEY_FILE');
const budgets = governor(join(DATA, 'budgets.json'));
setModelBudget(() => budgets.consume('model'));
const retentionMs = integer('SAFECODE_RETENTION_HOURS', 24, 1, 168) * 3600000;
const maxObjects = integer('SAFECODE_MAX_OBJECTS', 100, 1, 1000);
const activeRuns = new Set();
const history = []; const audit = [];
const drafts = new Map(); // id -> generated code the user has SEEN; runs reference it (code shown before run)
const uploads = new Map(); // fileId -> { name, data, sha256 } (CSV kept in server memory, mounted read-only per run)
const receipts = new Map(); let stats = createStats(); const sse = new Set();
mkdirSync(join(DATA, 'receipts'), { recursive: true });
function broadcast(type, data) { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of sse) r.write(msg); }
function log(event, detail) { const e = { ts: new Date().toISOString(), event, ...detail }; audit.unshift(e); audit.length = Math.min(audit.length, 500); writeFileSync(join(DATA, 'audit.jsonl'), audit.slice().reverse().map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 }); broadcast('audit', e); }
const MAX_CSV = LIMITS.maxInputBytes;
const raw = req => readBody(req, MAX_CSV);
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = async req => { try { return JSON.parse((await readBody(req, 100000)).toString() || '{}'); } catch (e) { if (e.status) throw e; throw error(400, 'Invalid JSON'); } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function sweep() {
  const cutoff = Date.now() - retentionMs;
  for (const map of [uploads, drafts]) for (const [id, item] of map) if (item.createdAt < cutoff) map.delete(id);
  for (const f of readdirSync(join(DATA, 'receipts'))) {
    if (!/^[\w-]+\.json$/.test(f)) continue;
    const path = join(DATA, 'receipts', f);
    if (statSync(path).mtimeMs < cutoff) { unlinkSync(path); receipts.delete(f.slice(0, -5)); }
  }
  for (const list of [history, audit]) for (let i = list.length - 1; i >= 0; i--) if (Date.parse(list[i].ts) < cutoff) list.splice(i, 1);
  writeFileSync(join(DATA, 'audit.jsonl'), audit.slice().reverse().map(x => JSON.stringify(x)).join('\n'), { mode: 0o600 });
}
function capacity(map) { if (map.size >= maxObjects) throw error(429, 'Storage quota reached; delete stored data or wait for expiry'); }
let generating = 0;
let loginWindow = 0, loginCount = 0;
sweep();
const sweeper = setInterval(sweep, 60000); sweeper.unref();
export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    auth.mutation(req);
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { authenticated: auth.allowed(req), accessRequired: auth.enabled });
    if (url.pathname === '/api/session' && req.method === 'POST') {
      if (Date.now() - loginWindow > 60000) { loginWindow = Date.now(); loginCount = 0; }
      if (++loginCount > 10) throw error(429, 'Login rate limit reached');
      const b = await body(req); res.setHeader('set-cookie', auth.login(b.token)); return json(res, 200, { authenticated: true });
    }
    if (url.pathname.startsWith('/api/') && !auth.allowed(req)) throw error(401, 'Access token required');
    if (url.pathname === '/api/session' && req.method === 'DELETE') { res.setHeader('set-cookie', auth.logout(req)); return json(res, 200, { authenticated: false }); }
    if (url.pathname === '/api/controls' && req.method === 'POST') { const b = await body(req); if (typeof b.paused !== 'boolean') throw error(400, 'paused must be boolean'); budgets.pause(b.paused); log('operator.pause', { paused: b.paused }); return json(res, 200, budgets.snapshot()); }
    if (url.pathname === '/api/controls') return json(res, 200, budgets.snapshot());
    if (url.pathname === '/api/cancel' && req.method === 'POST') { const b = await body(req); budgets.cancel(b.id); log('run.cancel', { id: b.id }); return json(res, 200, { cancelled: true }); }
    if (url.pathname === '/api/receipt-key') return json(res, 200, { publicKey: receiptSigner.publicKey });
    if (url.pathname === '/api/data' && req.method === 'DELETE') {
      if (activeRuns.size || generating) throw error(409, 'Wait for active work to finish before deleting data');
      uploads.clear(); drafts.clear(); receipts.clear(); history.length = 0; audit.length = 0; stats = createStats(); broadcast('stats', stats.snapshot());
      for (const f of readdirSync(join(DATA, 'receipts'))) if (/^[\w-]+\.json$/.test(f)) unlinkSync(join(DATA, 'receipts', f));
      writeFileSync(join(DATA, 'audit.jsonl'), ''); return json(res, 200, { deleted: true, retained: 'budget counters and signing keys; no backup deletion is implied' });
    }
    if (url.pathname === '/api/status') { const p = provider(); return json(res, 200, { sandbox: detectMode(), limits: LIMITS, llm: { provider: p.name, model: p.model, label: p.label }, demos: DEMOS.map(({ id, title, task }) => ({ id, title, task })), healDemo: { title: HEAL_DEMO.title, task: HEAL_DEMO.task }, examples: EXAMPLES, maxCsvBytes: MAX_CSV, controls: budgets.snapshot(), signedReceipts: Boolean(receiptSigner.publicKey), modelOutputSharing: process.env.SAFECODE_MODEL_OUTPUT_SHARING === '1', retentionHours: retentionMs / 3600000, accessRequired: auth.enabled }); }
    if (url.pathname === '/api/history') return json(res, 200, history);
    if (url.pathname === '/api/audit') return json(res, 200, audit);
    if (url.pathname === '/api/stats') return json(res, 200, stats.snapshot());
    if (url.pathname === '/api/events') {
      if (sse.size >= 16) throw error(429, 'Event stream limit reached'); // live safety dashboard (SSE)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: stats\ndata: ${JSON.stringify(stats.snapshot())}\n\n`); sse.add(res);
      const ka = setInterval(() => { if (!auth.allowed(req)) { clearInterval(ka); sse.delete(res); res.end(); } else res.write(': ka\n\n'); }, 20000); req.on('close', () => { clearInterval(ka); sse.delete(res); }); return;
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      capacity(uploads);
      const name = (url.searchParams.get('name') || 'data.csv').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
      if (!/\.csv$/i.test(name)) return json(res, 400, { error: 'Only .csv files are accepted' });
      let data; try { data = await raw(req); } catch (e) { return json(res, e.status || 400, { error: e.message }); }
      if (!data.length) return json(res, 400, { error: 'empty file' });
      if (data.includes(0)) return json(res, 400, { error: 'binary content is not a CSV' });
      capacity(uploads);
      const fileId = randomUUID(); const f = { createdAt: Date.now(), name, data, sha256: sha256(data) }; uploads.set(fileId, f);
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
      capacity(drafts); if (generating >= 2) throw error(429, 'Generation concurrency limit reached');
      const { task, fileId } = await body(req); if (!task || typeof task !== 'string') return json(res, 400, { error: 'task required' });
      const up = fileId ? uploads.get(fileId) : null; if (fileId && !up) return json(res, 400, { error: 'unknown fileId (upload again)' });
      const file = up && { name: up.name, bytes: up.data.length, preview: process.env.SAFECODE_MODEL_INPUT_SHARING === '1' ? up.data.toString('utf8').split('\n').slice(0, 6).join('\n').slice(0, 1500) : '(preview sharing disabled; inspect CSV headers within the sandbox using csv.DictReader)'  };
      capacity(drafts); if (generating >= 2) throw error(429, 'Generation concurrency limit reached');
      let g; generating++; try { g = await generate(task.slice(0, 2000), { file }); } finally { generating--; }
      capacity(drafts);
      const id = randomUUID(); const policy = scan(g.code);
      drafts.set(id, { createdAt: Date.now(), task, ...g, policy, fileId: up ? fileId : null, file });
      log('generate', { id, task: task.slice(0, 200), provider: g.provider.name, model: g.provider.model, inference: g.inference ?? null, language: g.language, risk: policy.risk });
      return json(res, 200, { id, language: g.language, code: g.code, explanation: g.explanation, policy, provider: g.provider.label, model: g.provider.model, inference: g.inference ?? null });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const { id: draftId, code, language, heal = true } = await body(req);
      const d = drafts.get(draftId); if (!d) return json(res, 400, { error: 'Generate (and review) code first' });
      if (readdirSync(join(DATA, 'receipts')).length + activeRuns.size >= maxObjects) throw error(429, 'Receipt storage quota reached');
      if (d.fileId && !uploads.has(d.fileId)) throw error(410, 'Input expired; upload and generate again');
      const id = randomUUID(); const signal = budgets.begin(id); activeRuns.add(id);
      const disconnected = () => { if (!res.writableEnded) { try { budgets.cancel(id); } catch {} } };
      res.on('close', disconnected);
      try {
      const final = typeof code === 'string' ? code : d.code; const edited = final !== d.code;
      const lang = language || d.language; const policy = scan(final);
      log('run.approved', { id, edited, language: lang, risk: policy.risk, flags: policy.findings.map(f => f.id) });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const send = o => res.write(JSON.stringify(o) + '\n');
      send({ type: 'start', id, draftId, mode: detectMode(), policy, heal });
      const up = d.fileId ? uploads.get(d.fileId) : null; const inputs = up ? [{ name: up.name, data: up.data }] : [];
      const run = await runWithHealing({ task: d.task, code: final, language: lang, model: { provider: d.provider?.name || null, model: d.provider?.model || null, inference: d.inference ?? null }, inputs, file: d.file, heal: heal !== false && d.provider?.model !== 'escape-preset',
        execute: args => { if (signal.aborted) throw error(409, 'Execution cancelled'); budgets.consume('attempt'); return execute({ ...args, signal }); }, fix: args => signal.aborted ? null : fix(args), onEvent: send, log: (ev, x) => log(ev, { id, ...x }) });
      const r = run.final.result; const finalCode = run.final.code;
      const explanation = r.cancelled || signal.aborted ? 'Execution cancelled; no model explanation requested.' : await explain(d.task, finalCode, r);
      const p = provider(); const usedLlm = run.attempts.length > 1 || d.provider?.name !== 'preset';
      const receipt = receiptSigner.seal(buildReceipt({ id, task: d.task, provider: usedLlm ? p.label : d.provider.label, model: usedLlm ? p.model : d.provider.model, inputs, run }));
      receipts.set(id, receipt); writeFileSync(join(DATA, 'receipts', id + '.json'), JSON.stringify(receipt), { mode: 0o600 });
      const rec = { id, ts: new Date().toISOString(), task: d.task, language: run.final.language, exitCode: r.exitCode, durationMs: r.durationMs, contained: r.contained, triggered: r.limits.filter(l => l.triggered).map(l => l.id), mode: r.mode.mode, risk: policy.risk, attempts: run.attempts.length, healed: run.healed, sandboxId: r.sandboxId };
      history.unshift(rec); history.length = Math.min(history.length, 100);
      stats.record(run, d.task); broadcast('stats', stats.snapshot());
      log('run.finished', { ...rec, task: undefined, codeSha256: run.final.codeSha256, environment: 'destroyed' });
      send({ type: 'result', ...r, explanation, attempts: run.attempts.length, healed: run.healed, finalCode, verified: verifiedNumbers(r.stdout), receipt: { json: `/api/runs/${id}/receipt.json`, html: `/api/runs/${id}/receipt.html` } }); return res.end();
      } finally { activeRuns.delete(id); budgets.finish(id); res.off('close', disconnected); }
    }
    const file = join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\.+/g, ''));
    if (file.startsWith(join(ROOT, 'public')) && existsSync(file)) { res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); return res.end(readFileSync(file)); }
    json(res, 404, { error: 'not found' });
  } catch (e) { log('error', { path: url.pathname, message: e.message }); if (!res.headersSent) json(res, e.status || 500, { error: e.message }); else res.end(JSON.stringify({ type: 'error', error: e.message }) + '\n'); }
});
server.maxConnections = 128;
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on('close', () => clearInterval(sweeper));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4321);
  if (!auth.enabled && !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST || '127.0.0.1')) throw new Error('Non-loopback binding requires access token');
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`SafeCode Agent on http://${process.env.HOST || '127.0.0.1'}:${port} | sandbox=${detectMode().label} | llm=${provider().label}`));
}
