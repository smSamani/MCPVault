---
type: Concept
title: "Audit log"
description: "Append-only JSON-lines record of every authentication and tool call, never containing secrets."
resource: "src/audit.ts"
tags: [security, audit, logging]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-audit-ts
    resource: ../src/audit.ts
    last_modified: 2026-10-22
---

# Audit log

- **Location:** `~/.mcp-vault/audit.log` (mode 600); `/var/lib/mcp-vault/audit.log` on the server. Append-only, one JSON object per line. [^src-audit-ts]
- **Fields:** `ts`, `client`, `transport` (`stdio`, `http` or `cli`), `action` (tool name, `connect`, `auth`, `backup`, `restore`, `rotate_master_key`; over HTTP also `request` (accepted request: JSON-RPC method such as `tools/call:reveal_password`) and `access` (rejected: bad host/origin/path/method/size)), `ok`, and optionally `entryId`, `site` (normalised host), `detail` (≤ 200 chars; HTTP entries end with `src=<client address>`; for example `denied: client "x" lacks the "reveal" permission` or `delivered via clipboard`).
- **Never logged:** passwords, notes, tool arguments in bulk, tokens, keys. Validation errors name the field and rule, not the value. Tests assert that generated passwords, explicit passwords, notes and invalid values never appear.
- **View:** `mcp-vault audit --tail 50`.

```json
{"ts":"2026-10-22T08:38:29.825Z","client":"smoke-test","transport":"stdio","action":"reveal_password","ok":true,"entryId":"…","site":"smoke-test.mcp-vault.invalid"}
```

Limitations: site hosts are stored in plaintext, and there is no rotation or hash chaining yet (see the [threat model](threat-model.md)).
