# Feature guide and demonstration index

All demonstrations use synthetic data. Automated runtime demonstrations: `npm run demo -- --competition` against a prepared, dedicated demo workspace; see DEMO.md. “Covered by portable tests” does not mean runtime containment has been validated.

## 1. Generate, review and execute

Describe a task, inspect/edit generated Python or Bash, then click **Run in sandbox**. No initial program runs before that action. The advisory pattern scan highlights selected risks; it does not establish safety or block execution. With self-healing enabled, later model edits execute automatically, up to three attempts.

Demo: request `sum(range(101))`, review the source, run, and compare stdout with 5050. Edit it to print 42 and repeat. Show the changed code hash and distinct execution ID. Automated: CSV and repeated-draft scenarios in scripts/demo.js.

## 2. CSV input, charts and reported results

CSV input is capped at 1 MiB by default and mounted read-only. Code may write image artifacts in `/work/out`; the collector accepts at most four PNG/SVG files, each at most 2 MiB, inspecting at most 128 directory entries. Symlinks, multi-link files and non-regular files are rejected. SVGs are displayed as image resources, never injected into the page as HTML. The host never evaluates their code.

`RESULTS_JSON` is parsed into a table labelled **program-reported results**. It is not an independent calculation.

Demo: upload `docs/demo-sales.csv`, containing `north,120`, `south,80`, `north,200`, `east,50`; expected totals are north=320, south=80, east=50. Show the chart and read-only input hash. Automated: CSV scenario; artifact-symlink portable regression; CSV integration tests.

## 3. Fresh sandbox and restricted runtime

Each attempt receives a new sandbox ID. Docker uses no network, a read-only root, a non-root UID, dropped capabilities, no-new-privileges, process/memory/CPU limits, bounded temporary space and a controller timeout. Production requires runsc and digest-pinned images, and rejects execution when either is missing. Development may use runc or bubblewrap, explicitly labelled. No direct-host execution fallback exists.

Demo: use every built-in preset (read-only write, fork/process exhaustion, infinite loop, network attempt, protected-file read and memory pressure), then rerun the normal CSV. Show actual evidence classifications. These are functional control probes, not an independent escape assessment. Automated: all preset scenarios and test:integration.

## 4. Evidence categories and spoof resistance in presentation

Timeout is labelled `controller-observed`; other currently classified categories are `untrusted-output-inference`. A matching stderr string may come from a real denial or a program deliberately printing it. Configured controls are recorded separately.

Demo: edit Python to `print("MemoryError")`. Exit is zero; the memory category is explicitly an inference, not verified memory enforcement. Automated: spoofed-error scenario and portable regression. Conservative retry suppression still applies when any signal is present.

## 5. Self-healing

An ordinary failed run may be repaired by the selected model in a fresh sandbox, with a maximum of three attempts. Cancellation or a containment signal suppresses repair. Live repair shares code/stdout/stderr with inference and requires `SAFECODE_MODEL_OUTPUT_SHARING=1`. The offline preset repair is deterministic and clearly labelled.

Demo: select **Buggy code (self-heal)**; show KeyError, the repair and different sandbox IDs. Automated: self-heal scenario, portable bounded-loop tests and integration tests. Disable the checkbox to keep review approval limited to the initial program.

## 6. Signed receipts and independent verification

Each invocation has a new UUID even when reusing a draft. JSON contains final code, input/output hashes, configured-policy digest, image identity, lifecycle, evidence limits and all attempt sources/model attribution. Production requires Ed25519 signing; local unsigned mode is explicit. Private keys remain outside sandbox mounts.

Demo: download JSON; verify using `node scripts/verify-receipt.js receipt.json trusted-public.pem`; alter stdout in a copy and verify again (must exit nonzero). Run the same draft twice and retrieve both receipts. Obtain the trusted public key independently from the operator; downloading it from the same compromised server is not independent trust. Automated: signature/tamper and repeated-draft scenarios, portable cryptographic regression.

## 7. Access and session revocation

Configured token protects all workspace APIs, including receipts, audit and SSE. Browser login creates a one-hour HttpOnly, SameSite=Strict cookie (Secure in production). Bearer auth supports clients. Mutations reject cross-origin requests; login is limited to ten attempts per minute and at most 32 active sessions. This is shared operator access, not separate customer identities or roles.

Demo: signed-out API request returns 401; log in; download a receipt; sign out and retry. Portable HTTP tests exercise revocation and cross-origin rejection. Do not put access tokens in demo recordings or URL query strings.

## 8. Budgets, cancellation and pause

Defaults: two concurrent runs, 100 sandbox attempts and 100 live model HTTP requests per UTC day. Every retry consumes another attempt; model JSON-repair calls also count. Saturated concurrency returns 429 without queueing. Counters and pause survive restart; these are count limits, not dollar-accurate billing. Generation is separately limited to two in-flight requests. Sessions, SSE connections, uploads, drafts and receipts are capped.

Demo: start an infinite loop and click **Cancel active run**; then **Pause and cancel all runs** and try another run (503). Resume. Show budget counters. Automated: cancellation/pause/accounting scenarios and portable persistence/concurrency/exhaustion tests. To visibly demonstrate exhaustion, use a disposable workspace with `SAFECODE_DAILY_ATTEMPTS=1`, run once, then try again; never reset production counters to make a demo pass.

Pause aborts sandbox work and prevents new paid model calls; it cannot retract an inference request already sent. No token-dollar cost estimate or vendor billing guarantee is provided.

## 9. Retention and deletion

Default retention is 24 hours, configurable 1–168 hours. A minute sweep expires uploads/drafts, receipt files, history/audit entries and task-bearing dashboard events. Audit is capped at 500 entries, history at 100, each object store at 100 by default. Receipt downloads and local demo evidence saved elsewhere are not deleted by service retention.

Demo: in a disposable workspace, select the deletion checkbox and **Delete stored data**. Old drafts/receipts disappear; counters and signing keys remain. Active work blocks deletion with 409. For TTL validation, set one-hour retention and inspect after an hour plus a minute; portable tests cover explicit deletion, not elapsed-time guarantees. No backups are created by the app; external backups need their own policy.

## 10. Privacy controls

Input preview sharing and output sharing default off. With input sharing off, the model is told to inspect headers inside the sandbox. Prompts, filenames, file sizes and generated code still reach inference. Live self-healing/explanations require explicit output-sharing opt-in.

Demo: show the status text with sharing disabled; complete CSV execution without a model explanation. On synthetic data only, enable output sharing, restart, show status and self-heal. Inspect server/llm.js and docs/SECURITY.md for exact payload bounds. No-network execution does not imply no inference data transfer.

## 11. Live dashboard and audit

SSE updates run outcomes, signal categories and retry counts. History/audit show recent activity; operational errors include cleanup failures and admission denials. Dashboard counters are process-local and reset on restart/deletion; they are not durable compliance metrics. Audit files are bounded and mutable, not tamper-proof.

Demo: run normal, preset and healed executions; watch counters, then inspect audit entries and matching receipts. Automated: runtime dashboard and SSE integration tests. External alert routing is an operations task; no pager integration is claimed.

## 12. Integration and commercial handoff

`examples/client.py` demonstrates upload → generation → explicit terminal approval → streamed result → receipt download using Python's standard library. It disables automatic healing so only the displayed code is approved. HTTP errors propagate; the example has a 90-second response timeout and explains the cancellation endpoint.

Demo: set the endpoint and token-file environment variables, run `python3 examples/client.py`, inspect the code and type RUN. Verify the saved receipt. Use docs/pilot/offer.md for the proposed fixed-scope private pilot; pricing remains unvalidated and no customer commitments are implied.
