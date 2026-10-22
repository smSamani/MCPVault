---
type: Concept
title: "Keychain master key"
description: "How the 256-bit master key is created, stored, read and rotated in the macOS login Keychain."
resource: "src/keychain.ts"
tags: [security, keychain, macos, master-key]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-keychain-ts
    resource: ../src/keychain.ts
    last_modified: 2026-10-22
---

# Keychain master key

- **Location:** login keychain, generic password, service `mcp-vault`, account `master-key` (label "mcp-vault master-key"). During [rotation](runbooks/backup-and-rotate.md) a second account, `master-key-next`, exists briefly. [^src-keychain-ts]
- **Format:** base64 of 32 random bytes.
- **Write path:** `/usr/bin/security -i` with the `add-generic-password -U …` command sent on **stdin**, so the key never appears in a process argv (`ps`). After writing, the item is read back and compared.
- **Read path:** `security find-generic-password -s mcp-vault -a master-key -w`, on demand for each operation. The key is never cached on disk.
- **Other providers:** on macOS the CLI always uses `MacKeychain` (no silent downgrade). A root-only key file / systemd credential backend exists **for Linux servers only**: see [Linux key backend](linux-key-backend.md). There is no env-var key source. Tests use an in-memory `MemoryKeyStore`.

## Access semantics
The item is created by `/usr/bin/security`, which the item's ACL then trusts, so reads by the same macOS user need no prompt. That is what lets non-interactive MCP servers start. The consequence is documented in the [threat model](threat-model.md).

## Recovery
If the item is deleted and you have no passphrase backup, the vault is **unrecoverable**. `mcp-vault init` refuses to create a new key while a `vault.enc` exists.

Related: [cryptography](crypto.md) · [vault](vault.md)
