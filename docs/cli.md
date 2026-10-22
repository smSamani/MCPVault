---
type: Concept
title: "CLI"
description: "Reference for the mcp-vault command-line interface (setup, clients, servers, owner commands, keys)."
resource: "src/cli.ts"
tags: [cli, reference]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-cli-ts
    resource: ../src/cli.ts
    last_modified: 2026-10-22
---

# CLI (`mcp-vault`)

Run as `node dist/src/cli.js <command>` or through a wrapper on your PATH. Commands never print passwords. Tokens are printed **once** on stdout so they can be captured. [^src-cli-ts]

| Command | Purpose |
|---|---|
| `init` | Create the master key (Keychain on macOS; key file on Linux, see [Linux key backend](linux-key-backend.md)) if absent, an empty vault and the config |
| `status` | Paths, permission modes, key id, counts, HTTP state |
| `client add <name> --perms read,write,reveal,delete --transport stdio\|http [--sites a,b] [--no-clipboard]` | New profile; prints its token |
| `client list` / `client rotate-token <name>` / `client remove <name>` | Manage profiles ([access control](access-control.md)) |
| `serve` | stdio MCP server ([stdio](transports/stdio.md)) |
| `serve-http` | Loopback HTTP server; refuses unless enabled ([HTTP](transports/http.md)) |
| `http enable [--port 8765] [--allowed-host h]` / `http disable` | Toggle the HTTP mode |
| `list [query]` | Entries without secrets |
| `copy <site> [--user U]` | Password to clipboard, auto-clear after 30 s |
| `add <site> <username> [--length N] [--no-symbols] [--url U]` | Generate, store, and copy to clipboard |
| `rm <id>` | Delete an entry |
| `audit [--tail N]` | Show the [audit log](audit-log.md) |
| `rotate-key` | New master key, re-encrypt ([runbook](runbooks/backup-and-rotate.md)); Keychain backend only |

Environment: `MCP_VAULT_HOME` (data dir), `MCP_VAULT_KEY_BACKEND=keychain\|file\|credential`, `MCP_VAULT_KEY_FILE=<path>`, `MCP_VAULT_TOKEN` (stdio client token).
| `backup <file> [--stdin]` / `restore <file> [--stdin]` | Passphrase-encrypted backup and restore |

The owner commands run tools through the same `callTool` path as MCP, under a full-permission principal named `cli`, and are audited.
