---
type: Concept
title: "Architecture"
description: "Components of MCPVault, how a tool call flows through them, and where data lives."
resource: "src/server.ts"
tags: [architecture, mcp, sdk]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-server-ts
    resource: ../src/server.ts
    last_modified: 2026-10-22
  - id: src-stdio-ts
    resource: ../src/stdio.ts
    last_modified: 2026-10-22
  - id: src-http-ts
    resource: ../src/http.ts
    last_modified: 2026-10-22
---

# Architecture

```
 Local MCP client (stdio)          Remote assistant (Aryan) [^src-server-ts] [^src-stdio-ts] [^src-http-ts]
        │ stdio, MCP_VAULT_TOKEN env                      │ HTTPS via tunnel, Authorization: Bearer
        ▼                                                 ▼
 src/stdio.ts  StdioServerTransport            src/http.ts  node:http pre-checks (127.0.0.1 only)
        │  authenticate() once at startup             │  Host/Origin/throttle/auth/size checks
        └──────────────┬──────────────────────────────┘  then StreamableHTTPServerTransport (stateless)
                       ▼
            src/server.ts  createMcpServer(principal)   ← official SDK McpServer
                       │  registerTool() only for permitted tools (zod schemas)
                       ▼
            src/tools.ts  callTool(): permission → validate → handler → audit
                       ▼
     src/vault.ts (encrypted store)   src/access.ts (profiles)   src/audit.ts   src/clipboard.ts
                       ▼
     src/crypto.ts (AES-256-GCM, HKDF, scrypt)   src/keychain.ts + src/keystore.ts (Keychain / key file)
```

## Components
| Module | Role |
|---|---|
| `src/server.ts` | Builds an SDK `McpServer` per authenticated principal and registers only the tools it may use. See [access control](access-control.md). |
| `src/stdio.ts` | Stdio entrypoint: verifies the env token, then connects `StdioServerTransport`. See [stdio](transports/stdio.md). |
| `src/http.ts` | Optional HTTP entrypoint: security checks, then `StreamableHTTPServerTransport`. See [HTTP](transports/http.md). |
| `src/tools.ts` | The seven [tools](tools/index.md): zod schemas, handlers, and `callTool` (shared by MCP and the [CLI](cli.md)). |
| `src/vault.ts` | [Vault storage](vault.md), client registry, config, and key rotation. |
| `src/crypto.ts` | [Cryptography](crypto.md). |
| `src/keychain.ts` | [Keychain master key](keychain.md). |
| `src/keystore.ts` | [Linux key backend](linux-key-backend.md): key file / systemd credential, backend selection. |
| `src/ratelimit.ts` | Per-source auth lockout for the [HTTP transport](transports/http.md). |
| `src/access.ts` | Token auth and permission checks. |
| `src/audit.ts` | [Audit log](audit-log.md). |
| `src/clipboard.ts` | Concealed clipboard copy with auto-clear. |
| `src/generator.ts` | CSPRNG password generator. See [generate_password](tools/generate_password.md). |
| `src/cli.ts` | [CLI](cli.md). |

## Dependencies
Runtime: `@modelcontextprotocol/sdk` (pinned **1.32.1**) and `zod` (pinned **4.6.7**). Everything else uses the Node.js standard library (`node:crypto`, `node:http`, `node:fs`). Dev: `typescript`, `@types/node`.

## Data locations
`~/.mcp-vault/` (mode 700; override with `MCP_VAULT_HOME`): `vault.enc`, `clients.json`, `config.json`, `audit.log` (all mode 600). The master key lives in the macOS Keychain (on Linux: a root-only key file or systemd credential, see [Linux key backend](linux-key-backend.md)), never inside the data directory.

## Concurrency
Several server processes (one per client, plus optional HTTP) share one vault. Every read-modify-write runs under an `O_EXCL` lock file, and every write is atomic (temp file, fsync, rename). See [vault](vault.md).
