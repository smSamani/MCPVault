---
type: Concept
title: "Vault storage"
description: "Entry schema, the encrypted vault file, atomic writes, cross-process locking and master-key rotation."
resource: "src/vault.ts"
tags: [storage, vault, encryption]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-vault-ts
    resource: ../src/vault.ts
    last_modified: 2026-10-22
---

# Vault storage

## Entry schema (plaintext, only ever inside the encrypted envelope)
| Field | Notes |
|---|---|
| `id` | random UUID |
| `site` | display label as given |
| `host` | normalised host (lowercase, no scheme/`www.`/port/path), used for matching |
| `url` | optional |
| `username` | |
| `password` | secret |
| `notes` | optional, secret-ish; only returned by [reveal_password](tools/reveal_password.md) |
| `createdAt`, `updatedAt`, `passwordUpdatedAt` | ISO 8601 |

## Files (`~/.mcp-vault`, dir 700, files 600)
- `vault.enc`: the [AES-256-GCM envelope](crypto.md) of `{ version: 1, entries: [...] }`. [^src-vault-ts]
- `clients.json`: client profiles with an HMAC. See [access control](access-control.md).
- `config.json`: non-secret settings (`clipboardClearSeconds`, `http.enabled`, `http.port`, `http.allowedHosts`).
- `audit.log`: see [audit log](audit-log.md).

## Write safety
- **Atomic:** write a 600 temp file in the same directory, fsync, rename.
- **Locking:** `vault.lock` is created with `O_EXCL` and holds the pid. Stale locks (dead pid or older than 30 s) are broken; acquisition times out after 10 s with "vault is locked".
- **No caching:** each operation re-reads and decrypts, so all processes see the latest state.

## Rotation
`rotateMasterKey()` stores the new key as `master-key-next`, re-seals `vault.enc` and re-MACs `clients.json`, then promotes the key and deletes `-next`. If interrupted, the next load sees an envelope `keyId` matching `-next` and completes the promotion. See [backup and rotate](runbooks/backup-and-rotate.md).

## Site matching
`get_login_for_site` matches when the requested host equals the stored host or is a subdomain on a **dot boundary** (`accounts.google.com` → `google.com`; `evilgoogle.com` does not match).
