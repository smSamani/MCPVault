---
type: Concept
title: "Threat model and limitations"
description: "What MCPVault protects against, what it explicitly does not, and known limitations."
tags: [security, threat-model, limitations]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-access-ts
    resource: ../src/access.ts
    last_modified: 2026-10-22
  - id: src-crypto-ts
    resource: ../src/crypto.ts
    last_modified: 2026-10-22
  - id: src-keychain-ts
    resource: ../src/keychain.ts
    last_modified: 2026-10-22
---

# Threat model and limitations

## Protected
- **Data at rest:** a stolen `vault.enc` (backups, cloud sync, a lost disk image) is useless without the Keychain key. Tampering is detected. [^src-access-ts] [^src-crypto-ts] [^src-keychain-ts]
- **Least privilege between MCP clients:** each client sees and does only what its profile allows ([access control](access-control.md)).
- **Secret leakage:** no secrets in logs, audit, error messages, process argv, or plaintext files. The client token is scrubbed from the environment. Clipboard copies are concealed and auto-cleared.
- **Network:** the HTTP mode is off by default, loopback only, bearer-authenticated, and rejects foreign Host headers and browser Origins ([HTTP](transports/http.md)).

## Server deployment (Linux)
- The master key is a root-only file delivered as a systemd credential ([Linux key backend](linux-key-backend.md)); the service runs as an unprivileged, sandboxed user. **Root on the server, or a stolen disk image that includes `/etc/mcp-vault`, defeats the encryption**: key and data share one host. Backups contain no key.
- Internet exposure is only through a Cloudflare named tunnel to `/mcp`. Gates: bearer token per client (256-bit, SHA-256 verified in constant time), per-source lockout, 64 KB body cap, Host/Origin checks, full audit. Cloudflare terminates TLS and can see traffic.
- Remote profiles have no `delete`; no export tool exists.
- Encrypted backups are copied to Google Drive ([backups](backups.md)). The Drive copy is gpg-encrypted and also needs `master.key` to be useful, but the OAuth token on the server (scope `drive.file`) lets root there upload and delete files in that folder.

## Not protected
- **Code running as the same macOS user with shell access** (malware, or an automated agent allowed to run arbitrary commands) can run `security find-generic-password -s mcp-vault -w` or `mcp-vault copy`. Profiles are not a sandbox against such code. Keep agent shell-approval prompts on.
- **Revealed secrets** returned with `deliver: "return"` enter the model's context and possibly the provider's logs. Prefer `deliver: "clipboard"` locally.
- **Local client tokens** sit in client configs (user-only files), as is standard for stdio MCP servers.

## Limitations
- macOS only; single user; no sync.
- JavaScript strings can't be wiped from memory.
- The whole vault is re-encrypted per write (fine for thousands of entries).
- The audit log has no rotation or tamper chain.
- HTTP mode is stateless JSON and needs a client that can send an `Authorization` header.
- The auth-failure throttle is global (it can briefly lock out legitimate HTTP clients).
- The Node path is pinned in client registrations.

See the [roadmap in the README](../README.md#roadmap).
