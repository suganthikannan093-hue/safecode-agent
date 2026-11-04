// Pluggable sandbox executor. Generated code is NEVER run unsandboxed on the host.
//   docker : fresh container per run, --network none, --read-only, tmpfs, mem/pids/cpu caps,
//            --cap-drop ALL, no-new-privileges, non-root, default seccomp; runsc (gVisor) if installed.
//   bwrap  : LOCAL DEMO SANDBOX, NOT PRODUCTION. bubblewrap namespaces + prlimit + timeout.
//   none   : refuse to execute.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const LIMITS = {
  timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS || 5000),
  memoryMb: Number(process.env.SANDBOX_MEMORY_MB || 256),
  pids: Number(process.env.SANDBOX_PIDS || 64),
  cpus: process.env.SANDBOX_CPUS || '0.5',
  maxOutput: 64 * 1024,
  maxInputBytes: Number(process.env.SANDBOX_MAX_INPUT_BYTES || 1024 * 1024),
  maxArtifactBytes: 2 * 1024 * 1024,
};
const ARTIFACT_EXT = { '.png': 'image/png', '.svg': 'image/svg+xml' };
const has = (cmd, args = ['--version']) => { try { return spawnSync(cmd, args, { timeout: 5000 }).status === 0; } catch { return false; } };

export function detectMode() {
  const want = process.env.SANDBOX_MODE || 'auto';
  if ((want === 'auto' || want === 'docker') && has('docker', ['info'])) {
    const info = spawnSync('docker', ['info', '--format', '{{json .Runtimes}}']).stdout?.toString() || '';
    return { mode: 'docker', runtime: info.includes('runsc') ? 'runsc' : 'runc', label: info.includes('runsc') ? 'Docker + gVisor (runsc)' : 'Docker (runc + default seccomp)', production: true };
  }
  if ((want === 'auto' || want === 'bwrap') && has('bwrap') && has('prlimit')) {
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
    return ['docker', ['run', '--rm', '--name', name, ...(mode.runtime === 'runsc' ? ['--runtime=runsc'] : []),
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

export function classify({ stdout, stderr, exitCode, signal, timedOut, mode }) {
  const out = `${stdout}\n${stderr}`;
  const t = (id, label, triggered, active = true) => ({ id, label, active, triggered });
  const dockerOrBwrap = mode.mode !== 'none';
  return [
    t('timeout', `Wall-clock timeout (${LIMITS.timeoutMs} ms)`, timedOut),
    t('memory', `Memory cap (${LIMITS.memoryMb} MB)`, /MemoryError|Cannot allocate memory|out of memory/i.test(out) || exitCode === 137 && !timedOut),
    t('pids', `Process limit (${LIMITS.pids} pids)`, /Resource temporarily unavailable|BlockingIOError|fork: retry|Errno 11/.test(out)),
    t('network', 'No network (isolated namespace)', /Network is unreachable|Temporary failure in name resolution|Name or service not known|Could not resolve|Errno -[23]|Errno 101|Errno 99/i.test(out)),
    t('readonly-fs', 'Read-only root filesystem', /Read-only file system|Errno 30/.test(out)),
    t('secrets', 'Host secrets & env not mounted', /\/etc\/(shadow|passwd)|No such file or directory: '\/(etc|root|home)/.test(out) || /Permission denied/.test(out)),
    t('caps', 'All Linux capabilities dropped', /Operation not permitted|Errno 1\b/.test(out)),
    t('non-root', 'Runs as uid 65534 (nobody)', /Permission denied|Errno 13/.test(out)),
    t('seccomp', mode.mode === 'docker' ? 'Seccomp syscall filter' : 'Seccomp (Docker mode only)', false, mode.mode === 'docker'),
    t('ephemeral', 'Fresh environment, destroyed after run', false, dockerOrBwrap),
  ];
}

// inputs: [{ name, data: Buffer }] mounted READ-ONLY at /work/input. /work/out is the only writable,
// persisted path; PNG/SVG artifacts there are collected (size-capped) and the dir is destroyed.
export async function execute({ code, language = 'python', inputs = [], onChunk = () => {} }) {
  const mode = detectMode();
  if (mode.mode === 'none') throw new Error('No sandbox available; refusing to run generated code on the host.');
  if (!RUNNERS[language]) throw new Error(`Unsupported language: ${language}`);
  const lifecycle = { created: new Date().toISOString() };
  const root = mkdtempSync(join(tmpdir(), 'safecode-'));
  const dir = join(root, 'code'), out = join(root, 'out'); mkdirSync(dir); mkdirSync(out); mkdirSync(join(dir, 'input')); mkdirSync(join(dir, 'out')); // mountpoints
  writeFileSync(join(dir, FILES[language]), code); chmodSync(dir, 0o755); chmodSync(out, 0o777); chmodSync(root, 0o755);
  let input = null;
  if (inputs.length) {
    input = join(root, 'input'); mkdirSync(input);
    for (const f of inputs) {
      if (f.data.length > LIMITS.maxInputBytes) throw new Error(`Input ${f.name} exceeds ${LIMITS.maxInputBytes} bytes`);
      const fn = join(input, basename(f.name)); writeFileSync(fn, f.data); chmodSync(fn, 0o444);
    }
    chmodSync(input, 0o555);
  }
  const name = `safecode-${randomUUID().slice(0, 8)}`;
  const [cmd, args] = buildCommand(mode, language, dir, name, { input, out });
  const started = Date.now(); lifecycle.started = new Date(started).toISOString();
  let stdout = '', stderr = '', timedOut = false, truncated = false;
  const child = spawn(cmd, args, { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  const cap = (s, d, stream) => { if (s.length >= LIMITS.maxOutput) { truncated = true; return s; } const add = d.toString().slice(0, LIMITS.maxOutput - s.length); onChunk({ stream, data: add }); return s + add; };
  child.stdout.on('data', d => { stdout = cap(stdout, d, 'stdout'); });
  child.stderr.on('data', d => { stderr = cap(stderr, d, 'stderr'); });
  const timer = setTimeout(() => {
    timedOut = true; child.kill('SIGKILL');
    if (mode.mode === 'docker') spawnSync('docker', ['rm', '-f', name]);
  }, LIMITS.timeoutMs);
  const { exitCode, signal } = await new Promise(res => child.on('close', (c, s) => res({ exitCode: c, signal: s })));
  clearTimeout(timer); lifecycle.finished = new Date().toISOString();
  if (!timedOut && Date.now() - started >= LIMITS.timeoutMs) timedOut = true;
  const artifacts = [];
  try {
    for (const f of readdirSync(out)) {
      const fp = join(out, f), st = statSync(fp), mime = ARTIFACT_EXT[extname(f).toLowerCase()];
      if (!st.isFile() || !mime || st.size > LIMITS.maxArtifactBytes || artifacts.length >= 4) continue;
      const data = readFileSync(fp); let view = data;
      // hand-written SVGs often omit xmlns, which <img> needs; patch the display copy only (hash is of the raw file)
      if (mime === 'image/svg+xml' && !/xmlns=/.test(data.toString('utf8', 0, 400))) view = Buffer.from(data.toString('utf8').replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"'));
      artifacts.push({ name: basename(f), mime, bytes: st.size, sha256: createHash('sha256').update(data).digest('hex'), dataUrl: `data:${mime};base64,${view.toString('base64')}` });
    }
  } catch { /* out dir unreadable: no artifacts */ }
  if (input) chmodSync(input, 0o755);
  rmSync(root, { recursive: true, force: true }); lifecycle.destroyed = new Date().toISOString();
  const durationMs = Date.now() - started;
  const limits = classify({ stdout, stderr, exitCode, signal, timedOut, mode });
  const contained = limits.some(l => l.triggered);
  return { sandboxId: name, lifecycle, mode, exitCode: exitCode ?? (signal ? 137 : -1), signal, durationMs, stdout, stderr, truncated, timedOut, limits, contained, artifacts,
    resources: { timeoutMs: LIMITS.timeoutMs, memoryMb: LIMITS.memoryMb, pids: LIMITS.pids, cpus: LIMITS.cpus, maxOutputBytes: LIMITS.maxOutput, maxInputBytes: LIMITS.maxInputBytes, network: 'none', rootfs: 'read-only', outputBytes: stdout.length + stderr.length } };
}
