# Vultr Agent Rush — submission kit (Challenge 1: Blast Radius Zero)

Source: https://lablab.ai/ai-hackathons/vultr-hackathon (read 3 Nov 2026). Also see the LabLab Hackathon Guidelines and Rule Book linked from that page.

## Rules checklist
| Requirement (source: event page) | Status |
|---|---|
| Vultr VM backend; web app deployed on Vultr as the central control layer | `deploy/` ready. **User must create the VM** |
| **Vultr Serverless Inference required for Challenge 1 agent LLM calls** (`https://api.vultrinference.com/v1`) | Default provider when `VULTR_INFERENCE_API_KEY` is set. **OpenAI is dev-only, so switch before recording** |
| Isolated sandbox execution (Docker strongly recommended; gVisor/E2B/OpenSandbox/Microsandbox are examples) | Docker + gVisor on the VM; bwrap locally |
| Containment focus: process isolation, no secrets in sandbox, time and memory caps, destroy after each task | All implemented and tested (`test/containment.test.js`) |
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

## Demo video script (~2:30)
0:00 **Hook.** "An agent that only chats is a demo. An agent that executes safely is a product. This is SafeCode Agent, running on a Vultr VM."
0:10 **Architecture slide.** Show the mermaid diagram: Vultr Serverless Inference writes the code, Docker + gVisor runs it, the Node control layer and Caddy run on Cloud Compute.
0:30 **Normal task.** Type "Generate 10 fake sales rows and total revenue per region". Show the code, point out that it's reviewed before running, then click Run. The output streams in, the badge turns green ✓ and the explanation appears.
1:00 **Containment moment 1.** Click Fork bomb. The policy scan flags it red but still lets it run. Click Run and the badge shows **CONTAINED — pids**, with the Process limit tile lit.
1:25 **Containment moment 2.** Click curl exfil. The output shows the env holds no keys and the request fails with `Network is unreachable`.
1:45 **Containment moment 3.** Click rm -rf /. It hits a read-only fs and prints "still alive". Then rerun the normal task to prove the host is untouched.
2:05 **Audit log and history.** Every generate, approval and destroy is logged.
2:15 **Close.** Talk about business value: safe AI code execution for data teams, CI and support bots. Show the public URL and the GitHub repo.

## Submission description draft
**Title:** SafeCode Agent — containment-first AI code execution on Vultr
**Short:** Plain English in, verified output out. An agent on Vultr Serverless Inference writes code, you approve it, and it runs in a throwaway Docker + gVisor sandbox that absorbs rm -rf, fork bombs and exfiltration.
**Long:** SafeCode Agent is a web-based agent that does real work by writing and running code, with every action contained. The user describes a task. A model on Vultr Serverless Inference writes a Python or bash program, and a static policy scan flags risky patterns. The code is always shown before it runs. On approval, the Node control layer on a Vultr Cloud Compute VM starts a fresh container (gVisor runtime) with no network, a read-only root, 256 MB memory, 64 pids, a CPU cap, all capabilities dropped, a non-root user, seccomp and a 5 s kill timer. Output streams back and the model explains the verified result. The container is then destroyed. API keys never enter the sandbox. A live containment panel shows which limit absorbed each attack, and a full audit log records every step. Built-in escape demos let judges try rm -rf /, fork bombs, infinite loops, exfiltration, /etc/shadow reads and memory bombs themselves.
**AI and tools used:** Vultr Serverless Inference (model: set via `VULTR_INFERENCE_MODEL`, default qwen3.8-27b), Docker, gVisor, Caddy, Node.js. OpenAI gpt-4o-mini was used only for local development.
**Tags:** Vultr, Serverless Inference, Docker, gVisor, Sandbox, AI Agents, Security.

## User-only steps
1. Enroll on the lablab event page and join the LabLab Discord. Form or join a team (1–6 people).
2. Create a Vultr account with a fresh email, apply the gift code ($200), and subscribe to Serverless Inference to get a key.
3. Create an Ubuntu 24.04 VM, point DNS at it and run `deploy/setup.sh` (or ask the agent to walk you through it).
4. Set `VULTR_INFERENCE_API_KEY` and check that the header reads *Vultr Serverless Inference* and *Docker + gVisor*.
5. Create a public GitHub repo and push.
6. Record the video and make slides and a cover image.
7. Submit on lablab.ai before the deadline, and optionally share on Vultr Community.
