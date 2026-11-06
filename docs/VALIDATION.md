# Validation record — 2026-11-06

Environment: development Mac, Node v26.13.0. No Docker or bubblewrap executable available. This is first-party functional testing, not an independent security assessment.

## Completed locally

- `npm run lint`: passed JavaScript syntax checks.
- `npm test`: 14 portable regressions passed, zero skipped. Coverage: API authentication, login/logout, origin checks, declared/chunked oversized requests, pause/fail-closed execution, release of admission slots, deletion with retained budgets, signature tampering/wrong keys/JSON round trips, artifact symlink rejection, evidence classifications, persistent quotas and cancellation, bounded healing, receipt metadata.
- `npm run build`: modules import and static assets exist.
- `bash -n deploy/setup.sh`: passed.
- Python compilation for client and both capture scripts: passed.
- `git diff --check`: passed.

## Blocked / not performed

`npm run test:integration` exited nonzero at preflight: “No sandbox available - execution disabled.” The Linux runtime cases were not run. They include successful Python/Bash execution, CSV read-only mounts, image collection, all control presets, fresh retry containers, timeout/cancellation cleanup and separate receipts for repeated drafts.

Live Vultr deployment/inference, production tmpfs/runsc/image checks, browser walkthrough/screenshots, the complete competition demo runner, elapsed-time TTL testing, narrated video and submission were not performed. The demo scripts and documentation are provided; they are not execution evidence. Historical PNGs are labelled as v0.2.

## Before recording/submitting

Use a dedicated configured Linux VM. Run portable checks and the integration suite, then `npm run demo -- --competition` with operator credentials supplied through a private file and a separately trusted receipt public key. Inspect `data/demo-evidence/report.json` and all saved receipts. Resolve every failed scenario before claiming it works in the recording. Record commit, runtime/image identity and inference model with the evidence.

Independent assessment, shared-tenant validation and operational alert delivery remain separate release gates before a real customer pilot.
