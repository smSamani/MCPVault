---
type: Runbook
title: "Retrieve a stored password"
description: "Get a stored password into a login form without printing it."
tags: [runbook, retrieve]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-tools-ts
    resource: ../../src/tools.ts
    last_modified: 2026-10-22
---

# Retrieve a stored password

## Via an AI client
- "Fill my github.com login" → [get_login_for_site](../tools/get_login_for_site.md) (use `deliver: "clipboard"` to keep the secret out of the chat). [^src-tools-ts]
- Browse with [list_entries](../tools/list_entries.md), then [reveal_password](../tools/reveal_password.md) by id.

## Yourself, in Terminal (never printed)
```sh
mcp-vault list github                # find the entry
mcp-vault copy github.com --user me  # clipboard, auto-clears in 30 s
```
If several accounts match, `copy` lists the usernames; repeat with `--user`.
