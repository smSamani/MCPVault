---
type: Transport
title: "Streamable HTTP transport (optional)"
description: "Loopback-only, bearer-authenticated, stateless Streamable HTTP mode for remote assistants; disabled by default."
resource: "src/http.ts"
tags: [transport, http, remote, security]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-http-ts
    resource: ../../src/http.ts
    last_modified: 2026-10-22
  - id: src-ratelimit-ts
    resource: ../../src/ratelimit.ts
    last_modified: 2026-10-22
---

# Streamable HTTP transport (optional)

`mcp-vault serve-http` (`src/http.ts`). It refuses to start unless `mcp-vault http enable` was run **and** at least one profile allows `http`. [^src-http-ts] [^src-ratelimit-ts]

## Checks before the SDK sees a request
1. Bind address is hard-coded to **127.0.0.1**.
2. `Host` must be `127.0.0.1:<port>`, `localhost:<port>` or a configured `http.allowedHosts` entry (the tunnel hostname). This protects against DNS rebinding.
3. Any `Origin` header → 403 (no browser access).
4. Only the path `/mcp`.
5. **Per-source lockout:** 10 failed auths from one address within 60 s lock that address out (429 + `Retry-After`, **even with a valid token**) for 1 min, then 5 min, 30 min, 1 h on repeats. Other addresses are unaffected. Behind a tunnel the address is Cloudflare's `CF-Connecting-IP` (only honoured when `http.allowedHosts` is configured; otherwise the socket address is used).
6. `Authorization: Bearer <token>` must match a profile with transport `http`; otherwise 401 plus an audit entry.
7. Only `POST` (405 otherwise), `Content-Type: application/json` (415), body ≤ 64 KB (413), valid JSON (400).
8. Timeouts: 10 s for headers, 15 s per request.

## SDK hand-off
For each authenticated request, a fresh principal-scoped `McpServer` and a `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` are created (stateless mode). The SDK enforces the spec's `Accept: application/json, text/event-stream` header. Notifications get 202. Clipboard delivery is never available over HTTP.

**Audit:** every accepted request (`request`, with JSON-RPC method and source), every auth failure and every rejection (`access`) is written to the [audit log](../audit-log.md); tokens and bad token values never are.

`GET /healthz` returns `{"ok":true}` on loopback only (not exposed by the tunnel ingress, which allows just `/mcp`).

Exposure guidance: [Aryan](../clients/aryan.md) · production deployment: [server runbook](../runbooks/server-deployment.md) · [remote clients](../clients/remote.md). Tests: `test/http.test.ts`.
