import './config.js';
import { integer, production } from './config.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
export const error = (status, message) => Object.assign(new Error(message), { status });
export function readBody(req, max) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > max) { req.resume(); reject(error(413, 'Request too large')); return; }
    const chunks = []; let size = 0, rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > max) { rejected = true; chunks.length = 0; reject(error(413, 'Request too large')); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    req.on('error', reject); req.on('aborted', () => reject(error(400, 'Request aborted')));
  });
}
export function access() {
  const file = process.env.SAFECODE_ACCESS_TOKEN_FILE;
  const token = file ? readFileSync(file, 'utf8').trim() : process.env.SAFECODE_ACCESS_TOKEN;
  if (production && !token) throw new Error('Production requires SAFECODE_ACCESS_TOKEN_FILE');
  if (token && token.length < 32) throw new Error('Access token must have at least 32 characters');
  const sessions = new Map();
  const equal = s => typeof s === 'string' && token && Buffer.byteLength(s) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(s), Buffer.from(token));
  const prune = () => { for (const [id, expires] of sessions) if (expires < Date.now()) sessions.delete(id); };
  return {
    enabled: Boolean(token),
    allowed(req) {
      if (!token) return true;
      if (equal(req.headers.authorization?.replace(/^Bearer /, ''))) return true;
      prune(); const id = req.headers.cookie?.match(/(?:^|;\s*)safecode=([a-f0-9]+)/)?.[1];
      return Boolean(id && sessions.has(id));
    },
    login(value) { prune(); if (!equal(value)) throw error(401, 'Invalid access token'); if (sessions.size >= 32) throw error(429, 'Too many sessions'); const id = randomBytes(32).toString('hex'); sessions.set(id, Date.now() + 3600000); return `safecode=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${production ? '; Secure' : ''}`; },
    logout(req) { const id = req.headers.cookie?.match(/(?:^|;\s*)safecode=([a-f0-9]+)/)?.[1]; sessions.delete(id); return 'safecode=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'; },
    mutation(req) {
      if (!['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method)) return;
      if (req.headers['sec-fetch-site'] === 'cross-site') throw error(403, 'Cross-site request refused');
      if (req.headers.origin) {
        const expected = process.env.SAFECODE_ORIGIN || `http://${req.headers.host}`;
        if (req.headers.origin !== expected) throw error(403, 'Origin mismatch');
      }
    },
  };
}
export function governor(path) {
  const maxConcurrent = integer('SAFECODE_CONCURRENCY', 2, 1, 8), maxAttempts = integer('SAFECODE_DAILY_ATTEMPTS', 100), maxModelCalls = integer('SAFECODE_DAILY_MODEL_CALLS', 100);
  let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { day: '', attempts: 0, modelCalls: 0, paused: false };
  const active = new Map();
  const save = () => writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  const roll = () => { const day = new Date().toISOString().slice(0, 10); if (state.day !== day) { state = { day, attempts: 0, modelCalls: 0, paused: state.paused }; save(); } };
  return {
    snapshot() { roll(); return { ...state, active: [...active.keys()], maxConcurrent, maxAttempts, maxModelCalls }; },
    begin(id) { roll(); if (state.paused) throw error(503, 'Execution paused by operator'); if (active.size >= maxConcurrent) throw error(429, 'Concurrency limit reached; try later'); const c = new AbortController(); active.set(id, c); return c.signal; },
    finish(id) { active.delete(id); },
    consume(kind) { roll(); if (state.paused) throw error(503, 'Execution paused by operator'); const field = kind === 'model' ? 'modelCalls' : 'attempts', max = kind === 'model' ? maxModelCalls : maxAttempts; if (state[field] >= max) throw error(429, `${field} daily budget exhausted`); state[field]++; save(); },
    cancel(id) { const c = active.get(id); if (!c) throw error(404, 'No active execution'); c.abort(); },
    pause(paused) { state.paused = paused; save(); if (paused) for (const c of active.values()) c.abort(); },
  };
}
