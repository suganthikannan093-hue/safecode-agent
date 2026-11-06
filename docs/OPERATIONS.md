# Deployment and operations

## Competition VM prerequisites

Use a dedicated Ubuntu 24.04 Vultr VM. Supply a DNS name, repository URL and an existing private access-token file (at least 32 characters, generated using your secret-management process). Do not place secrets in source control, cloud-init, shell command arguments or recordings.

```bash
ACCESS_TOKEN_SOURCE=/private/path/access-token DOMAIN=demo.example.com REPO=https://github.com/OWNER/safecode-agent bash deploy/setup.sh
```

The script installs Docker/runsc, Node and Caddy; checks a runsc hello-world; pulls and pins Python/Bash image digests; installs the token file privately; generates an Ed25519 signing key if absent; mounts bounded scratch tmpfs; sets the HTTPS origin and installs systemd. Review downloaded installer scripts and deployment changes for your environment. Setup requires root. Cloud-init only clones source; complete secret provisioning over a private channel.

Set the Vultr inference model in `/opt/safecode/app/.env`. Prefer `VULTR_INFERENCE_API_KEY_FILE=/path/to/private-file` (owner-only file readable by the service user) over an inline `VULTR_INFERENCE_API_KEY`; an inline value takes precedence if both are set. For the synthetic-data self-heal demonstration, set `SAFECODE_MODEL_OUTPUT_SHARING=1`; optionally enable preview sharing with `SAFECODE_MODEL_INPUT_SHARING=1`. Restart `safecode`. Never enable sharing for unapproved data. Set `SAFECODE_ORIGIN` to the exact public HTTPS origin (no trailing slash).

Production refuses startup without access/signing configuration. Execution refuses missing runsc, unpinned images or scratch storage that is not tmpfs of at most 64 MiB. Setup mounts with 8192 inodes and noexec/nodev/nosuid. Inspect the mounted configuration after reboot. Docker/group access makes the controller privileged; dedicate the VM.

## Preflight before recording

1. `systemctl status safecode caddy docker` and `journalctl -u safecode` show a healthy service.
2. `docker info` lists runsc; configured image references include `@sha256:`. `findmnt /var/lib/safecode-work` shows the bounded mount.
3. UI reports runsc, live Vultr inference, authentication and signed receipts. No offline mock for the live competition demonstration.
4. An anonymous `/api/audit` returns 401. Operator token is supplied privately to evaluators if needed; do not publish it in the repository.
5. Run portable checks and `npm run test:integration` under the deployed configuration with appropriate token-file access. Integration HTTP tests should use a disposable local test environment, not the running customer's data directory.
6. Run the demo suite against the demo service and inspect every scenario result. A nonzero exit is a failed demonstration, not permission to claim success.

## Configurable limits

Defaults: 5-second execution timeout, 256 MiB sandbox memory, 64 PIDs, 0.5 CPU, 64 KiB output per stream, 1 MiB CSV, four artifacts ≤2 MiB each. Validated configuration bounds prevent zero/negative/nonfinite execution limits. Production scratch is at most 64 MiB aggregate; simultaneous jobs compete for it and may fail on exhaustion.

Two active executions, two simultaneous generations, 100 attempts/day, 100 live inference HTTP requests/day, 100 uploads/drafts/receipts each, 32 sessions and 16 SSE streams. No execution queue. Daily counters reset at UTC date rollover; persisted pause does not reset. Keep one process per data directory. The request-count budget does not meter token costs.

`SAFECODE_RETENTION_HOURS` defaults to 24; sweep interval is one minute. Keep the data directory on a monitored volume. Audit is a bounded 500-entry file; dashboard counters/history are process-local, not a durable event ledger. Systemd caps controller memory/tasks. Monitor controller restarts, disk/tmpfs pressure, admission failures and cleanup errors externally; built-in display/audit is not pager delivery.

## Incident and recovery actions

Pause immediately using the operator controls, inspect logs and active containers, and preserve evidence needed for investigation before deleting data. The UI pause persists and cancels active execution. It cannot recall provider requests already dispatched.

After a crash, inspect `docker ps -a --filter name=safecode-` and scratch directories. Confirm ownership and stop/remove only orphaned SafeCode containers before cleaning their scratch files. Confirm no active sandbox uses a directory before deleting it. Start the service only after reconciling leftovers. No automatic crash-recovery cleanup success is asserted.

Rotate access credentials through the private token file and restart; in-memory sessions are invalidated. Rotate signing keys through a new path and restart; retain old PUBLIC keys and key fingerprints for historical verification. Distribute trusted public keys through an authenticated channel distinct from the receipt download. Never delete old public keys merely because the private signing key rotated.

Pin replacement runtime images after testing; rerun integration and adversarial regressions after host/runtime/image changes. External penetration testing, multitenant verification, security SLA and 24/7 support are not included in this prototype.
