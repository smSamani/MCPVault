---
type: Concept
title: "Cryptography"
description: "AES-256-GCM vault envelope with HKDF-SHA256 subkeys, AAD-bound headers, and scrypt passphrase backups."
resource: "src/crypto.ts"
tags: [security, crypto, aes-gcm, hkdf, scrypt]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-crypto-ts
    resource: ../src/crypto.ts
    last_modified: 2026-10-22
---

# Cryptography

All primitives come from `node:crypto` (OpenSSL). [^src-crypto-ts]

## Keys
- **Master key:** 32 random bytes from the OS CSPRNG, stored in the [Keychain](keychain.md).
- **Subkeys:** HKDF-SHA256(master, salt `mcp-vault/hkdf-salt/v1`, info `mcp-vault/<purpose>/v1`):
  - `vault-enc`: AES-256-GCM key for `vault.enc`,
  - `clients-mac`: HMAC-SHA256 key for `clients.json` integrity (see [access control](access-control.md)),
  - `key-id`: the first 8 bytes form a non-secret key fingerprint stored in the envelope.

## Vault envelope
```json
{ "format": "mcp-vault", "version": 1, "alg": "AES-256-GCM", "keyId": "<16 hex>",
  "nonce": "<b64 12 bytes>", "ciphertext": "<b64>", "tag": "<b64 16 bytes>" }
```
- A fresh random 96-bit nonce on every write.
- The header fields (`format`, `version`, `alg`, `keyId`, `kdf`) are canonical-JSON encoded and bound as **AAD**, so swapping or downgrading the header fails authentication.
- The plaintext is the whole entry list. Site names, usernames and notes are therefore encrypted too.
- Any modification to the ciphertext, tag, nonce or header is rejected ("decryption failed").

## Backups
`mcp-vault backup` seals the entries with a key from **scrypt** (N=2^17, r=8, p=1, 16-byte salt) over your NFKC-normalised passphrase, using the same AES-256-GCM envelope with `format: "mcp-vault-backup"`. It is independent of the Keychain. See [backup and rotate](runbooks/backup-and-rotate.md).

## Tests
`test/crypto.test.ts` covers the round-trip, nonce uniqueness, wrong key, tampering with every field, HKDF separation, the backup round-trip, the absence of plaintext on disk, rotation and interrupted-rotation recovery.
