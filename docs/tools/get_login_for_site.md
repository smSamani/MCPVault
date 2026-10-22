---
type: MCP Tool
title: "get_login_for_site"
description: "Fill helper: username and password for a site or URL."
resource: "src/tools.ts"
tags: [mcp-tool, reveal, fill]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-tools-ts
    resource: ../../src/tools.ts
    last_modified: 2026-10-22
  - id: src-sites-ts
    resource: ../../src/sites.ts
    last_modified: 2026-10-22
---

# `get_login_for_site`

Fill helper: username and password for a site or URL. [^src-tools-ts] [^src-sites-ts]

**Permission:** `reveal` · see [access control](../access-control.md).

| Arg | Notes |
|---|---|
| `site` | host or full URL; subdomains match the parent domain on a dot boundary |
| `username` | optional, to choose among several accounts |
| `deliver` | `return` or `clipboard` |

Returns `{ id, site, url, username, delivered, password? }`. If several accounts match and no username is given, it returns `{ ambiguous: true, candidates: [{ id, site, username }] }` **without** passwords.

All secret-returning tools: with `deliver: "clipboard"` the secret is copied (concealed, auto-cleared after 30 s) and **omitted** from the result. This is allowed only for stdio profiles with `clipboard: true`.

Back to [tools](index.md).
