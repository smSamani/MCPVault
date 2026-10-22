---
type: MCP Tool
title: "list_entries"
description: "List or search entries; never returns passwords or notes."
resource: "src/tools.ts"
tags: [mcp-tool, read]
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

# `list_entries`

List or search entries; never returns passwords or notes. [^src-tools-ts]

**Permission:** `read` · see [access control](../access-control.md).

| Arg | Type |
|---|---|
| `query` | optional substring over site, host, username, url (case-insensitive) |
| `limit` | int 1–1000, default 100 |

Returns `{ count, entries: [{ id, site, host, url, username, createdAt, updatedAt, passwordUpdatedAt, has_notes }] }`, filtered by the profile's site scope.

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
