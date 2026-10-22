# AGENTS.md

Instructions for **any automated agent** working in this repository.

## This repo uses the Open Knowledge Format (OKF v0.2)

The project's knowledge base is an **OKF bundle** in [`docs/`](docs/index.md):
one markdown file per concept (architecture, crypto, keychain, vault, access
control, audit log, each MCP tool, transports, clients, runbooks), each with
YAML frontmatter.

### How to read it

1. **Start at [`docs/index.md`](docs/index.md).** It lists every section with one-line descriptions.
2. Follow links into the subfolder `index.md` files (`tools/`, `transports/`, `clients/`, `runbooks/`) only as deep as your task needs (progressive disclosure).
3. Use the frontmatter (`type`, `title`, `description`, `resource`, `tags`, `generated`, `verified`, `status`, `stale_after`) to decide relevance before reading a body.
4. [`docs/log.md`](docs/log.md) is the dated change log.

### Frontmatter contract (OKF v0.2)

```yaml
---
type: <required, e.g. Concept | MCP Tool | Transport | Client Guide | Runbook | Index | Log>
title: <human title>
description: <one sentence>
resource: <repo-relative source path or URL, if the concept maps to code>
tags: [tag, tag]
generated: { by: <human:id | agent id>, at: <ISO 8601 UTC of last meaningful change> }
verified:                      # optional; omit when unverified
  - { by: ci:tests, at: <ISO 8601 UTC> }
status: stable                 # draft | stable | deprecated (absent = stable)
stale_after: 2027-04-30        # absolute date after which re-verification is due
sources:
  - id: src-access-ts          # cited in the body as [^src-access-ts]
    resource: ../src/access.ts # relative to this file (or a URL)
    last_modified: 2026-10-22  # date the source last changed
---
```

### Trust fields and how to maintain them

- **`generated`** replaces v0.1 `timestamp`. Whenever you change a concept's content, set `generated.by` to who produced it (`human:<id>` or your agent id) and `generated.at` to the current UTC time.
- **`verified`** is a list of independent confirmations. Add `{ by: ci:tests, at: <now> }` only to concepts whose behaviour is covered by the test suite, and only after `npm test` passes. A human sign-off is `human:<id>`. Never claim verification you did not perform. If you change a concept's content, drop stale `verified` entries until it is re-checked.
- **`status`**: `draft` for unfinished concepts, `stable` once complete, `deprecated` when superseded.
- **`stale_after`**: absolute date; after it passes, re-check the concept against its sources and renew the date.
- **`sources`**: one entry per file a claim derives from. Keep `last_modified` in step with the source file. Cite a source in the body with a markdown footnote `[^id]`; every footnote must match a `sources` id and every link must resolve. Do not use `# Citations` lists.

## Build and test

```sh
npm install                              # dependencies are pinned exactly
npm run build                            # tsc → dist/
npm test                                 # build + unit tests + SDK client stdio integration test
MCP_VAULT_KEYCHAIN_TEST=1 npm test       # also exercise the real macOS Keychain (throwaway item)
npm run smoke                            # end-to-end against the REAL installed vault (owner only)
node dist/src/cli.js help                # CLI reference
```

Project layout: `src/` (server, transports, tools, crypto, vault, key stores), `test/`, `scripts/smoke.mjs`, `examples/`, `deploy/` (systemd units + installer for the Linux server), `docs/`.
The MCP layer uses the official SDK: `src/server.ts` (McpServer.registerTool), `src/stdio.ts` (StdioServerTransport), `src/http.ts` (StreamableHTTPServerTransport).

## Rule: every code change updates the docs

Any change to code, configuration, CLI, tools or behavior **must**, in the same commit:

1. update the matching concept doc(s) in `docs/` (see each doc's `resource` field to find the mapping),
2. update those docs' `generated`, `verified`, `sources` (and `stale_after` if due) as described above,
3. add a dated entry to [`docs/log.md`](docs/log.md),
4. add or remove index entries when concepts are added or removed.

## Security rules for agents

- **Never print, log, commit or paste a real password, client token, or master key.** Use dummy values in tests and examples.
- Never commit anything from `~/.mcp-vault/`, `REPO_DESCRIPTION.txt`, `TASK.md`, `FOLLOWUP.md`, `.env*` or logs; respect `.gitignore`.
- Do not expose the HTTP transport to the internet unless the owner asked for it. The owner-approved deployment is the Cloudflare tunnel described in [docs/runbooks/server-deployment.md](docs/runbooks/server-deployment.md); never print or commit the server's `clients.txt`, `master.key` or `backup.pass`.
- Keep runtime dependencies minimal and **pinned exactly** (currently `@modelcontextprotocol/sdk@1.32.1` and `zod@4.6.7`). Adding one needs a strong security justification and a docs/log.md entry.
- Run `npm test` before committing. Never run `npm run smoke` unattended against someone else's vault.
