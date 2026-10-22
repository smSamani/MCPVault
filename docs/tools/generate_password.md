---
type: MCP Tool
title: "generate_password"
description: "Generate a strong random password; stores nothing."
resource: "src/generator.ts"
tags: [mcp-tool, generator]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-generator-ts
    resource: ../../src/generator.ts
    last_modified: 2026-10-22
---

# `generate_password`

Generate a strong random password; stores nothing. [^src-generator-ts]

**Permission:** any authenticated client · see [access control](../access-control.md).

| Arg | Type | Default |
|---|---|---|
| `length` | int 8–256 | 24 |
| `lowercase`, `uppercase`, `digits`, `symbols` | bool | true |
| `exclude_ambiguous` | bool: drops look-alike characters (I, l, 1, O, 0, o, pipe, quotes, backtick) | false |
| `symbol_set` | string (1–64 chars) | `!@#$%^&*()-_=+[]{};:,.?/~` |

Returns `{ password, length, entropy_bits }`. Uses `crypto.randomInt` (unbiased CSPRNG); every enabled class is guaranteed by rejection sampling.

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
