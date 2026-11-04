# Vultr Agent Rush — submission kit (Challenge 1: Blast Radius Zero)

Source: https://lablab.ai/ai-hackathons/vultr-hackathon (read 3 Nov 2026). Also see the LabLab Hackathon Guidelines and Rule Book linked from that page.

## Rules checklist
| Requirement (source: event page) | Status |
|---|---|
| Vultr VM backend; web app deployed on Vultr as the central control layer | `deploy/` ready. **User must create the VM** |
| **Vultr Serverless Inference required for Challenge 1 agent LLM calls** (`https://api.vultrinference.com/v1`) | Default provider when `VULTR_INFERENCE_API_KEY` is set. **OpenAI is dev-only, so switch before recording** |
| Isolated sandbox execution (Docker strongly recommended; gVisor/E2B/OpenSandbox/Microsandbox are examples) | Docker + gVisor on the VM; bwrap locally |
| Containment focus: process isolation, no secrets in sandbox, time and memory caps, destroy after each task | All implemented and tested (`test/*.test.js`, 22 tests). Self-heal retries and CSV runs each use a fresh, destroyed sandbox |
| Real executed results, multi-step workflow | plan → review → run → verify → explain |
| Public GitHub repo with setup and docs; README explains Vultr services and architecture | README done. **User pushes** |
| Public demo URL | After VM deploy |
| Recorded demo video with ≥1 containment moment | Script below. **User records** |
| Slide presentation + cover image + title/short/long description + tags | Draft below. **User makes slides/cover** |
| Submit on lablab.ai (Vultr Community optional) | **User** |
| Teams of 1–6; register on lablab.ai **and** the LabLab Discord; enroll on the event page | **User** |
| Original work, MIT-compliant | MIT LICENSE |
| Vultr GPUs not available for this event | none used |

**Judging:** Application of Technology (how well the models are integrated), Presentation, Business Value, Originality. The page lists no weights.

**Deadline:** the online build runs 3–8 Nov 2026. The page doesn't give an exact cutoff time, so confirm it on the lablab dashboard. If the cutoff is 8 Nov 11:59 PM Mountain time (UTC−7, the Salt Lake City venue), that is **Mon 9 Nov 2026, 12:29 PM IST**. Plan to submit by **Sun 8 Nov evening IST** to be safe.

**No video length is stated on the page.** Keep it to about 2–3 minutes (LabLab convention).

## Demo video script (~2:45)
0:00 **Hook.** "An agent that only chats is a demo. An agent that executes safely, fixes its own bugs and proves what it ran is a product. This is SafeCode Agent, running on a Vultr VM."
0:10 **Architecture slide.** Vultr Serverless Inference writes and fixes the code, Docker + gVisor runs every attempt in a throwaway container, the Node control layer and Caddy run on Cloud Compute.
0:25 **CSV → chart.** Upload `sample-sales.csv` (read-only mount). Ask "Total revenue per region, and draw a bar chart". Review the code, Run. The chart drawn inside the sandbox appears with the verified numbers table.
0:55 **Self-heal.** Click "Buggy code (self-heal)" → Run. Attempt 1 fails with `KeyError`; the timeline shows the stderr going to the model, attempt 2 runs in a **new** sandbox ID and passes. Badge: "Self-healed in 2 attempts".
1:20 **Containment moment 1.** Fork bomb → **CONTAINED — pids**. Point out it was *not* sent for healing: we never ask the model to beat the sandbox.
1:40 **Containment moment 2.** curl exfil → env has no keys, `Network is unreachable`.
1:55 **Containment moment 3.** rm -rf / → read-only fs, "still alive".
2:10 **Live safety dashboard.** Counters tick live: runs, success, contained by type (pids, network, fs), self-healed, average sandbox lifetime ~tens of ms.
2:20 **Proof receipt.** Open the receipt: code SHA-256, CSV hash, output hash, limits, sandbox ID, created→destroyed timestamps, model. Download the JSON.
2:35 **Close.** Business value: auditable, self-correcting AI code execution for data teams, CI and support bots. Public URL and GitHub repo.

## Submission description draft
**Title:** SafeCode Agent — containment-first AI code execution on Vultr
**Short:** Plain English (or a CSV) in, verified output out. An agent on Vultr Serverless Inference writes code, you approve it, it runs in a throwaway Docker + gVisor sandbox that absorbs rm -rf, fork bombs and exfiltration, heals its own bugs in fresh sandboxes, and hands you a hash-signed proof receipt.
**Long:** SafeCode Agent is a web-based agent that does real work by writing and running code, with every action contained. The user describes a task. A model on Vultr Serverless Inference writes a Python or bash program, and a static policy scan flags risky patterns. The code is always shown before it runs. On approval, the Node control layer on a Vultr Cloud Compute VM starts a fresh container (gVisor runtime) with no network, a read-only root, 256 MB memory, 64 pids, a CPU cap, all capabilities dropped, a non-root user, seccomp and a 5 s kill timer. Output streams back and the model explains the verified result. The container is then destroyed. API keys never enter the sandbox. A live containment panel shows which limit absorbed each attack, and a full audit log records every step. Built-in escape demos let judges try rm -rf /, fork bombs, infinite loops, exfiltration, /etc/shadow reads and memory bombs themselves.

When code fails on its own, the agent self-heals: the model reads stderr, fixes the code and re-runs it in a brand-new sandbox (max 3 attempts, all visible in a timeline and the audit log); runs stopped by a containment limit are never "healed". Users can upload a CSV, mounted read-only, and get charts drawn inside the sandbox plus a verified-numbers table taken from real stdout. Every run produces a downloadable proof receipt (JSON + HTML) with the prompt, model, SHA-256 of the code, inputs and output, resource limits, sandbox ID, lifecycle timestamps and containment events. A live safety dashboard (Server-Sent Events) shows runs, successes, contained attacks by type and average sandbox lifetime.
**AI and tools used:** Vultr Serverless Inference (model: set via `VULTR_INFERENCE_MODEL`, default qwen3.8-27b), Docker, gVisor, Caddy, Node.js. OpenAI gpt-4o-mini was used only for local development.
**Tags:** Vultr, Serverless Inference, Docker, gVisor, Sandbox, AI Agents, Security, Self-healing, Data analysis, Auditability.

## User-only steps
1. Enroll on the lablab event page and join the LabLab Discord. Form or join a team (1–6 people).
2. Create a Vultr account with a fresh email, apply the gift code ($200), and subscribe to Serverless Inference to get a key.
3. Create an Ubuntu 24.04 VM, point DNS at it and run `deploy/setup.sh` (or ask the agent to walk you through it).
4. Set `VULTR_INFERENCE_API_KEY` and check that the header reads *Vultr Serverless Inference* and *Docker + gVisor*.
5. Create a public GitHub repo and push.
6. Record the video and make slides and a cover image.
7. Submit on lablab.ai before the deadline, and optionally share on Vultr Community.
