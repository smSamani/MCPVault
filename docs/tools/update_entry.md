---
type: MCP Tool
title: "update_entry"
description: "Update fields or rotate the password of an entry."
resource: "src/tools.ts"
tags: [mcp-tool, write]
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

# `update_entry`

Update fields or rotate the password of an entry. [^src-tools-ts]

**Permission:** `write` · see [access control](../access-control.md).

| Arg | Notes |
|---|---|
| `id` | required |
| `site`, `username`, `url`, `notes` | optional new values (empty string clears url/notes) |
| `password` | set explicitly, **or** |
| `regenerate` | true → new generated password (generator options apply), delivered per `deliver` |

Returns `{ entry, password_changed, delivered?, password? }`. The secret is returned only when `regenerate` is true. Moving an entry outside the profile's site scope is refused.

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
