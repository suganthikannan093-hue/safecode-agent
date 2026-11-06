# Vultr Agent Rush submission kit — SafeCode Agent

Official [event page](https://lablab.build/ai-hackathons/vultr-hackathon), checked 2026-11-06: Challenge 1 requires a Vultr VM/web deployment, Vultr Serverless Inference and isolated execution. Submission expectations include repository/setup documentation, public demo URL, video, clear architecture/use case and a containment moment. The page gives the online build window as 3–8 November 2026; exact submission cutoff must be confirmed in the registration dashboard.

## Submission copy

**Title:** SafeCode Agent — customer-file analysis with controlled execution and signed evidence

**Short description:** An agent on Vultr generates code you can review, executes each attempt in a fresh restricted sandbox, returns charts and results, and issues a verifiable signed execution record. Operators can cap attempts, cancel work and pause execution.

**Long description:** SafeCode targets AI product teams adding Python analysis of customer files. Vultr Serverless Inference generates and optionally repairs code; the Node controller on Vultr Cloud Compute admits work against configured budgets and dispatches each attempt to Docker with required gVisor, no network, restricted mounts and resource limits. The UI streams results and shows each attempt. CSV input is read-only; charts return through a bounded artifact collector. Dedicated-workspace authentication protects execution and evidence APIs. Cancellation, pause and persistent daily request/attempt budgets give operators control over agent loops.

Every invocation gets a unique receipt with source/input/output hashes, configured policy, runtime image identity, lifecycle and attempt provenance. Ed25519 signatures can be checked with an independently trusted public key. The interface distinguishes controller-observed timeouts from classifications inferred from untrusted program output. This signature proves issuer attribution and record integrity, not output correctness or absence of sandbox escape. The prototype is not independently assessed for adversarial or multitenant use.


**Technology:** Vultr Cloud Compute, Vultr Serverless Inference (record actual configured model), Node.js, Docker, gVisor, Caddy, Python, Ed25519. Development mocks/fallbacks must be labelled and are not live Vultr evidence.

**Tags:** Vultr, AI agents, code execution, CSV analysis, sandbox, gVisor, execution receipts.

## Presentation outline

1. Buyer and blocked workflow: customer-file analysis needing controlled execution.
2. Architecture and trust boundaries: controller, inference, sandbox and signing key.
3. Working CSV, repair and containment demonstration.
4. Receipt verification, operator budgets/cancellation and honest limitations.
5. Independent assessment milestones.

Use [the timed demo script](docs/DEMO.md). Feature-by-feature demonstrations are in [FEATURES.md](docs/FEATURES.md). Existing screenshots predate v0.3 and must not be used as evidence for new controls.

## Submission checklist — no completion implied

- [ ] Confirm registration, eligibility, exact cutoff and any current submission-field requirements in the organizer dashboard.
- [ ] Deploy the current revision on Vultr with runsc, pinned images, access/signing configuration and live Vultr inference.
- [ ] Pass portable checks, Linux integration tests and `npm run demo -- --competition`; retain actual report and receipts.
- [ ] Record the main demo including a containment moment and receipt limitations; capture new screenshots and slides.
- [ ] Publish the repository with setup documentation and MIT attribution.
- [ ] Provide the actual demo URL and appropriate private evaluator access; keep tokens out of public materials.
- [ ] Submit repository, URL, video and required presentation assets through the organizer portal; retain submission receipt.

Deployment, public publishing, video recording and organizer submission have not been performed merely by adding this kit. Independent security assessment remains outstanding.
