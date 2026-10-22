---
type: Index
title: "Clients"
description: "Connecting MCP clients to MCPVault."
tags: [index, clients]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
---

# Clients

| Client | Transport | Guide |
|---|---|---|
| Any local MCP client | stdio | [stdio-clients.md](stdio-clients.md) |
| Aryan (Grok Bot, remote Linux) | HTTPS → tunnel → loopback HTTP | [aryan.md](aryan.md) |

| Aryan and Siamak (always-on server vault) | HTTPS → Cloudflare tunnel → loopback HTTP | [remote.md](remote.md) |

Each client should have its **own** profile and token ([access control](../access-control.md)).

Up: [bundle index](../index.md)
