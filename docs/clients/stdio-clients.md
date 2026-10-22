---
type: Client Guide
title: "Local stdio clients"
description: "Connect any MCP client that speaks stdio to MCPVault."
tags: [client, stdio]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-stdio-ts
    resource: ../../src/stdio.ts
    last_modified: 2026-10-22
  - id: src-cli-ts
    resource: ../../src/cli.ts
    last_modified: 2026-10-22
---

# Local stdio clients

Any MCP client that can launch a stdio server works. Create a profile (the token is printed once): [^src-stdio-ts] [^src-cli-ts]
```sh
mcp-vault client add my-client --perms read,write,reveal --transport stdio
```
Then add this to the client's MCP configuration and restart it:
```json
{ "mcpServers": { "mcp-vault": {
  "command": "/ABSOLUTE/PATH/TO/node",
  "args": ["/ABSOLUTE/PATH/TO/mcp-vault/dist/src/cli.js", "serve"],
  "env": { "MCP_VAULT_TOKEN": "<token>" } } } }
```
Rotate the token with `mcp-vault client rotate-token my-client` and update the config. Restrict access with `--perms read,reveal`.

Usage tips: ask for `deliver: "clipboard"` so passwords stay out of the conversation. See the [tools](../tools/index.md), [stdio](../transports/stdio.md) and [access control](../access-control.md) docs.
