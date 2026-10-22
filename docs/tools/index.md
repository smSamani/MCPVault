---
type: Index
title: "MCP tools"
description: "The seven tools MCPVault registers with the MCP SDK, by permission."
tags: [index, mcp-tool]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
---

# MCP tools

Each tool is registered via `McpServer.registerTool` with a strict zod input schema and annotations (`readOnlyHint`, `destructiveHint`, …), and only for principals that hold its permission ([access control](../access-control.md)).

| Tool | Permission | Purpose |
|---|---|---|
| [generate_password](generate_password.md) | any authenticated client | Generate a strong random password; stores nothing. |
| [list_entries](list_entries.md) | `read` | List or search entries; never returns passwords or notes. |
| [create_entry](create_entry.md) | `write` | Create and store a credential, generating the password unless one is given; returns the secret only to the caller. |
| [get_login_for_site](get_login_for_site.md) | `reveal` | Fill helper: username and password for a site or URL. |
| [reveal_password](reveal_password.md) | `reveal` | Explicitly reveal one entry's password and notes by id. |
| [update_entry](update_entry.md) | `write` | Update fields or rotate the password of an entry. |
| [delete_entry](delete_entry.md) | `delete` | Permanently delete an entry. |

Up: [bundle index](../index.md)
