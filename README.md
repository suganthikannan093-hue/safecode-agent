# ⛨ SafeCode Agent — containment-first code execution on Vultr

Built for the **Vultr Agent Rush Hackathon — Challenge 1 "Blast Radius Zero"** (Pattern A: sandboxed code execution).

You describe a task in plain English. The agent (an LLM on **Vultr Serverless Inference**) writes a program, **shows it to you first**, and runs it only after you click Run. The run happens in a **fresh, throwaway sandbox** on a Vultr VM. Real stdout and stderr stream back, and the model explains the verified result. Hostile code such as `rm -rf /`, fork bombs, `while True`, exfiltration, `/etc/shadow` reads and memory bombs is **absorbed**. A live containment panel shows exactly which limit stopped it.

![normal run](docs/02-normal-task.png)
![containment](docs/04-contained-fork.png)

## Architecture

```mermaid
flowchart LR
  U[Browser UI<br/>task → review code → Run] -->|HTTPS| C[Caddy on Vultr VM<br/>auto TLS]
  C --> API[Node API server<br/>server/index.js<br/>control layer]
  API -->|generate / explain<br/>API key stays here| VSI[(Vultr Serverless Inference<br/>api.vultrinference.com/v1)]
  API --> P[Static policy scan<br/>flags, never blocks]
  API -->|code file, read-only mount| EX{Pluggable executor<br/>server/sandbox.js}
  EX -->|production| D[docker run --rm --runtime=runsc<br/>--network none --read-only tmpfs<br/>--memory --pids-limit --cpus<br/>--cap-drop ALL no-new-privileges<br/>uid 65534, seccomp, kill on timeout]
  EX -->|local demo, not production| B[bubblewrap namespaces<br/>+ prlimit + timeout]
  D -->|stdout/stderr stream, exit, limits| API
  API --> A[(Run history + audit log<br/>data/audit.jsonl)]
```

**Flow:** plan (LLM writes code) → human review (code shown, editable, policy scan flags) → dispatch (fresh sandbox) → verify (real output and exit code, limits classified) → explain (LLM summarises the real result) → destroy (container and temp dir removed) → audit.

**Containment guarantees**
| Limit | Docker mode (Vultr VM) | Local demo mode (bwrap) |
|---|---|---|
| Timeout + kill | `SIGKILL` + `docker rm -f` | `timeout -s KILL` + `SIGKILL` |
| Memory | `--memory 256m --memory-swap 256m` | `prlimit --as` |
| PIDs | `--pids-limit 64` (exact) | `prlimit --nproc` (per-uid, approximate) |
| CPU | `--cpus 0.5` | `prlimit --cpu` |
| No network | `--network none` | `--unshare-all` (empty net namespace) |
| Read-only FS | `--read-only` + 16 MB `noexec` tmpfs | read-only `/usr`, empty `/etc`, tmpfs `/tmp` |
| Secrets | env not passed, keys never enter sandbox | `--clearenv`, no `/etc`, `/home` or `/root` |
| Capabilities | `--cap-drop ALL`, `no-new-privileges` | `--cap-drop ALL` |
| Non-root | `--user 65534:65534` | `--uid 65534` |
| Seccomp | Docker default profile; gVisor (runsc) user-space kernel if installed | not applied (labelled in UI) |
| Lifecycle | fresh container per run, `--rm` | fresh namespaces + temp dir per run, deleted |

If no sandbox backend is available, the server **refuses to execute**. Generated code never runs directly on the host.

## Run locally

Needs Node 20 or later and no npm dependencies. Docker is optional: without it, the app uses bubblewrap (`apt install bubblewrap`) and labels it in the UI as *local demo sandbox, not production*.

```bash
cp .env.example .env        # add VULTR_INFERENCE_API_KEY (or OPENAI_API_KEY for local dev only)
npm run lint && npm test && npm run build
npm start                   # http://127.0.0.1:4321
```
With no key at all, a labelled offline mock is used. The escape demos always use fixed preset attack code, so containment is reproducible.

`python scripts/e2e.py` (Playwright) drives the full UI flow plus all six escape demos and writes screenshots to `docs/`.

## Deploy to a Vultr VM

1. **Account and credits:** register at vultr.com with an email not used on Vultr before, then apply the hackathon gift code under Billing to get $200 in credit.
2. **Serverless Inference:** in the Vultr console, open Serverless Inference, subscribe and copy the API key. List the models with `curl https://api.vultrinference.com/v1/models`.
3. **API key (optional):** create one under Account → API if you want the Vultr API or CLI.
4. **Create the VM:** Deploy → Cloud Compute → Shared CPU, Ubuntu 24.04, at least 2 GB RAM (a 2 vCPU / 4 GB plan is comfortable), with your SSH key. Optionally paste `deploy/cloud-init.yaml` into *Cloud-Init User-Data* after editing DOMAIN and REPO.
5. **DNS:** point an A record (or a free `sslip.io` name such as `<ip>.sslip.io`) at the VM's IP.
6. **SSH in as root:** `DOMAIN=<domain> REPO=<your public repo> bash deploy/setup.sh`. This installs Docker, gVisor `runsc`, Node 22, Caddy (HTTPS), the systemd unit `safecode` and the ufw firewall, and sets `SANDBOX_MODE=docker`.
7. Put `VULTR_INFERENCE_API_KEY` in `/opt/safecode/app/.env`, then run `systemctl restart safecode`. The header pill should read **Docker + gVisor (runsc)** and **Vultr Serverless Inference**.

## Demonstrate containment

Click any **Try to escape** button, review the attack code and the red policy-scan flags, then click **Run in sandbox**.
- `rm -rf /` → *readonly-fs, caps*; the script then prints `still alive`.
- `Fork bomb` → *pids*, `Errno 11 Resource temporarily unavailable`.
- `while True` → *timeout*, killed at 5 s.
- `curl exfil` → *network*, `Network is unreachable`. The env it can see contains no API keys.
- `read /etc/shadow` → *secrets*, the file doesn't exist in the sandbox.
- `Memory bomb` → *memory*, `MemoryError` at the 256 MB cap.

Then run a normal task to show that the app still works.

## Project layout
`server/index.js` API and static server · `server/sandbox.js` executor · `server/llm.js` Vultr/OpenAI/mock · `server/policy.js` scan · `server/demos.js` escape presets · `public/` UI · `test/containment.test.js` · `deploy/` Vultr VM · `HACKATHON.md`.

MIT licensed.
