# Security boundaries and remaining work

This source-level description is not independent validation. The intended competition deployment is one trusted operator/team per VM, synthetic demo data and authenticated access. Shared-customer deployment is not supported.

## Trust boundaries

Untrusted: generated/edited code, CSV contents, stdout/stderr, artifact files, model replies and user requests. Trusted: controller, host OS, Docker daemon, selected runtime, signing process, key provisioning and operator. The controller belongs to the Docker group: controller compromise can imply host compromise. gVisor reduces exposure; it is not an impossibility proof for escapes.

The sandbox receives only code and explicit input/output mounts, with a restricted environment. Model API keys, access credentials and receipt keys are not passed to it. Production work files live in a dedicated tmpfs limited to 64 MiB aggregate and 8192 inodes via the deployment setup; contention can fail runs rather than fill the host disk. Local development does not claim this aggregate disk bound.

Artifact collection occurs after the sandbox process ends and Docker removal is checked. Files are opened with O_NOFOLLOW and inspected through the opened descriptor; size/type/link checks exclude symlink and special-file attacks. SVG is image-only in the UI with a restrictive CSP. Downloaded artifacts remain untrusted files.

## Evidence model

A controller observation differs from an error-string classification. The controller records its own wall-clock timeout, a cgroup `pids.events` hit, and a runtime OOM kill (`OOMKilled` or `memory.events`) sampled before the container is removed. Strings can be spoofed, omitted or truncated. A printed `MemoryError` without that telemetry stays an inference. The `contained` field is retained for compatibility and means “one or more containment signals recorded”, not proven containment. Static scans are advisory. The `verified` field is also retained for compatibility and contains parsed program-reported values, not independently verified answers.

The pinned shell image's `rm` is BusyBox and rejects `--no-preserve-root`, so that flag never exercises the read-only root. The preset deletes without that flag and touches `/var/tmp`, which is on the read-only root and returns "Read-only file system". `--network none` can leave a hostname lookup blocked until the wall-clock timeout; the network preset connects to a numeric address so the denial is `Errno 101` inside the limit. That denial is still inferred from program output.

The image's own `/etc/passwd` is mode 0644, ships with the image, and contains account names without password hashes. It is not a mounted host secret. `/etc/shadow` and `/root/.ssh` are not readable by uid 65534. A denial does not prove the host's copies were absent; the image may contain its own files that the sandbox user cannot read.

Customer files are mounted read-only. On gVisor's 9p read-only mount the kernel reports `ST_RDONLY` and a write fails with `EACCES` (errno 13). `EROFS` (errno 30) is also a denial. File mode 0444 can produce `EACCES` on a writable mount, so the read-only flag is the mount proof. None of these observations prove that an escape did not occur.

The JSON receipt is signed over recursively key-sorted compact JSON (array order unchanged), excluding its signature object. Ed25519 verification uses a separately trusted SPKI public key; keyId is SHA-256 of SPKI DER. HTML is not independently signed. Key rotation requires retaining old public keys for old receipts. Losing a private key does not invalidate existing signatures; compromising it undermines attribution for that key. Hashes alone offer consistency checking, not issuer authentication.

Receipts state the observed runtime image ID, requested/configured policy and controller lifecycle. They are not hardware attestation, proof of complete telemetry, proof of output correctness, or independent confirmation that a malicious controller told the truth.

## Inference data flow

Generation sends the task and workflow instructions to the configured model. For CSV it also sends filename and byte size; with input sharing enabled, up to six initial lines bounded to 1500 characters. Without it, the preview is replaced with an instruction to inspect the file inside the sandbox.

Live repair requires output sharing and sends task, code (up to 4000 characters), stdout tail (1500), stderr tail (2500), exit code and permitted file context. Optional explanation sends task, code (2000), stdout/stderr (1500 each), exit code and signal categories. Disabling previews alone does not prevent a user from writing sensitive content in a task. No provider data-retention promises are made here.

## Release limitations

- No independent penetration/escape assessment or multitenant isolation verification.
- Shared operator credential; no RBAC, tenant identities, per-customer separation inside a deployment or SSO.
- Count budgets, not monetary billing; one Node process per data directory. Multiple workers would require transactional shared admission/storage.
- Stored audit records are mutable. Host/controller compromise can alter unsigned data or misuse the signing key.
- Cancellation stops execution; an already-dispatched inference request may finish and incur cost.
- Process/host crashes can leave orphan containers or scratch directories. Inspect/reap them before service restart; never assume a crash generated a successful cleanup receipt.
- Runtime integration and UI recording must be exercised on the prepared Linux VM. Portable tests are not substitutes.

Before real customer data: independent assessment of API/host/runtime/artifact paths, critical-finding remediation/retest, incident ownership, patching procedure, data-flow approval and measured workload limits. Do not market this competition prototype as a validated general-purpose secure SaaS.

## Live inference response provenance
Only `SAFECODE_FORCE_MOCK=1` enables forced mock; `0`/empty do not. Missing credentials still produce explicitly mock-labelled offline results. Vultr requests use documented `response_format: json_object` for code, `reasoning.enabled: false`, and `max_completion_tokens` (default4096, configurable SAFECODE_MAX_COMPLETION_TOKENS 256–8192). Completion limits include reasoning tokens; sandbox limits are unchanged. Non-stop, empty, refused, invalid HTTP and malformed responses fail closed. A complete malformed code schema gets at most one repair call.
Safe metadata (completion ID, finish reason, content length and numeric usage only) is logged and attached to generated drafts and signed attempt model records; no response text/prompts/keys are logged by the inference diagnostic. Competition checks require actual completed-call metadata for CSV and repair, not merely a configured provider badge. This is controller-reported provenance, not independent provider attestation.
API references: https://api.vultrinference.com/docs/reference/create-chat-completion and https://api.vultrinference.com/docs/concepts/reasoning (reviewed7 Nov2026). Earlier failures did not retain finish_reason, so exact historical truncation cause cannot be reconstructed.
