// Static pre-execution policy scan. It FLAGS dangerous patterns but never blocks:
// the point of the demo is that the sandbox absorbs them anyway.
const RULES = [
  { id: 'destructive-fs', severity: 'high', re: /rm\s+-[a-z]*r[a-z]*f|shutil\.rmtree\(|os\.remove\(|unlink\(|mkfs|dd\s+if=/i, label: 'Destructive filesystem operation' },
  { id: 'fork-bomb', severity: 'high', re: /:\(\)\s*\{\s*:\|:&\s*\};:|os\.fork\(\)|while.*fork|subprocess\.Popen\(.*\)\s*$/m, label: 'Process explosion / fork bomb' },
  { id: 'infinite-loop', severity: 'medium', re: /while\s+(True|1|true)\s*:?|for\s*\(\s*;\s*;\s*\)|while\s+:\s*;/, label: 'Unbounded loop' },
  { id: 'network', severity: 'high', re: /curl\s|wget\s|requests\.|urllib|socket\.|http\.client|fetch\(|nc\s+-/, label: 'Network access / possible exfiltration' },
  { id: 'secrets', severity: 'high', re: /\/etc\/shadow|\/etc\/passwd|\.ssh|\.aws|os\.environ|printenv|\benv\b\s*$|API_KEY|\/proc\/1\//m, label: 'Reads host secrets or environment' },
  { id: 'memory-bomb', severity: 'medium', re: /\*\s*10\s*\*\*\s*\d|bytearray\(\s*\d{8,}|\[0\]\s*\*\s*\d{8,}|' '\s*\*\s*\d{8,}|\.append\(.*\)\s*$/m, label: 'Large memory allocation' },
  { id: 'privilege', severity: 'high', re: /sudo\s|chmod\s+[0-7]*s|setuid|mount\s|chroot|nsenter|docker\s/, label: 'Privilege escalation attempt' },
];
export function scan(code = '') {
  const findings = RULES.filter(r => r.re.test(code)).map(({ id, severity, label }) => ({ id, severity, label }));
  return { findings, risk: findings.some(f => f.severity === 'high') ? 'high' : findings.length ? 'medium' : 'low' };
}
