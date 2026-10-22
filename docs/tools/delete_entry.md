---
type: MCP Tool
title: "delete_entry"
description: "Permanently delete an entry."
resource: "src/tools.ts"
tags: [mcp-tool, delete, destructive]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-tools-ts
    resource: ../../src/tools.ts
    last_modified: 2026-10-22
---

# `delete_entry`

Permanently delete an entry. [^src-tools-ts]

**Permission:** `delete` (separate from `write`; legacy profiles with `write` and no `schema: 2` marker still delete) · see [access control](../access-control.md).

| Arg | Notes |
|---|---|
| `id` | required |
| `confirm` | must be `true` |

Returns `{ deleted: true, id, site, username }`. There is no undo; keep [backups](../runbooks/backup-and-rotate.md).

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
