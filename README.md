# MCPVault

**A security-first password manager for macOS that AI assistants can use through the Model Context Protocol, with every client on its own scoped token.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25%20%7C%202025--06--18%20%7C%202025--03--26-8A2BE2)](https://modelcontextprotocol.io)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)](#limitations)
[![MCP SDK 1.32.1](https://img.shields.io/badge/%40modelcontextprotocol%2Fsdk-1.32.1-8A2BE2)](https://github.com/modelcontextprotocol/typescript-sdk)

---

## What it does

MCPVault (`mcp-vault`) lets **any MCP client over stdio**, or a **remote MCP client over HTTP** through an authenticated tunnel, do
the following:

- **generate** strong passwords on demand,
- **create and store** a credential during a website signup and hand the new password back to the caller only,
- **fill** a login by site, with subdomains matching their parent domain,
- **list and search** entries without ever exposing secrets,
- **reveal** a password explicitly, or deliver it straight to the macOS clipboard with a 30-second auto-clear.

Everything is encrypted at rest with a master key that lives only in the
macOS Keychain. Each client gets its own token with `read` / `write` / `reveal` / `delete`
permissions, and every action is written to a secret-free audit log.

## Features

- 🔐 **AES-256-GCM** encryption of the *whole* vault (sites, usernames, notes too), with **HKDF-SHA256** subkeys
- 🗝️ **macOS Keychain** master key (never in a file, env var, or process argv); on Linux servers a root-only key file / systemd credential ([docs](docs/linux-key-backend.md))
- 🎟️ **Per-client tokens and profiles**: permissions, allowed transports, optional site allowlist, clipboard flag
- 🧾 **Audit log** of every call (client, action, entry id, outcome); never secrets
- 🎲 **CSPRNG password generator**: default 24 chars, 8–256, configurable charset, guaranteed class coverage
- 📋 **Concealed clipboard** delivery (skipped by clipboard managers) with **auto-clear after 30 s**
- 🔌 **stdio** transport for local clients plus an optional **loopback-only Streamable HTTP** transport (bearer auth, disabled by default)
- 🔁 **Crash-safe master-key rotation** and **passphrase-encrypted backups** (scrypt + AES-256-GCM)
- 🧩 **Official MCP TypeScript SDK** (`@modelcontextprotocol/sdk` 1.32.1, pinned): `McpServer.registerTool` with strict zod schemas, `StdioServerTransport`, `StreamableHTTPServerTransport`
- 📦 **Two pinned runtime dependencies** (the SDK and zod); crypto, HTTP and storage use the Node.js standard library
- 🔒 `700`/`600` file permissions, atomic writes, cross-process locking

## Security model

| Layer | Design |
|---|---|
| **Encryption** | `vault.enc` is one AES-256-GCM envelope (random 96-bit nonce per write, 128-bit tag). The header (format, version, algorithm, key id) is bound as additional authenticated data. Subkeys for encryption and registry MAC are derived from the master key with HKDF-SHA256. → [docs/crypto.md](docs/crypto.md) |
| **Master key** | 256-bit random key stored in the login Keychain (service `mcp-vault`). It is written via `security -i` on stdin, so it never appears in `ps`. On macOS there is no file- or env-based key path; Linux servers use a root-only key file or systemd credential. → [docs/keychain.md](docs/keychain.md), [docs/linux-key-backend.md](docs/linux-key-backend.md) |
| **Access control** | Clients authenticate with 256-bit tokens; only SHA-256 hashes are stored. The client registry is HMAC-protected, so hand-editing it to escalate privileges is detected. Tools a client is not allowed to use are hidden from `tools/list` and refused on call. Profiles can be limited to `stdio` or `http` and to specific sites. → [docs/access-control.md](docs/access-control.md) |
| **Audit log** | JSON lines with timestamp, client, transport, action, ok/denied, entry id and site host. Tests assert that passwords, notes and tokens never appear in it. → [docs/audit-log.md](docs/audit-log.md) |
| **Minimal surface** | Built on the official MCP SDK and exposes tools only (no resources, prompts or sampling); each connection gets a server that registers only the tools its token permits. The HTTP transport binds `127.0.0.1` only and enforces bearer auth, a Host allowlist, Origin rejection, a 64 KB body cap, timeouts and auth-failure throttling. |
| **Hygiene** | Client-visible errors never echo secret input. The client token is removed from the environment at startup. Writes are atomic with `600` files in a `700` directory. |

### Threat model and limitations

MCPVault protects secrets **at rest**, enforces **least privilege between MCP clients**,
and keeps secrets out of logs, files and process arguments. It does **not** defend
against code already running as your macOS user with shell access: such code can
read the Keychain item via `/usr/bin/security`. Passwords revealed with
`deliver: "return"` enter the AI model's context; prefer `deliver: "clipboard"`.
Full details: [docs/threat-model.md](docs/threat-model.md).

## Always-on server

`deploy/` holds a hardened systemd setup (vault on `127.0.0.1`, Cloudflare named tunnel, nightly encrypted backups, per-agent bearer tokens without delete rights). See [docs/runbooks/server-deployment.md](docs/runbooks/server-deployment.md) and [docs/clients/remote.md](docs/clients/remote.md).

## Quick start

```sh
git clone https://github.com/smSamani/MCPVault.git mcp-vault && cd mcp-vault
npm install && npm test               # build + unit and SDK integration tests
node dist/src/cli.js init             # master key -> Keychain, empty vault in ~/.mcp-vault
node dist/src/cli.js client add my-client --perms read,write,reveal --transport stdio   # prints a token once
npm run smoke                         # optional end-to-end MCP test with a dummy entry
```

Then ask your assistant: *"Create a login for example.com with username me@example.com and copy the password to my clipboard."*

## Install

Requirements: **macOS**, **Node.js ≥ 20**. Runtime dependencies (pinned): `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.7`. Dev: `typescript`, `@types/node`.

```sh
npm install
npm run build                       # outputs dist/
node dist/src/cli.js init
```

Optional convenience wrapper, so you can type `mcp-vault ...`:

```sh
cat > ~/.local/bin/mcp-vault <<'EOF'
#!/bin/sh
exec /ABSOLUTE/PATH/TO/node /ABSOLUTE/PATH/TO/mcp-vault/dist/src/cli.js "$@"
EOF
chmod 755 ~/.local/bin/mcp-vault
```

Data lives in `~/.mcp-vault/` (`vault.enc`, `clients.json`, `config.json`, `audit.log`). Override the location with `MCP_VAULT_HOME`.
→ [docs/runbooks/install.md](docs/runbooks/install.md)

## Tools reference

| Tool | Permission | Purpose | Returns a secret? |
|---|---|---|---|
| [`generate_password`](docs/tools/generate_password.md) | any client | Generate a password; stores nothing | yes |
| [`list_entries`](docs/tools/list_entries.md) | `read` | List/search entries by site, host, username, url | **never** |
| [`create_entry`](docs/tools/create_entry.md) | `write` | Store a credential, generating the password if none is given | to the caller only, or via clipboard |
| [`get_login_for_site`](docs/tools/get_login_for_site.md) | `reveal` | Fill helper: username + password for a site/URL | yes (usernames only if ambiguous) |
| [`reveal_password`](docs/tools/reveal_password.md) | `reveal` | Explicitly reveal one entry's password and notes | yes |
| [`update_entry`](docs/tools/update_entry.md) | `write` | Edit fields, set or regenerate the password | only on regenerate |
| [`delete_entry`](docs/tools/delete_entry.md) | `delete` | Delete an entry (`confirm: true` required) | no |

Every secret-returning tool accepts `deliver: "return" | "clipboard"`. With
`clipboard`, the secret is **not** included in the result (local stdio clients only).

## Connecting clients

### Local MCP clients (stdio)
```sh
mcp-vault client add my-client --perms read,write,reveal,delete --transport stdio   # prints the token once
```
Add the following to the MCP configuration of any stdio-capable client and restart it:
```json
{
  "mcpServers": {
    "mcp-vault": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-vault/dist/src/cli.js", "serve"],
      "env": { "MCP_VAULT_TOKEN": "<token>" }
    }
  }
}
```
→ [docs/clients/stdio-clients.md](docs/clients/stdio-clients.md)

### Remote assistants (e.g. Aryan / Grok Bot) over authenticated HTTP

The HTTP transport is **off by default** and only ever listens on `127.0.0.1`.
Reaching it remotely requires a tunnel that **you** set up.

```sh
mcp-vault client add aryan --transport http --perms read,reveal --sites example.com --no-clipboard  # token printed once
mcp-vault http enable --port 8765 --allowed-host <public-hostname>
mcp-vault serve-http                 # http://127.0.0.1:8765/mcp
```

Expose it in this order of preference:
1. **Tailscale Serve** (tailnet-only, never public). Best if the remote machine can join your tailnet.
2. **Cloudflare Tunnel + Cloudflare Access** (Service Auth token + IP rule) in front of the bearer token, giving two independent layers. See [`examples/cloudflared-config.example.yml`](examples/cloudflared-config.example.yml).
3. **Tailscale Funnel** (public, bearer token only): short tests only.

The remote client sends `Authorization: Bearer <token>`. Clipboard delivery is never available over HTTP.
→ [docs/clients/aryan.md](docs/clients/aryan.md) · [docs/transports/http.md](docs/transports/http.md)

## Retrieving a stored password

- **Via your assistant:** *"Get my github.com login"* → `get_login_for_site`, ideally with `deliver: "clipboard"`.
- **Yourself, in Terminal** (passwords are never printed):
  ```sh
  mcp-vault list github                 # metadata only
  mcp-vault copy github.com --user me   # clipboard, auto-clears in 30 s
  mcp-vault add example.com me          # generate + store + copy
  mcp-vault audit --tail 20
  ```
→ [docs/runbooks/retrieve-password.md](docs/runbooks/retrieve-password.md) · [docs/cli.md](docs/cli.md)

## Backup and key rotation

```sh
mcp-vault backup ~/Documents/vault.mcpvault-backup   # passphrase-encrypted (scrypt N=2^17 + AES-256-GCM)
mcp-vault restore ~/Documents/vault.mcpvault-backup  # merge entries back by id
mcp-vault rotate-key                                 # new master key, re-encrypt everything, crash-safe
mcp-vault client rotate-token <name>                 # rotate a client's token
```

A passphrase backup is independent of the Keychain, so it survives losing the
Mac. `vault.enc` alone is useless without the Keychain item.
→ [docs/runbooks/backup-and-rotate.md](docs/runbooks/backup-and-rotate.md)

## Architecture

```
client ─stdio (env token)──────────▶ StdioServerTransport ─┐
remote ─HTTPS tunnel─▶ 127.0.0.1 checks + Bearer auth ─▶ StreamableHTTPServerTransport ─┤
                                                         ▼
                       McpServer (per principal, only permitted tools, zod schemas)
                                                         ▼
                       callTool → permission → validate → handler → audit
                                                         ▼
                       AES-256-GCM vault  ·  macOS Keychain master key
```
Details: [docs/architecture.md](docs/architecture.md)

## Documentation

**Start at [docs/index.md](docs/index.md).** Full documentation is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
(OKF v0.2) bundle in [`docs/`](docs/index.md). Automated agents should read [AGENTS.md](AGENTS.md) first.

## Roadmap

- [ ] Gate the master key behind a code-signed helper with Touch ID / user-presence confirmation
- [ ] Per-tool rate limits and an optional "confirm every reveal" mode
- [ ] Tamper-evident (hash-chained) audit log with rotation
- [ ] TOTP (2FA) secrets with code generation
- [ ] Passphrase / diceware generation mode
- [ ] Import from CSV exports (1Password, Bitwarden, browsers)
- [ ] Optional OAuth 2.1 for the HTTP transport
- [ ] Linux support (libsecret) for running the vault off-Mac

## Limitations

macOS only. It is a single-user vault with no sync. The HTTP transport is stateless
JSON (no SSE) and requires a client that can send an `Authorization` header. The
Node path is pinned at registration time. See [docs/threat-model.md](docs/threat-model.md).

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
