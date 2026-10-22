---
type: Runbook
title: "Install"
description: "Build, initialise and register MCPVault on a Mac."
tags: [runbook, install]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: package-json
    resource: ../../package.json
    last_modified: 2026-10-22
  - id: src-cli-ts
    resource: ../../src/cli.ts
    last_modified: 2026-10-22
---

# Install

Requirements: macOS, Node.js ≥ 20. [^package-json] [^src-cli-ts]

```sh
git clone https://github.com/smSamani/MCPVault.git mcp-vault && cd mcp-vault
npm install                         # pinned: @modelcontextprotocol/sdk 1.32.1, zod 4.6.7
npm test                            # build + tests
node dist/src/cli.js init           # Keychain master key + ~/.mcp-vault
node dist/src/cli.js client add my-client --perms read,write,reveal --transport stdio   # then see docs/clients/stdio-clients.md
npm run smoke                       # optional: e2e with a dummy entry (add -- --clipboard to test the clipboard)
node dist/src/cli.js status
```

Optional wrapper on your PATH:
```sh
printf '#!/bin/sh\nexec /ABSOLUTE/PATH/TO/node /ABSOLUTE/PATH/TO/mcp-vault/dist/src/cli.js "$@"\n' > ~/.local/bin/mcp-vault && chmod 755 ~/.local/bin/mcp-vault
```

Next: [clients](../clients/index.md) · [backup](backup-and-rotate.md)
