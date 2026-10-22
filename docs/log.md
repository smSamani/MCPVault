---
type: Log
title: "Change log"
description: "Dated, chronological history of changes to MCPVault and this bundle."
tags: [log, changelog]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
---

# Change log

Newest first. Every code change adds an entry here (see [AGENTS.md](../AGENTS.md)).

## 2026-10-22 (OKF v0.2 upgrade, TASK5)
- **docs:** Upgraded the bundle from OKF v0.1 to v0.2: `timestamp` replaced by `generated: { by, at }`; `verified: [ci:tests]` added to concepts covered by the passing test suite (35 pass, 1 opt-in skipped); `status: stable` and `stale_after: 2027-04-30` everywhere; `sources` with footnote citations. [AGENTS.md](../AGENTS.md) documents how to maintain these fields.
- **refactor:** Removed the product-specific client registration CLI commands; local stdio clients are set up with `mcp-vault client add` plus a generic config snippet ([stdio clients](clients/stdio-clients.md), replaces the two per-product client guides). Dropped the per-tool agent instruction file; vendor-specific wording removed from all docs and code comments.

## 2026-10-22 (Google Drive backups, TASK4)
- **feat:** instant encrypted backup on every vault/clients change (`mcp-vault-instant-backup.path`, 10 s debounce) and nightly backup now both upload to Google Drive folder `MCPVault Backups` via rclone (`drive.file` scope, root-only config), newest 30 kept on Drive. `mcp-vault-backup` takes `nightly|change` (retention 14/30). New [backups](backups.md) concept; [server runbook](runbooks/server-deployment.md) updated.

## 2026-10-22 (server deployment, TASK3)
- **feat:** Linux master-key backend `src/keystore.ts` (`FileKeyStore`, systemd credential `mcp-vault-master-key`, `selectKeyStore`); macOS Keychain behaviour unchanged. Rotation unsupported on this backend. Docs: [linux-key-backend](linux-key-backend.md), [keychain](keychain.md), [architecture](architecture.md), [CLI](cli.md).
- **feat (security):** new `delete` permission, separate from `write`; legacy profiles without `schema: 2` keep delete via `write`. `delete_entry` now requires `delete`. Docs: [access-control](access-control.md), [delete_entry](tools/delete_entry.md).
- **feat (security):** HTTP transport: per-source escalating lockout (`src/ratelimit.ts`, replaces the global throttle), `CF-Connecting-IP` as source only when tunnel hosts are configured, audit of every request/rejection with source address, `/healthz`. Docs: [HTTP transport](transports/http.md), [audit log](audit-log.md).
- **deploy:** `deploy/` (systemd units for the vault, the Cloudflare tunnel and nightly gpg backups, admin helper, installer) and runbook [server-deployment](runbooks/server-deployment.md); [remote clients](clients/remote.md) for Aryan/Siamak. `package.json` `os` now allows `linux`.
- **deploy (done):** the Linux server was set up from git `main`; Cloudflare named tunnel `mcpvault` → `https://vault.salamaghapesar.uk/mcp`; `aryan`/`siamak` profiles created (tokens only in the server's root-only `clients.txt`); nightly encrypted backups verified. Fix: syscall filter relaxed (`@system-service`, `SystemCallErrorNumber=EPERM`) after V8 was killed by SIGSYS.
- **tests:** 36 tests (35 pass, 1 opt-in Keychain test skipped): new `test/keystore.test.ts`, delete-permission, lockout and audit tests.

## 2026-10-22
- **docs:** Created this OKF bundle (v0.1 at the time) (concepts, tools, transports, clients, runbooks). Added AGENTS.md, SECURITY.md, LICENSE (MIT) and a new README.
- **refactor (v2.0.0):** Moved the MCP layer to the official TypeScript SDK, `@modelcontextprotocol/sdk` **1.32.1** (pinned): `McpServer.registerTool` with strict **zod 4.6.7** schemas, `StdioServerTransport`, and stateless `StreamableHTTPServerTransport`. Removed the hand-written JSON-RPC core. Behavior and security controls are unchanged. See [architecture](architecture.md) and [transports](transports/index.md).
- **tests:** Added an SDK-client stdio integration test and a no-echo validation test. The smoke test now uses the SDK Client. Result: 27 passed, 1 opt-in Keychain test skipped by default (passes when enabled).
- **repo:** `origin` set to the public GitHub repo `smSamani/MCPVault`. Before the first push, the full history was scanned for secrets (none found) and personal paths were scrubbed. The first push attempt failed (no GitHub credentials on the build machine); commits remain local until the owner pushes.
- **v1.0.0:** Initial release: AES-256-GCM vault with Keychain master key, per-client tokens, audit log, clipboard auto-clear, seven MCP tools, stdio + loopback HTTP transports, CLI. Registered with local stdio clients on the reference machine.
