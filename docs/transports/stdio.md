---
type: Transport
title: "stdio transport"
description: "Local transport used by any stdio-capable MCP client."
resource: "src/stdio.ts"
tags: [transport, stdio]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
verified:
  - { by: ci:tests, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-stdio-ts
    resource: ../../src/stdio.ts
    last_modified: 2026-10-22
---

# stdio transport

`mcp-vault serve` (`src/stdio.ts`): [^src-stdio-ts]
1. reads `MCP_VAULT_TOKEN` from the environment and **deletes it** from `process.env`, so child processes such as `osascript` and `security` never inherit it,
2. authenticates it against `clients.json` for transport `stdio`. On failure it writes an audit `auth` failure, prints a short stderr message, and exits 1 before any MCP traffic,
3. builds a principal-scoped `McpServer` ([architecture](../architecture.md)) and connects `StdioServerTransport`.

stdout carries only MCP messages; diagnostics go to stderr and never include secrets. Client setup: [stdio clients](../clients/stdio-clients.md).
