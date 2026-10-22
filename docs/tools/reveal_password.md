---
type: MCP Tool
title: "reveal_password"
description: "Explicitly reveal one entry's password and notes by id."
resource: "src/tools.ts"
tags: [mcp-tool, reveal]
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

# `reveal_password`

Explicitly reveal one entry's password and notes by id. [^src-tools-ts]

**Permission:** `reveal` · see [access control](../access-control.md).

| Arg | Notes |
|---|---|
| `id` | from [list_entries](list_entries.md) |
| `deliver` | `return` or `clipboard` |

Returns `{ id, site, username, notes, delivered, password? }`. Every reveal is [audited](../audit-log.md).

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
