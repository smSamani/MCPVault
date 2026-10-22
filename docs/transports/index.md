---
type: Index
title: "Transports"
description: "How clients connect: stdio for local clients, optional loopback Streamable HTTP for remote ones."
tags: [index, transport]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
---

# Transports

| Transport | SDK class | Auth | Default |
|---|---|---|---|
| [stdio](stdio.md) | `StdioServerTransport` | `MCP_VAULT_TOKEN` env, verified at startup | used by local clients |
| [Streamable HTTP](http.md) | `StreamableHTTPServerTransport` (stateless, JSON) | `Authorization: Bearer`, verified before the transport | **disabled**, 127.0.0.1 only |

Up: [bundle index](../index.md)
