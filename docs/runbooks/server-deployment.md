---
type: Runbook
title: "Server deployment (always-on Linux)"
description: "Deploy MCPVault on an Ubuntu server behind a Cloudflare named tunnel for remote agents; units, tokens, backups, operations."
resource: "deploy/"
tags: [runbook, deployment, linux, systemd, cloudflare, backup]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: deploy-setup-server-sh
    resource: ../../deploy/setup-server.sh
    last_modified: 2026-10-22
  - id: deploy-mcp-vault-service
    resource: ../../deploy/mcp-vault.service
    last_modified: 2026-10-22
  - id: deploy-mcpvault-tunnel-service
    resource: ../../deploy/mcpvault-tunnel.service
    last_modified: 2026-10-22
---

# Server deployment (always-on Linux)

Goal: an always-on instance reachable over HTTPS by remote agents ([Aryan, Siamak](../clients/remote.md)) while the Mac is off. The Mac vault is separate and unchanged; the server vault **starts empty**. [^deploy-setup-server-sh] [^deploy-mcp-vault-service] [^deploy-mcpvault-tunnel-service]

## Layout
| Path | Owner / mode | Purpose |
|---|---|---|
| `/opt/mcp-vault` | root | git checkout of `main`, built with `npm ci && npm run build`, dev deps pruned |
| `/var/lib/mcp-vault` | mcpvault 0700 | `vault.enc`, `clients.json`, `config.json`, `audit.log` |
| `/etc/mcp-vault/master.key` | root 0400 | master key, delivered via systemd credential ([details](../linux-key-backend.md)) |
| `/etc/mcp-vault/clients.txt` | root 0400 | raw client tokens (`name=token`); the **only** place they exist |
| `/etc/mcp-vault/backup.pass` | root 0400 | passphrase for backup archives |
| `/var/backups/mcp-vault` | root 0700 | `mcp-vault-<UTC>.tar.gpg` (nightly, 14 kept) and `…-change.tar.gpg` (30 kept) |
| `/etc/mcp-vault/rclone/rclone.conf` | root 0600 | Google Drive remote `gdrive` (scope `drive.file`) |
| `/etc/cloudflared/mcpvault.{yml,json}` | root | tunnel config (0644) and credentials (0400) |

## Services
- **`mcp-vault.service`**: user `mcpvault`, `serve-http` on **127.0.0.1:8765**, `Restart=on-failure`, enabled at boot. Hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `ReadWritePaths=/var/lib/mcp-vault`, empty capability set, syscall filter, `MemoryMax=150M`. (`MemoryDenyWriteExecute` is off because V8 needs it.)
- **`mcpvault-tunnel.service`**: `cloudflared` named tunnel, `DynamicUser`, credentials passed as a systemd credential; ingress **only** `https://<host>/mcp` → `http://127.0.0.1:8765`, everything else 404.
- **`mcp-vault-backup.timer`** (03:15 UTC) and **`mcp-vault-instant-backup.path`** (on every change of `vault.enc`/`clients.json`, debounced): `/usr/local/sbin/mcp-vault-backup` tars the data files, encrypts with `gpg --symmetric` (AES-256) keyed by `backup.pass`, verifies the archive, prunes (14 nightly / 30 on-change); then `mcp-vault-gdrive-sync` uploads to Google Drive `MCPVault Backups` (newest 30 kept). See [Server backups](../backups.md).

Never touched: x-ui/xray (80, 443, 2096, 10216, 25349), coturn, postgresql, phd-ledger, video-streamer, fail2ban, sshd; the stopped ifixnow/shiva units stay stopped. The vault uses only 127.0.0.1:8765.

## Install (from the repo)
```sh
sudo HOSTNAME_PUBLIC=vault.example.com bash deploy/setup-server.sh
```
Idempotent: creates the user, key material (only if missing), builds from git, installs units/helpers, initialises an empty vault, enables HTTP for the hostname, creates the `aryan` and `siamak` tokens into `clients.txt` (only if it does not exist), starts the service and the backup timer.

## Tunnel (deployed: `mcpvault`, `https://vault.salamaghapesar.uk/mcp`; procedure below, needs the Cloudflare account; run on the Mac where `cloudflared tunnel login` was done)
```sh
cloudflared tunnel create mcpvault
cloudflared tunnel route dns mcpvault vault.<zone>
scp ~/.cloudflared/<TUNNEL-ID>.json server:/tmp/mcpvault.json      # then on the server:
sudo install -m 0400 -o root -g root /tmp/mcpvault.json /etc/cloudflared/mcpvault.json && shred -u /tmp/mcpvault.json
sudo install -m 0644 deploy/cloudflared-mcpvault.example.yml /etc/cloudflared/mcpvault.yml   # edit tunnel id + hostname
sudo install -m 0644 deploy/mcpvault-tunnel.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now mcpvault-tunnel
```
Do not modify other tunnels or their credentials.

## Operate
```sh
systemctl status mcp-vault mcpvault-tunnel mcp-vault-backup.timer
curl -s http://127.0.0.1:8765/healthz                         # {"ok":true}
sudo mcp-vault-admin status | client list | audit --tail 50   # admin CLI (runs as mcpvault with the key credential)
sudo journalctl -u mcp-vault -u mcpvault-tunnel -n 50
sudo systemctl start mcp-vault-backup.service                 # backup now
```
**Read tokens:** `sudo cat /etc/mcp-vault/clients.txt` (hand each agent only its own line). **Rotate one:** `sudo mcp-vault-admin client rotate-token aryan` prints the new token on stdout; update `clients.txt` and the agent. **Update code:** `git -C /opt/mcp-vault pull`, `npm ci && npm run build && npm prune --omit=dev`, `systemctl restart mcp-vault`.

## Restore
Decrypt: `gpg --batch --pinentry-mode loopback --passphrase-file /etc/mcp-vault/backup.pass -d <file>.tar.gpg | tar -x -C <dir>`; stop the service; copy the files into `/var/lib/mcp-vault` (owner `mcpvault`, modes 600); start. The restored `vault.enc` only opens with the **same** `master.key`, so keep an offline copy of `master.key` and `backup.pass` somewhere other than this server.

## Risks
Single small host; root compromise exposes key + data; `master.key` has no automatic off-box copy; HTTPS terminates at Cloudflare (it can see traffic); passwords revealed to agents enter their context; no Cloudflare Access layer unless added in the dashboard (bearer tokens + per-source lockout are the only gates). See the [threat model](../threat-model.md).
