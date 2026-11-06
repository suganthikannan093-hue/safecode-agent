# API and integration

All workspace endpoints require `Authorization: Bearer <token>` or a valid session when access is configured. The token identifies one shared operator workspace, not a tenant. Use TLS outside loopback. Never put tokens in URLs.

## Requests

- `GET /api/session`: public authentication state only.
- `POST /api/session`, JSON `{ "token": "..." }`: create browser session; login-rate limited.
- `DELETE /api/session`: revoke the current cookie session. Bearer token rotation is an operator action.
- `GET /api/status`: runtime/provider, feature presets, limits, access/signing/sharing status.
- `POST /api/upload?name=sales.csv`: raw CSV bytes, not multipart; returns fileId/hash. Max 1 MiB by default.
- `POST /api/generate`, JSON `{ "task": "...", "fileId": "optional" }`: returns draft id, code, language and advisory findings. JSON body max 100,000 bytes.
- `POST /api/run`, JSON `{ "id": "draft-id", "code": "optional edit", "language": "python", "heal": false }`: NDJSON stream. The `start` event includes a NEW execution id and draftId; `attempt`, `chunk`, `attempt.result`, `healing` and `result` follow. `result.receipt` gives JSON/HTML paths. Stream errors have `type: error`; HTTP 200 alone does not mean execution succeeded. Reusing a draft creates a new execution and receipt.
- `POST /api/cancel`, JSON `{ "id": "execution-id" }`: cancels an active run; 404 if no longer active.
- `GET /api/controls`: active ids, usage/limits and pause state.
- `POST /api/controls`, JSON `{ "paused": true }`: persist pause and cancel active sandboxes. Set false to resume.
- `GET /api/runs/<execution-id>/receipt.json` or `.html`: receipt; optional `?download`.
- `GET /api/receipt-key`: signing public key or null. Fetching it is not an independent trust anchor.
- `GET /api/history`, `/api/audit`, `/api/stats`: recent workspace state.
- `GET /api/events`: SSE stats and audit notifications; closes after session revocation/expiry is observed (up to 20 seconds).
- `DELETE /api/data`: delete stored workspace data when idle. Retains keys and daily budgets. Does not delete previously downloaded evidence or external backups.

401 means missing/invalid access; 403 origin mismatch; 409 conflicting active work; 410 expired input; 413 oversized request; 429 quota/rate limit; 503 operator pause. Runtime/configuration failures return an error, never direct host execution. Connections dropped during a run request cancellation. Cancellation during model repair can surface as a stream error rather than a completed receipt; audit the outcome.

## Example

Use [the Python client](../examples/client.py). Set `SAFECODE_URL` and `SAFECODE_ACCESS_TOKEN_FILE` to the endpoint and existing private token file, then run:

```bash
python3 examples/client.py
node scripts/verify-receipt.js receipt.json /trusted/path/receipt-key.pem.pub
```

The client asks for explicit approval of generated source. Receipt verification exits 0 for a valid signature against the supplied key, 1 for an unsigned/invalid record, 2 for missing arguments. A valid signature does not establish output correctness.
