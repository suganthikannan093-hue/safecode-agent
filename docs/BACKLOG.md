# Engineering backlog

Historical planning baseline from 2026-11-05. Several items now have competition implementations: shared-operator authentication (not tenant ownership), required runsc, pinned production images, bounded tmpfs, budgets/cancellation, artifact checks, signed unique receipts, evidence labels and retention controls. See [current feature status](../FEATURES.md). Independent assessment, multitenancy, automated crash recovery and external alert routing remain outstanding. Acceptance criteria below are pilot gates, not a claim they all passed.

Source review: server/index.js, server/agent.js, server/sandbox.js and server/llm.js. Findings are code observations; deployment configuration and runtime behaviour have not been independently verified. Everything below is planned unless explicitly described as existing.

## P0 — prerequisites for customer-data execution

### 1. Access and ownership

The API has no authentication/authorisation gate and uses shared maps for uploads, drafts and receipts. Add authenticated access to execution, uploads, history, audit, stats, events and receipts; scope objects to an authorised principal. Random IDs are not access control. Use a dedicated deployment per initial customer.

Acceptance: unauthenticated reads/writes fail; two principals cannot access or execute one another’s resources; direct receipt downloads and SSE are included; no credentials appear in logs. If browser sessions use cookies, cover CSRF and session invalidation.

### 2. Enforce the selected runtime and verify cleanup

Docker mode currently accepts runc when runsc is unavailable and labels both production. Add an explicit required-runtime policy that fails closed, pin images by digest, validate limit configuration, and capture actual runtime/image identity. Handle spawn failures and cleanup in all error paths. Verify container removal before recording destruction; retain cleanup-failed state and alert operators otherwise.

Acceptance: missing required runsc refuses execution; timeout/crash/cancellation leaves no surviving sandbox; failed removal is never recorded as confirmed destruction. Exercise these on the intended Linux host.

### 3. Bound abuse and safely collect artifacts

Per-run limits exist; aggregate admission, storage and model budgets do not. Add bounded concurrency/queueing, request and upload quotas, total workspace disk limits, run/retry budgets, cancellation and an operator kill switch. The JSON body reader continues accumulating after rejecting its limit; stop buffering immediately. Artifact collection uses statSync, which follows symlinks: reject symlinks and non-regular files with race-resistant opening, bound reads, and prevent host file disclosure. Choose PNG-only pilot output or isolate/sanitise active formats.

Acceptance: concurrent/repeated requests stay within configured budgets; every retry counts; oversized bodies stop buffering; many files cannot exhaust host storage; a sandbox-created symlink cannot make the collector read host files. Kill switch rejects new work and terminates active work.

### 4. Data handling and retention

CSV preview rows are sent to inference during generation; code/stdout/stderr may be sent during fixes and explanations. “No network in sandbox” does not mean “no customer data leaves the service.” Document these flows, obtain the customer’s approved processing configuration, minimise payloads and support disabling optional model calls. Define expiry/deletion for uploads, drafts, receipts, logs and backups; redact sensitive content where appropriate.

Acceptance: inspect outbound payloads with a test provider; prohibited fields never leave; configured expiry/deletion covers all stores; document what remains in backups and for how long.

## P1 — evidence customers can rely on

### 5. Honest evidence and independent checks

Containment categories are mostly regex matches over untrusted stdout/stderr, with timeout also tracked by the controller. A program can print “MemoryError” without hitting a memory limit. Separate configured controls, controller/runtime observations and untrusted-output inferences. “Verified numbers” currently parses RESULTS_JSON emitted by the program; label it “program-reported results” and use an independently computed expected answer for demo correctness.

Receipts are currently unsigned JSON with hashes. Add a versioned schema, policy digest, runtime/image identity, per-attempt model provenance, unique execution ID per invocation and signing outside the sandbox. Re-running a draft currently reuses its ID and overwrites the receipt; preserve each execution separately. Provide a verifier and key-distribution/rotation procedure.

Acceptance: a fake error string is never presented as trusted enforcement evidence; repeated execution retains separate receipts; altered signed content fails verification; missing/untrusted signatures are distinguished; all attempts remain attributable. Signing authenticates the issuer’s record, not the truth of every observation or freedom from escape.

### 6. Independent assessment and operations

Threat-model API, inference, controller, Docker daemon, host, runtime, artifact collection and receipt signing. Arrange independent adversarial assessment for the actual deployment configuration, including control bypass, host exposure and cleanup. Validate cross-principal access even in the dedicated pilot; require a separate multitenant isolation assessment before any shared-customer deployment.

Acceptance: track scope, environment, findings and remediation/retest evidence; resolve critical findings before customer-data use. Exercise alerts for cleanup failure, queue saturation, repeated denials and host pressure. Assign patching, incident response and key-revocation owners.

## P2 — repeatable adoption after foundations

Ship one Python client/example for upload → review → run → receipt, with explicit timeout/cancellation behaviour. Test with synthetic fixtures and document error responses. Keep first integration within the offer’s support budget. Export a customer-specific review package with data flow, retention policy, test scope, limitations and operational contacts.

## Release decisions

Demo: synthetic data, controlled access, honest claim boundaries. A successful scripted demo is not an independent assessment.

Private pilot with customer data: P0 complete, P1 evidence semantics corrected, independent assessment scoped to the intended use completed and critical findings remediated, buyer acceptance criteria/data flows agreed. If signing is deferred, describe receipts as unsigned and do not sell authenticated evidence.

