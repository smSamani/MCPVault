---
type: MCP Tool
title: "create_entry"
description: "Create and store a credential, generating the password unless one is given; returns the secret only to the caller."
resource: "src/tools.ts"
tags: [mcp-tool, write, signup]
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

# `create_entry`

Create and store a credential, generating the password unless one is given; returns the secret only to the caller. [^src-tools-ts]

**Permission:** `write` · see [access control](../access-control.md).

| Arg | Notes |
|---|---|
| `site`, `username` | required |
| `url`, `notes` | optional (notes are encrypted) |
| `password` | optional; otherwise generated with the [generator options](generate_password.md) |
| `deliver` | `return` (default) or `clipboard` |
| `allow_duplicate` | default false: the same host+username is refused (use [update_entry](update_entry.md)) |

Returns `{ entry: <metadata>, generated, delivered, password? }`. The target host must be inside the profile's site scope. This is the signup flow: generate, store, and fill.

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
