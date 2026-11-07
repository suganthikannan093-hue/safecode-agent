import './config.js';
import { integer, production } from './config.js';
// Pluggable sandbox executor. Generated code is NEVER run unsandboxed on the host.
//   docker : fresh container per run, --network none, --read-only, tmpfs, mem/pids/cpu caps,
//            --cap-drop ALL, no-new-privileges, non-root, default seccomp; runsc (gVisor) if installed.
//   bwrap  : LOCAL DEMO SANDBOX, NOT PRODUCTION. bubblewrap namespaces + prlimit + timeout.
//   none   : refuse to execute.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync, readdirSync, readFileSync, openSync, closeSync, fstatSync, constants, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const LIMITS = {
  timeoutMs: integer('SANDBOX_TIMEOUT_MS', 5000, 100, 60000),
  memoryMb: integer('SANDBOX_MEMORY_MB', 256, 32, 1024),
  pids: integer('SANDBOX_PIDS', 64, 8, 128),
  cpus: process.env.SANDBOX_CPUS || '0.5',
  maxOutput: 64 * 1024,
  maxInputBytes: integer('SANDBOX_MAX_INPUT_BYTES', 1048576, 1, 1048576),
  maxArtifactBytes: 2 * 1024 * 1024,
};
if (!Number.isFinite(Number(LIMITS.cpus)) || Number(LIMITS.cpus) <= 0 || Number(LIMITS.cpus) > 2) throw new Error('Invalid SANDBOX_CPUS');
const ARTIFACT_EXT = { '.png': 'image/png', '.svg': 'image/svg+xml' };
const has = (cmd, args = ['--version']) => { try { return spawnSync(cmd, args, { timeout: 5000 }).status === 0; } catch { return false; } };

export function detectMode() {
  const want = process.env.SANDBOX_MODE || 'auto';
  const required = process.env.SANDBOX_REQUIRED_RUNTIME || (production ? 'runsc' : '');
  if (required && required !== 'runsc') return { mode: 'none', runtime: null, label: 'Unsupported required runtime; execution disabled', production: false };
  if ((want === 'auto' || want === 'docker') && has('docker', ['info'])) {
    const info = spawnSync('docker', ['info', '--format', '{{json .Runtimes}}']).stdout?.toString() || '';
    if (required && !info.includes(required)) return { mode: 'none', runtime: null, label: `Required runtime ${required} unavailable; execution disabled`, production: false };
    return { mode: 'docker', runtime: info.includes('runsc') ? 'runsc' : 'runc', label: info.includes('runsc') ? 'Docker + gVisor (runsc)' : 'Docker (runc + default seccomp)', production: info.includes('runsc') };
  }
  if (!required && (want === 'auto' || want === 'bwrap') && has('bwrap') && has('prlimit')) {
    return { mode: 'bwrap', runtime: 'bubblewrap', label: 'Local demo sandbox, not production (bubblewrap + prlimit)', production: false };
  }
  return { mode: 'none', runtime: null, label: 'No sandbox available - execution disabled', production: false };
}

const RUNNERS = { python: ['python3', '-I', '-B', 'main.py'], bash: ['bash', '--noprofile', '--norc', 'main.sh'] };
const FILES = { python: 'main.py', bash: 'main.sh' };
const IMAGES = { python: process.env.SANDBOX_IMAGE_PYTHON || 'python:3.12-alpine', bash: process.env.SANDBOX_IMAGE_BASH || 'bash:5' };

function buildCommand(mode, lang, dir, name, io) {
  const L = LIMITS;
  if (mode.mode === 'docker') {
    return ['docker', ['run', '--name', name, ...(mode.runtime === 'runsc' ? ['--runtime=runsc'] : []),
      '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
      '--memory', `${L.memoryMb}m`, '--memory-swap', `${L.memoryMb}m`, '--pids-limit', String(L.pids), '--cpus', L.cpus,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      '--ulimit', 'fsize=10485760', '-e', 'HOME=/tmp', '-v', `${dir}:/work:ro`, ...(io.input ? ['-v', `${io.input}:/work/input:ro`] : []), '-v', `${io.out}:/work/out:rw`, '-w', '/work',
      IMAGES[lang], ...RUNNERS[lang]]];
  }
  // bwrap: new user/pid/net/ipc/uts/mount namespaces, read-only /usr, empty /etc (no secrets), tmpfs /tmp, nobody uid
  const nproc = L.pids + countUserProcs();
  return ['timeout', ['-s', 'KILL', String(Math.ceil(L.timeoutMs / 1000) + 1), 'bwrap',
    '--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/tmp',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/bin', '/bin',
    '--dir', '/etc', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--ro-bind', dir, '/work', ...(io.input ? ['--ro-bind', io.input, '/work/input'] : []), '--bind', io.out, '/work/out', '--chdir', '/work',
    '--uid', '65534', '--gid', '65534', '--cap-drop', 'ALL',
    'prlimit', `--as=${L.memoryMb * 1024 * 1024}`, `--nproc=${nproc}`, `--fsize=${10 * 1024 * 1024}`, `--cpu=${Math.ceil(L.timeoutMs / 1000) + 1}`, '--',
    ...RUNNERS[lang]]];
}
function countUserProcs() {
  const r = spawnSync('ps', ['-u', String(process.getuid?.() ?? 0), '-o', 'pid=']);
  return (r.stdout?.toString().trim().split('\n').length || 0) + 8;
}

// pids.events "max" and memory.events oom counters are host telemetry, not program text.
export function noteCgroupEvents(pidsEvents, memoryEvents, observed) {
  if (Number((String(pidsEvents ?? '').match(/^max\s+(\d+)/m) || [])[1] || 0) > 0) observed.pidLimitHit = true;
  if (/^(?:oom_group_kill|oom_kill|oom)\s+[1-9]/m.test(String(memoryEvents ?? ''))) observed.oomKilled = true;
}

// The scope disappears when the container exits, before `docker rm`. Latch hits while it exists,
// then attribute them with the container id, which remains queryable until removal.
function scanDockerScopes(pidHits, oomHits) {
  let entries = [];
  try { entries = readdirSync('/sys/fs/cgroup/system.slice'); } catch { return; }
  for (const entry of entries) {
    const id = (entry.match(/^docker-([a-f0-9]{64})\.scope$/) || [])[1];
    if (!id) continue;
    const base = `/sys/fs/cgroup/system.slice/${entry}`;
    try {
      const snap = { oomKilled: false, pidLimitHit: false };
      noteCgroupEvents(readFileSync(`${base}/pids.events`, 'utf8'), readFileSync(`${base}/memory.events`, 'utf8'), snap);
      if (snap.pidLimitHit) pidHits.add(id);
      if (snap.oomKilled) oomHits.add(id);
    } catch { /* scope reaped between listing and read */ }
  }
}

function startEnforcementWatch(name) {
  const observed = { oomKilled: false, pidLimitHit: false };
  const pidHits = new Set();
  const oomHits = new Set();
  let stopped = false;
  const poll = setInterval(() => { if (!stopped) scanDockerScopes(pidHits, oomHits); }, 20);
  poll.unref();
  let finished = false;
  return { observed, finish() {
    if (finished) return;
    finished = true;
    stopped = true; clearInterval(poll);
    try {
      scanDockerScopes(pidHits, oomHits);
      const inspected = spawnSync('docker', ['inspect', '--format', '{{.Id}} {{.State.OOMKilled}}', name], { timeout: 3000, encoding: 'utf8' });
      if (inspected.status !== 0) return;
      const [id, oom] = inspected.stdout.trim().split(/\s+/);
      if (oom === 'true' || oomHits.has(id)) observed.oomKilled = true;
      if (pidHits.has(id)) observed.pidLimitHit = true;
    } catch { /* telemetry is best-effort; output classification still runs */ }
  } };
}

export function classify({ stdout, stderr, exitCode, signal, timedOut, mode, observed = {} }) {
  const out = `${stdout}\n${stderr}`;
  const mark = (id, label, fromOutput, fromObservation, active = true) => {
    const triggered = Boolean(fromOutput || fromObservation);
    const evidence = id === 'timeout' || (fromObservation && triggered) ? 'controller-observed' : 'untrusted-output-inference';
    return { id, label, active, triggered, evidence };
  };
  const dockerOrBwrap = mode.mode !== 'none';
  return [
    mark('timeout', `Wall-clock timeout (${LIMITS.timeoutMs} ms)`, false, timedOut),
    mark('memory', `Memory cap (${LIMITS.memoryMb} MB)`, /MemoryError|Cannot allocate memory|out of memory/i.test(out) || exitCode === 137 && !timedOut, observed.oomKilled),
    mark('pids', `Process limit (${LIMITS.pids} pids)`, /Resource temporarily unavailable|BlockingIOError|fork: retry|Errno 11/.test(out), observed.pidLimitHit),
    mark('network', 'No network (isolated namespace)', /Network is unreachable|Temporary failure in name resolution|Name or service not known|Could not resolve|Errno -[23]|Errno 101|Errno 99/i.test(out), false),
    mark('readonly-fs', 'Read-only root filesystem', /Read-only file system|Errno 30/.test(out), false),
    mark('secrets', 'Host secrets & env not mounted', /\/etc\/(shadow|passwd)|No such file or directory: '\/(etc|root|home)/.test(out) || /Permission denied/.test(out), false),
    mark('caps', 'All Linux capabilities dropped', /Operation not permitted|Errno 1\b/.test(out), false),
    mark('non-root', 'Runs as uid 65534 (nobody)', /Permission denied|Errno 13/.test(out), false),
    mark('seccomp', mode.mode === 'docker' ? 'Seccomp syscall filter' : 'Seccomp (Docker mode only)', false, false, mode.mode === 'docker'),
    mark('ephemeral', 'Fresh environment, destroyed after run', false, false, dockerOrBwrap),
  ];
}

// inputs: [{ name, data: Buffer }] mounted READ-ONLY at /work/input. /work/out is the only writable,
// persisted path; PNG/SVG artifacts there are collected (size-capped) and the dir is destroyed.
export async function execute({ code, language = 'python', inputs = [], onChunk = () => {}, signal }) {
  const mode = detectMode();
  if (mode.mode === 'none') throw new Error('No sandbox available; refusing to run generated code on the host.');
  if (!RUNNERS[language]) throw new Error(`Unsupported language: ${language}`);
  if (signal?.aborted) throw new Error('Execution cancelled');
  for (const f of inputs) if (f.data.length > LIMITS.maxInputBytes) throw new Error(`Input ${f.name} exceeds ${LIMITS.maxInputBytes} bytes`);
  const workDir = process.env.SAFECODE_WORK_DIR || tmpdir();
  if (production) {
    const fs = statfsSync(workDir);
    if (fs.type !== 0x01021994 || fs.blocks * fs.bsize > 64 * 1024 * 1024) throw new Error('Production work directory must be a dedicated tmpfs of at most 64 MiB');
    if (!/@sha256:[a-f0-9]{64}$/.test(IMAGES[language])) throw new Error('Production requires image pinned by digest');
  }
  const lifecycle = { created: new Date().toISOString() };
  const root = mkdtempSync(join(workDir, 'safecode-'));
  let watch = { observed: {}, finish() {} };
  try {
  const dir = join(root, 'code'), out = join(root, 'out'); mkdirSync(dir); mkdirSync(out); mkdirSync(join(dir, 'input')); mkdirSync(join(dir, 'out')); // mountpoints
  writeFileSync(join(dir, FILES[language]), code); chmodSync(join(dir, FILES[language]), 0o444); chmodSync(dir, 0o755); chmodSync(out, 0o777); chmodSync(root, 0o755);
  let input = null;
  if (inputs.length) {
    input = join(root, 'input'); mkdirSync(input);
    for (const f of inputs) {
      if (f.data.length > LIMITS.maxInputBytes) throw new Error(`Input ${f.name} exceeds ${LIMITS.maxInputBytes} bytes`);
      const fn = join(input, basename(f.name)); writeFileSync(fn, f.data); chmodSync(fn, 0o444);
    }
    chmodSync(input, 0o555);
  }
  const name = `safecode-${randomUUID()}`;
  watch = mode.mode === 'docker' ? startEnforcementWatch(name) : watch;
  let imageIdentity = null;
  if (mode.mode === 'docker') {
    const inspected = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', IMAGES[language]], { timeout: 5000 });
    if (inspected.status !== 0) throw new Error('Sandbox image unavailable; pull it before running');
    imageIdentity = inspected.stdout.toString().trim();
  }
  const [cmd, args] = buildCommand(mode, language, dir, name, { input, out });
  const started = Date.now(); lifecycle.started = new Date(started).toISOString();
  let stdout = '', stderr = '', timedOut = false, truncated = false;
  const child = spawn(cmd, args, { env: { PATH: process.env.PATH }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const cap = (s, d, stream) => { const remaining = LIMITS.maxOutput - Buffer.byteLength(s); if (d.length > remaining) truncated = true; if (remaining <= 0) return s; let add = d.subarray(0, remaining).toString(); while (Buffer.byteLength(add) > remaining) add = add.slice(0, -1); onChunk({ stream, data: add }); return s + add; };
  child.stdout.on('data', d => { stdout = cap(stdout, d, 'stdout'); });
  child.stderr.on('data', d => { stderr = cap(stderr, d, 'stderr'); });
  let cancelled = false;
  const stop = () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  };
  const abort = () => { cancelled = true; stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; stop(); }, LIMITS.timeoutMs);
  let exitCode, exitSignal, spawnError;
  try {
    ({ exitCode, exitSignal, spawnError } = await new Promise(resolve => {
      child.on('error', err => resolve({ spawnError: err }));
      child.on('close', (c, s) => resolve({ exitCode: c, exitSignal: s }));
    }));
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (mode.mode === 'docker') {
      watch.finish();
      spawnSync('docker', ['rm', '-f', name], { timeout: 5000 });
      const remaining = spawnSync('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 5000 });
      if (remaining.status !== 0 || remaining.stdout.toString().trim()) throw new Error(`Cleanup unconfirmed for ${name}; operator action required`);
    }
  }
  if (spawnError) throw spawnError;
  lifecycle.finished = new Date().toISOString();
  const artifacts = collectArtifacts(out);
  if (input) chmodSync(input, 0o755);
  rmSync(root, { recursive: true, force: true }); lifecycle.destroyed = new Date().toISOString();
  const durationMs = Date.now() - started;
  const limits = classify({ stdout, stderr, exitCode, signal: exitSignal, timedOut, mode, observed: watch.observed });
  const contained = limits.some(l => l.triggered);
  return { sandboxId: name, lifecycle, mode, exitCode: exitCode ?? (exitSignal ? 137 : -1), signal: exitSignal, cancelled, imageIdentity, durationMs, stdout, stderr, truncated, timedOut, limits, contained, artifacts,
    resources: { timeoutMs: LIMITS.timeoutMs, memoryMb: LIMITS.memoryMb, pids: LIMITS.pids, cpus: LIMITS.cpus, maxOutputBytes: LIMITS.maxOutput, maxInputBytes: LIMITS.maxInputBytes, network: 'none', rootfs: 'read-only', outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr) } };
  } finally { watch.finish(); rmSync(root, { recursive: true, force: true }); }
}

// Open without following symlinks; inspect the opened descriptor, cap reads, reject special files.
export function collectArtifacts(out) {
  const artifacts = [];
  for (const f of readdirSync(out).slice(0, 128)) {
    const mime = ARTIFACT_EXT[extname(f).toLowerCase()];
    if (!mime || artifacts.length >= 4) continue;
    let fd;
    try {
      fd = openSync(join(out, f), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > LIMITS.maxArtifactBytes) continue;
      // Sandbox has exited and been removed before collection; no sandbox writer remains.
      const data = readFileSync(fd);
      if (data.length > LIMITS.maxArtifactBytes) continue;
      artifacts.push({ name: basename(f), mime, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), dataUrl: `data:${mime};base64,${data.toString('base64')}` });
    } catch { /* rejected file, including symlink */ } finally { if (fd !== undefined) closeSync(fd); }
  }
  return artifacts;
}
