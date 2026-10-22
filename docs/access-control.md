---
type: Concept
title: "Access control"
description: "Per-client tokens and profiles with read/write/reveal/delete permissions, transport restriction and site scoping."
resource: "src/access.ts"
tags: [security, access-control, tokens, authorization]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-access-ts
    resource: ../src/access.ts
    last_modified: 2026-10-22
---

# Access control

## Tokens
- Format `mcpv_` + base64url(32 random bytes), shown **once** on creation or rotation. [^src-access-ts]
- Only `SHA-256(token)` is stored, in `clients.json`. Lookup compares every profile in constant time.
- The registry is protected by **HMAC-SHA256** under a Keychain-derived key ([crypto](crypto.md)). Editing permissions by hand breaks the MAC, and the server refuses to load it.

## Profile fields
| Field | Meaning |
|---|---|
| `permissions` | any of `read` (list), `write` (create/update), `reveal` (return secrets), `delete` (delete entries). Profiles created before `delete` existed (no `schema: 2` marker) keep deleting via `write`. |
| `transports` | `stdio` and/or `http`. A token is rejected on a transport not listed. |
| `sites` | `["*"]` or a host allowlist (subdomains included). Entries outside it are invisible: not listed, not revealable, not modifiable, not creatable. |
| `clipboard` | whether `deliver: "clipboard"` is allowed. Always false over HTTP. |

## Enforcement points
1. **Authentication** happens before any MCP traffic: the stdio env token is checked at startup ([stdio](transports/stdio.md)), and the HTTP `Authorization: Bearer` header is checked before the SDK transport sees the request ([HTTP](transports/http.md)).
2. **Tool registration:** `createMcpServer` registers only permitted tools with the SDK, so the others are absent from `tools/list` and unknown on `tools/call`.
3. **callTool** re-checks the permission (defense in depth), validates input with the strict zod schema, and applies site scoping inside each handler.
4. Every allowed or denied call is written to the [audit log](audit-log.md).

## Permission → tools
| Permission | Tools |
|---|---|
| (any authenticated) | [generate_password](tools/generate_password.md) |
| `read` | [list_entries](tools/list_entries.md) |
| `write` | [create_entry](tools/create_entry.md), [update_entry](tools/update_entry.md) |
| `delete` | [delete_entry](tools/delete_entry.md) |
| `reveal` | [get_login_for_site](tools/get_login_for_site.md), [reveal_password](tools/reveal_password.md) |

## Managing profiles
`mcp-vault client add|list|rotate-token|remove`. See the [CLI](cli.md).

Tests: `test/access.test.ts`, `test/sdk-client.test.ts`, `test/http.test.ts`.
