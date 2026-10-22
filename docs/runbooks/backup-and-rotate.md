---
type: Runbook
title: "Backup and rotate"
description: "Passphrase backups, restore, master-key rotation and client-token rotation."
tags: [runbook, backup, rotation, keys]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-cli-ts
    resource: ../../src/cli.ts
    last_modified: 2026-10-22
  - id: deploy-mcp-vault-backup
    resource: ../../deploy/mcp-vault-backup
    last_modified: 2026-10-22
---

# Backup and rotate

## Backup
```sh
mcp-vault backup ~/Documents/vault-YYYY-MM-DD.mcpvault-backup   # passphrase ≥ 12 chars, prompted without echo [^src-cli-ts] [^deploy-mcp-vault-backup]
```
- scrypt (N=2^17) + AES-256-GCM ([crypto](../crypto.md)), independent of the Keychain, so it survives losing the Mac.
- The file is written with mode 600 and never overwrites an existing file.
- Store it off-machine; keep the passphrase somewhere else.
- `vault.enc` alone is useless without the Keychain item. Time Machine covers both on the same Mac.

## Restore
```sh
mcp-vault restore <file>             # merges entries by id; initialises a vault if needed
```

## Rotate the master key
```sh
mcp-vault backup <file>              # recommended first
mcp-vault rotate-key
```
Crash-safe: the new key is stored as `master-key-next`, the files are re-sealed, then the key is promoted ([vault](../vault.md)). Old passphrase backups stay valid. Client tokens are unaffected.

## Rotate client tokens
```sh
mcp-vault client rotate-token <name>
mcp-vault client remove <name>         # revoke
```

**Never delete** the Keychain item "mcp-vault master-key" without a backup ([Keychain](../keychain.md)).
