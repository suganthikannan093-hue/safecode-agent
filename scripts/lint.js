import { readdirSync } from 'node:fs'; import { spawnSync } from 'node:child_process';
let bad = 0; for (const d of ['server', 'scripts', 'test', 'public']) for (const f of readdirSync(d).filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', `${d}/${f}`]); if (r.status) { bad++; console.error(r.stderr.toString()); } }
console.log(bad ? `lint: ${bad} file(s) failed` : 'lint: all files pass node --check'); process.exit(bad ? 1 : 0);
