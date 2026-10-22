---
type: Index
title: "MCPVault knowledge bundle"
description: "Entry point of the OKF v0.2 documentation bundle for MCPVault (mcp-vault)."
tags: [index, okf]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
---

# MCPVault knowledge bundle

This is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) (OKF v0.2) bundle. Each file is one **concept** with YAML frontmatter (`type` is required; `title`, `description`, `resource`, `tags` are also provided, plus the v0.2 trust fields: `generated`, `verified`, `status`, `stale_after`, `sources`; see [AGENTS.md](../AGENTS.md)). Claims that come from a specific file carry a markdown footnote keyed to a `sources` id. Read top-down and follow links only as deep as you need.

## Core concepts
| Concept | Description |
|---|---|
| [Architecture](architecture.md) | Components, request flow, file layout, and how the official MCP SDK is used. |
| [Cryptography](crypto.md) | AES-256-GCM envelope, HKDF subkeys, nonces, AAD, scrypt backups. |
| [Keychain master key](keychain.md) | How the 256-bit master key is stored and accessed in the macOS Keychain. |
| [Linux key backend](linux-key-backend.md) | Root-only key file / systemd credential for servers; backend selection. |
| [Server backups](backups.md) | Nightly + on-change encrypted archives, Google Drive upload, retention, restore. |
| [Vault storage](vault.md) | Entry schema, encrypted file format, atomic writes, locking, rotation. |
| [Access control](access-control.md) | Client tokens, profiles, permissions, transports, site scoping. |
| [Audit log](audit-log.md) | What is recorded, what never is, format and location. |
| [Threat model](threat-model.md) | What MCPVault defends against, what it does not, known limitations. |
| [CLI](cli.md) | The `mcp-vault` command-line interface. |

## Sections
- [MCP tools](tools/index.md): the seven tools exposed to clients.
- [Transports](transports/index.md): stdio and the optional loopback Streamable HTTP mode.
- [Clients](clients/index.md): connecting local stdio clients and remote HTTP clients.
- [Runbooks](runbooks/index.md): install, retrieve a password, backup and rotation, always-on server deployment.

## History
- [Change log](log.md)
