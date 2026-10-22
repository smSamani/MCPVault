---
type: Client Guide
title: "Aryan (remote assistant over HTTPS)"
description: "Safely connecting a remote assistant (Aryan / Grok Bot on a cloud Linux host) through the optional HTTP transport."
tags: [client, aryan, remote, http, tunnel]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: src-http-ts
    resource: ../../src/http.ts
    last_modified: 2026-10-22
---

# Aryan (remote assistant over HTTPS)

> The always-on server deployment with ready-made profiles is described in [remote clients](remote.md) and the [server runbook](../runbooks/server-deployment.md). This page covers the manual, Mac-hosted variant. [^src-http-ts]

Aryan runs on a separate cloud Linux machine and reaches MCP servers only over HTTPS by URL. MCPVault never exposes itself; **you** choose and run the tunnel.

## 1. Scoped profile
```sh
mcp-vault client add aryan --transport http --perms read,reveal --sites example.com,github.com --no-clipboard
```
Grant the minimum (for example omit `write` or `reveal`, or limit `--sites`). Put the printed token in Aryan's MCP connector as `Authorization: Bearer <token>`.

## 2. Enable the loopback server
```sh
mcp-vault http enable --port 8765 --allowed-host <public-hostname>
mcp-vault serve-http               # http://127.0.0.1:8765/mcp
```
An optional launchd template is in `examples/mcp-vault-http.launchd.plist`.

## 3. Expose it (most to least safe)
1. **Tailscale Serve (tailnet-only):** join Aryan's host to your tailnet, run `tailscale serve --bg --https=443 http://127.0.0.1:8765`, and restrict it with an ACL to Aryan's node. Never public.
2. **Cloudflare Tunnel + Cloudflare Access:** a named tunnel to `vault.<domain>`, path `/mcp` only (`examples/cloudflared-config.example.yml`), plus an Access app with a single **Service Auth** policy (service token) and a WAF rule for Aryan's egress IP. Aryan then sends the CF Access headers plus the bearer token, giving two layers.
3. **Tailscale Funnel:** public, bearer token only. Short tests only.

## 4. Operate
Run `serve-http` only when needed, then `mcp-vault http disable` afterwards. Rotate with `mcp-vault client rotate-token aryan`. Watch `mcp-vault audit`.

Details: [HTTP transport](../transports/http.md) · [threat model](../threat-model.md)
