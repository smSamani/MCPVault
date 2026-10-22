---
type: Client Guide
title: "Remote clients (Aryan and Siamak)"
description: "How remote agents connect to the always-on server vault over HTTPS with a bearer token."
tags: [client, remote, http, aryan, siamak]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-http-ts
    resource: ../../src/http.ts
    last_modified: 2026-10-22
  - id: deploy-setup-server-sh
    resource: ../../deploy/setup-server.sh
    last_modified: 2026-10-22
---

# Remote clients (Aryan and Siamak)

Two profiles exist on the server vault: **`aryan`** and **`siamak`**, transport `http` only, permissions **`read`, `write`, `reveal`**, all sites. Neither has `delete`, and there is no export tool (backups are server-side only), so they can list, get/reveal, fill, generate and store, but **cannot delete or export**. [^src-http-ts] [^deploy-setup-server-sh]

## Connect
- **URL:** `https://vault.salamaghapesar.uk/mcp` (Streamable HTTP, stateless, JSON responses)
- **Header:** `Authorization: Bearer <that client's token>` plus `Content-Type: application/json` and `Accept: application/json, text/event-stream`.
- **Method:** POST only (GET returns 405). No browser `Origin` header.
- **Token source:** the owner reads it from `/etc/mcp-vault/clients.txt` on the server and gives each agent only its own. Tokens are never in git or docs.

```json
{ "mcpServers": { "vault": { "type": "http", "url": "https://vault.salamaghapesar.uk/mcp",
    "headers": { "Authorization": "Bearer <TOKEN>" } } } }
```
Smoke check: `POST` an MCP `initialize`; a wrong token gives 401, and 10 bad attempts from one address within a minute lock that address out (429, escalating up to 1 h).

## Behaviour
- `deliver: "clipboard"` is refused over HTTP: secrets come back in the tool result (they enter the agent's context).
- Every request is audited (`action: request`, JSON-RPC method, source IP) plus each tool call; see [audit log](../audit-log.md).
- Rotate: `sudo mcp-vault-admin client rotate-token <name>`. Revoke: `client remove <name>`.

Server setup: [server runbook](../runbooks/server-deployment.md) · transport details: [HTTP](../transports/http.md)
