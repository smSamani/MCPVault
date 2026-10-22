#!/bin/bash
# Idempotent installer for an Ubuntu/Debian host. Run as root:
#   sudo HOSTNAME_PUBLIC=vault.example.com bash deploy/setup-server.sh
# Creates the mcpvault user, key material (only if absent), builds from git,
# installs the units, initialises an EMPTY vault and creates the client tokens
# (written ONLY to /etc/mcp-vault/clients.txt, mode 0400; never printed).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
: "${HOSTNAME_PUBLIC:?set HOSTNAME_PUBLIC=vault.example.com}"
REPO="${REPO:-https://github.com/smSamani/MCPVault.git}"
APP=/opt/mcp-vault
PORT=8765
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

id mcpvault >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mcp-vault --no-create-home --shell /usr/sbin/nologin mcpvault

install -d -m 0700 -o root -g root /etc/mcp-vault
install -d -m 0700 -o root -g root /var/backups/mcp-vault
if [ ! -e /etc/mcp-vault/master.key ]; then
  ( umask 277; head -c 32 /dev/urandom | base64 > /etc/mcp-vault/master.key )
fi
if [ ! -e /etc/mcp-vault/backup.pass ]; then
  ( umask 277; head -c 48 /dev/urandom | base64 -w0 > /etc/mcp-vault/backup.pass )
fi
chmod 0400 /etc/mcp-vault/master.key /etc/mcp-vault/backup.pass

if [ -d "$APP/.git" ]; then git -C "$APP" fetch --quiet origin main && git -C "$APP" reset --quiet --hard origin/main
else git clone --quiet --branch main "$REPO" "$APP"; fi
( cd "$APP" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent && npm prune --omit=dev --loglevel=error )

install -m 0755 "$APP/deploy/mcp-vault-admin" /usr/local/sbin/mcp-vault-admin
for f in mcp-vault-backup mcp-vault-gdrive-sync mcp-vault-instant-backup; do install -m 0755 "$APP/deploy/$f" /usr/local/sbin/$f; done
install -d -m 0700 /etc/mcp-vault/rclone
install -m 0644 "$APP/deploy/mcp-vault.service" /etc/systemd/system/mcp-vault.service
for u in mcp-vault-backup.service mcp-vault-backup.timer mcp-vault-instant-backup.service mcp-vault-instant-backup.path; do install -m 0644 "$APP/deploy/$u" /etc/systemd/system/$u; done
systemctl daemon-reload

mcp-vault-admin init
mcp-vault-admin http enable --port "$PORT" --allowed-host "$HOSTNAME_PUBLIC"

if [ ! -e /etc/mcp-vault/clients.txt ]; then
  ( umask 277
    tmp=$(mktemp /etc/mcp-vault/.clients.XXXXXX)
    for c in aryan siamak; do
      # No "delete" permission: remote agents may list/reveal/fill/generate/store but not delete.
      printf '%s=%s\n' "$c" "$(mcp-vault-admin client add "$c" --perms read,write,reveal --transport http 2>/dev/null)" >> "$tmp"
    done
    mv "$tmp" /etc/mcp-vault/clients.txt )
  chmod 0400 /etc/mcp-vault/clients.txt
fi

systemctl enable --now mcp-vault.service
systemctl restart mcp-vault.service
systemctl enable --now mcp-vault-backup.timer mcp-vault-instant-backup.path
echo "mcp-vault installed: $(systemctl is-active mcp-vault.service); listening on 127.0.0.1:$PORT"
