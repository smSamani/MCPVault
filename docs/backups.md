---
type: Concept
title: "Server backups (local + Google Drive)"
description: "Encrypted vault backups on the server: nightly and on-change archives, Google Drive upload, retention, restore."
resource: "deploy/"
tags: [backup, gdrive, rclone, systemd, security]
generated: { by: human:smSamani, at: 2026-10-22T10:27:40Z }
status: stable
stale_after: 2027-04-30
sources:
  - id: deploy-mcp-vault-backup
    resource: ../deploy/mcp-vault-backup
    last_modified: 2026-10-22
  - id: deploy-mcp-vault-gdrive-sync
    resource: ../deploy/mcp-vault-gdrive-sync
    last_modified: 2026-10-22
---

# Server backups (local + Google Drive)

Archives are **gpg-symmetric (AES-256) tarballs** of `vault.enc`, `clients.json`, `config.json` and `audit.log`, keyed by `/etc/mcp-vault/backup.pass`. `vault.enc` is itself AES-256-GCM under the master key, so a stolen archive needs **both** the backup passphrase and `master.key`. Each archive is test-decrypted before it is kept. [^deploy-mcp-vault-backup] [^deploy-mcp-vault-gdrive-sync]

| Trigger | Unit | File name | Local keep | Uploaded |
|---|---|---|---|---|
| Nightly 03:15 UTC | `mcp-vault-backup.timer` → `.service` | `mcp-vault-<UTC>.tar.gpg` | 14 | yes |
| Any change to `vault.enc` or `clients.json` | `mcp-vault-instant-backup.path` → `.service` | `mcp-vault-<UTC>-change.tar.gpg` | 30 | yes |

## Instant backup
A systemd `.path` unit (`PathChanged=` on both files) starts a oneshot service. **Debounce:** the service first sleeps 10 s, so a burst of edits produces one archive; after uploading it re-checks the file timestamps and repeats (max 3 rounds) if something changed meanwhile. A shared lock (`/var/backups/mcp-vault/.lock`) serialises it with the nightly run. Measured: the archive is on Drive about 1 minute after a change (10 s debounce + backup + upload). The audit log is deliberately not watched (it changes on every request).

## Google Drive upload
`/usr/local/sbin/mcp-vault-gdrive-sync` runs `rclone copy` of `*.tar.gpg` (never `.partial`, never anything else) to Drive folder **`MCPVault Backups`**, with `--immutable`, then deletes all but the **newest 30** files there (permanent delete, no trash). The rclone remote `gdrive` uses scope **`drive.file`**, so it can only see files it created itself; the config is `/etc/mcp-vault/rclone/rclone.conf` (root, 0600, holds the OAuth token). `master.key`, `backup.pass`, `clients.txt` and the rclone config are never uploaded. Without the config file the sync is skipped with a message.

## Restore from Drive
```sh
rclone copy "gdrive:MCPVault Backups/<file>" /tmp/restore --config /etc/mcp-vault/rclone/rclone.conf
gpg --batch --pinentry-mode loopback --passphrase-file /etc/mcp-vault/backup.pass -d /tmp/restore/<file> | tar -x -C /tmp/restore
```
Then follow [Restore in the server runbook](runbooks/server-deployment.md). The data only opens with the original `master.key`: keep offline copies of `master.key` and `backup.pass` (they are **not** on Drive).

## Operate
`systemctl status mcp-vault-instant-backup.path`, `journalctl -u mcp-vault-instant-backup -n 30`, `sudo rclone lsl "gdrive:MCPVault Backups" --config /etc/mcp-vault/rclone/rclone.conf`. Revoke access at any time in the Google Account's third-party access page. Re-authorise by running `rclone authorize "drive" --drive-scope drive.file` on a machine with a browser and replacing the `token =` line in the config.

## Known risk: shared Google client id
The remote currently uses rclone's built-in (shared) Google client id. Google rate-limits that project for all rclone users (one 403 `rateLimitExceeded` was seen during setup; the sync script retries 5 times with backoff), and rclone warns that this id is **being retired during 2026**. Before it stops working, create the owner's own OAuth client in a Google Cloud project (Drive API enabled, scope `drive.file`), set `client_id`/`client_secret` in the `[gdrive]` section and re-authorise (see [rclone docs](https://rclone.org/drive/#making-your-own-client-id)). Until then a failed upload shows up as a failed `mcp-vault-backup` / `mcp-vault-instant-backup` unit; local archives are still written.

## Tested (2026-10-22)
Creating an entry through the local HTTP endpoint produced a `…-change.tar.gpg` on Drive after 50 s; deleting it produced another after about 60 s; the Drive copy decrypted on the server and its `vault.enc` was byte-identical to the live file; pruning with `GDRIVE_KEEP=5` left exactly the newest 5 (production default 30).

Related: [server runbook](runbooks/server-deployment.md) · [Linux key backend](linux-key-backend.md) · [threat model](threat-model.md)
