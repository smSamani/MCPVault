---
type: Concept
title: "Linux master-key backend"
description: "File / systemd-credential master key for Linux servers, and how the key backend is selected."
resource: "src/keystore.ts"
tags: [security, linux, master-key, systemd]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-keystore-ts
    resource: ../src/keystore.ts
    last_modified: 2026-10-22
---

# Linux master-key backend

Servers have no Keychain, so `src/keystore.ts` adds a `FileKeyStore` (the same `KeyStore` interface as [MacKeychain](keychain.md)). The key is **base64 of 32 random bytes in one file**. [^src-keystore-ts]

## Rules the store enforces
- The path must be a **regular file** with **no group/other permission bits** (`chmod 400`); otherwise it refuses to read it.
- It can be **created once** (exclusive create, mode 0400, parent dir 0700) and is **never overwritten** or deleted by the program. `init` still refuses to mint a new key if `vault.enc` exists but the key is missing.
- **`rotate-key` is unsupported** (it throws before changing anything). Offline rotation: stop the service, `mcp-vault backup <file>` (passphrase-encrypted), point `MCP_VAULT_HOME` and a new key file at a fresh location, `init`, `restore <file>`, re-create the client profiles, swap the directories, start the service.
- The key is read on demand; never cached on disk, never put in an env var.

## Backend selection (`selectKeyStore`)
Forced with `MCP_VAULT_KEY_BACKEND=keychain|file|credential`. Otherwise, first match wins:
1. **systemd credential** `mcp-vault-master-key` in `$CREDENTIALS_DIRECTORY` (preferred on servers);
2. **`MCP_VAULT_KEY_FILE`** path;
3. **macOS Keychain** when running on darwin (behaviour unchanged; no silent downgrade to a file);
4. **`/etc/mcp-vault/master.key`** on any other platform.

## systemd credential (recommended)
`LoadCredential=mcp-vault-master-key:/etc/mcp-vault/master.key` lets the key file stay **root:root 0400**. systemd copies it into a per-service tmpfs that only the service user can read, so even a compromised `mcpvault` process cannot read `/etc/mcp-vault/master.key` itself, and the file is invisible to other services. Administrative CLI calls use `/usr/local/sbin/mcp-vault-admin`, which runs the CLI through `systemd-run` with the same credential.

## What it does not protect
Root on the host (or anyone who can read the key file and `vault.enc`) can decrypt the vault, and the key and data live on the same machine. Backups contain `vault.enc` **without** the key; store the key separately and offline. See the [threat model](threat-model.md).

Tests: `test/keystore.test.ts`. Related: [Keychain](keychain.md) · [crypto](crypto.md) · [server runbook](runbooks/server-deployment.md)
