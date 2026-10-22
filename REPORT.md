# mcp-vault: build & install report

_Date: 2026-10-22 · Reference install: macOS, Node v22.17.0 via nvm_

## 1. What was built

`mcp-vault` is a local, security-first password manager that runs as an **MCP
server**. AI clients can use it to generate passwords, create and store
credentials during signups, fill logins, and manage entries. Each client gets
its own token and permission profile.

| Area | Implementation |
|---|---|
| Password generation | `crypto.randomInt` (OS CSPRNG, unbiased). Default length **24**, range 8–256. Toggles for lower/upper/digits/symbols, custom symbol set, exclude look-alikes. Every enabled class is guaranteed by rejection sampling. |
| Encryption at rest | **AES-256-GCM** (random 96-bit nonce per write, 128-bit tag). The envelope header (format, version, alg, key id) is bound as AAD. Subkeys are derived with **HKDF-SHA256** (separate keys for vault encryption and registry MAC). The whole entry list is encrypted, **including site names, usernames and notes**. |
| Master key | 256-bit random key in the **macOS login Keychain** (service `mcp-vault`, account `master-key`). It is written through `security -i` on stdin, so it never appears in a process argv. It never touches a file or an env var, and there is no file- or env-based key provider in the code at all. |
| Entries | `site, host (normalised), url?, username, password, notes?, createdAt, updatedAt, passwordUpdatedAt`. |
| Access control | Per-client profiles in `clients.json`: **`read` / `write` / `reveal`** permissions, allowed **transports** (`stdio`, `http`), optional **site allowlist**, clipboard flag. Only **SHA-256 hashes** of the 256-bit tokens are stored. The registry is **HMAC-SHA256-protected** with a Keychain-derived key, so hand-editing it to escalate privileges is detected. Tools a client lacks permission for are **not even listed**. |
| Audit log | `~/.mcp-vault/audit.log`, JSON lines: timestamp, client, transport, action, ok/denied, entry id, site host. **Never** passwords, notes, tokens or keys (enforced by tests). |
| Files | `~/.mcp-vault` is **700**; `vault.enc`, `clients.json`, `config.json` and `audit.log` are **600**. Writes are atomic (temp + fsync + rename) under a cross-process lock, so several stdio clients and the HTTP server can share the vault safely. |
| Transports | **stdio** for local clients. An optional **Streamable HTTP** server (stateless, JSON responses) that binds **127.0.0.1 only** (hard-coded), requires a Bearer token for an `http`-enabled profile, and is **disabled by default**. |
| Clipboard | Optional `deliver: "clipboard"`. The secret goes to the macOS pasteboard via stdin and is tagged `org.nspasteboard.ConcealedType` so clipboard-history managers skip it. A detached job **clears it after 30 s**, but only if nothing new was copied since. When clipboard delivery is used, the secret is **not** included in the tool result. It is never available over HTTP. |
| MCP implementation | **Official TypeScript SDK** `@modelcontextprotocol/sdk` **1.32.1** (pinned exactly) with **zod 4.6.7**: `McpServer.registerTool` (one server per authenticated principal, registering only its permitted tools), `StdioServerTransport`, and stateless `StreamableHTTPServerTransport`. Tokens are checked before the transport: the env token at stdio startup, the `Authorization` header in the HTTP pre-checks. v1.0 used a hand-written JSON-RPC core; v2.0 replaced it with the SDK without changing behavior. |
| Error hygiene | Client-visible errors are fixed strings or validator messages. Unexpected errors are logged by class or code only, because parser messages could quote decrypted data. The client token is deleted from `process.env` at startup so child processes never inherit it. |

### MCP tools

| Tool | Permission | Returns secret? |
|---|---|---|
| `generate_password` | any authenticated client | yes (nothing stored) |
| `list_entries` (`query`, `limit`) | `read` | **never**: metadata only, plus a `has_notes` flag |
| `create_entry` (site, username, url?, notes?, password? or generator options, `deliver`) | `write` | the new password, to the caller only (or via clipboard) |
| `get_login_for_site` (site/URL, username?, `deliver`) **(fill helper)** | `reveal` | yes. Subdomains match their parent domain on a dot boundary, so `accounts.google.com` matches `google.com` and `evilgoogle.com` does not. If several accounts match, it returns the usernames only. |
| `reveal_password` (id, `deliver`) | `reveal` | yes (+ notes) |
| `update_entry` (id, fields, `password` or `regenerate`) | `write` | only when `regenerate=true` |
| `delete_entry` (id, `confirm: true`) | `delete` (separate from `write`; legacy `write` profiles keep it) | no |

## 2. Where it lives

| What | Path |
|---|---|
| Source / build | `~/Desktop/GitHub Projects/mcp-vault` (`src/`, `test/`, `dist/` after build) |
| Vault data | `~/.mcp-vault/` → `vault.enc`, `clients.json`, `config.json`, `audit.log` |
| Master key | macOS Keychain → login keychain, item **"mcp-vault master-key"** |
| CLI | `~/.local/bin/mcp-vault` (wrapper → nvm Node 22.17.0 + `dist/src/cli.js`) |
| Client registration | stdio client profiles created with `mcp-vault client add`; the token lives in each client's MCP config file |

Installed state: **vault initialised and empty** (the smoke test entry was deleted), one stdio client profile (`read,write,reveal`), HTTP **disabled**.

## 3. Verification performed

_Re-verified after the v2.0 SDK refactor (2026-10-22)._

- **Tests: 27 passed, 0 failed, 1 skipped** (`npm test`). The skipped one is the opt-in real-Keychain test, which passes with `MCP_VAULT_KEYCHAIN_TEST=1`. Coverage:
  - **SDK integration:** an `@modelcontextprotocol/sdk` `Client` spawns the real stdio server (in-memory key fixture), lists the 7 tools, calls generate/create/list/reveal/delete, checks that a read-only token sees only its 2 tools and is refused on reveal, checks that SDK schema validation does not echo bad input, and checks that an invalid token is rejected before any MCP traffic.
  - Crypto: round-trip, fresh nonces, wrong key, tampering with ciphertext/tag/nonce/AAD header, HKDF separation, scrypt backup round-trip, no plaintext (passwords, sites, usernames, notes) in `vault.enc`, on-disk tamper rejection, key rotation, and recovery from an interrupted rotation.
  - Access control: token↔profile↔transport binding, hashed tokens, HMAC tamper detection on `clients.json`, token rotation and revocation, permission gating in both `tools/list` and `tools/call`, site scoping, clipboard refusal over HTTP, input validation (no echo of submitted values), delete confirmation, audit log free of secrets, 600/700 modes.
  - HTTP: loopback bind, 401 without or with a wrong token, stdio-only token rejected over HTTP, Origin → 403, foreign Host (DNS rebinding) → 403, tunnel Host allowlist, read-only profile sees only read tools, 202 for notifications, 405 for GET, 413 for oversized bodies, 429 after repeated auth failures.
- **Smoke test against the real vault** (`npm run smoke -- --clipboard`) driven by the SDK `Client` over stdio with a temporary `smoke-test` profile (removed afterwards). It ran initialize → tools/list → generate (32 chars, 206 bits) → create dummy entry on `smoke-test.mcp-vault.invalid` → list (no password field, secret absent) → fill by subdomain URL → reveal (matches) → clipboard refused for a no-clipboard profile → delete → list empty. The clipboard checks (dummy value) confirmed the copy, the concealed type, and auto-clear. **PASSED.** No secret was printed.
- An SDK client launched with the exact command, args and token from a stdio client's MCP config connects to server `mcp-vault 2.0.0`, lists 7 tools, and successfully calls `generate_password` (value not shown).

## 4. Connecting each client

### Local stdio clients
Create a profile, then add it to the client's MCP configuration:
```sh
mcp-vault client add my-client --perms read,write,reveal --transport stdio   # prints the token ONCE
```
```json
{
  "mcpServers": {
    "mcp-vault": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-vault/dist/src/cli.js", "serve"],
      "env": { "MCP_VAULT_TOKEN": "<token from the command above>" }
    }
  }
}
```
Then restart the client. To rotate: `mcp-vault client rotate-token my-client`.

### Aryan (Grok Bot, remote Linux): designed, not exposed
Aryan can only reach MCP servers over HTTPS by URL. The HTTP transport is built and tested but **off**. Nothing has been exposed to the internet.

1. Create a narrowly scoped profile. Give it only what it needs, for example no `reveal`, or a site allowlist:
   ```sh
   mcp-vault client add aryan --transport http --perms read,write,reveal --sites example.com,github.com --no-clipboard
   ```
   Store the printed token in Aryan's MCP connector as the `Authorization: Bearer <token>` header.
2. Enable and run the loopback server:
   ```sh
   mcp-vault http enable --port 8765 --allowed-host <public-hostname>
   mcp-vault serve-http          # or install examples/mcp-vault-http.launchd.plist with launchd
   ```
   It listens on `http://127.0.0.1:8765/mcp` only.
3. Expose it through **one** of these, in order of preference:
   - **Best: Tailscale Serve (tailnet-only, not Funnel).** If Aryan's Linux box can run Tailscale, join it to your tailnet and run `tailscale serve --bg --https=443 http://127.0.0.1:8765`. Add an ACL that lets only Aryan's node reach this Mac on 443. The endpoint `https://<mac>.<tailnet>.ts.net/mcp` is then **never on the public internet**, and TLS certs are automatic.
   - **Cloudflare Tunnel + Cloudflare Access** (cloudflared is already installed). Use a named tunnel to `vault.<your-domain>`, restricted to path `/mcp` (template: `examples/cloudflared-config.example.yml`). Protect it with a Zero Trust Access application whose only policy is **Service Auth** with a dedicated service token, and add a WAF rule allowing only Aryan's egress IP. Aryan then sends `CF-Access-Client-Id`/`CF-Access-Client-Secret` **and** the mcp-vault bearer token, giving two independent layers. There's no inbound port and the Mac's IP isn't revealed.
   - **Tailscale Funnel**: public internet with only the mcp-vault bearer token as protection. Acceptable for short tests; prefer the options above.
4. Hardening: run `serve-http` only while needed (`mcp-vault http disable` afterwards), rotate the token with `mcp-vault client rotate-token aryan`, watch `mcp-vault audit`, and never enable `clipboard` for HTTP (it is refused anyway).

## 5. Retrieving a stored password

- **Through an AI client:** ask it to use `get_login_for_site` (for example "fill my github.com login") or `list_entries` followed by `reveal_password`. Add `deliver: "clipboard"` so the password goes straight to your clipboard and never enters the model's context.
- **Yourself, in Terminal** (never printed):
  ```sh
  mcp-vault list [query]                 # metadata only
  mcp-vault copy github.com [--user me]  # copies password, auto-clears in 30 s
  mcp-vault add github.com me            # generate + store + copy to clipboard
  mcp-vault rm <id>
  mcp-vault audit --tail 20
  ```

## 6. Backup and master-key rotation

**Backup (recommended right after you add real entries):**
```sh
mcp-vault backup ~/Documents/mcp-vault-2026-10-22.mcpvault-backup   # prompts for a passphrase (min 12 chars), no echo
mcp-vault restore <file>                                            # merges entries back (by id)
```
The backup is sealed with **scrypt (N=2^17) + AES-256-GCM** under your passphrase. It does **not** depend on the Keychain key, so it survives losing the Mac. Keep it off-machine (USB stick or another cloud) and the passphrase in your head or another password manager.

Note: copying `~/.mcp-vault/vault.enc` alone is useless without the Keychain item. Time Machine backs up both (the login keychain plus the folder), but a restore to a *different* Mac needs the same login keychain. The passphrase backup is the portable option.

**Rotate the master key** (for example if you suspect it leaked):
```sh
mcp-vault backup <file>      # first, optional but wise
mcp-vault rotate-key
```
Rotation generates a new key, stores it as `master-key-next`, re-encrypts `vault.enc` and re-MACs `clients.json`, then promotes the new key and deletes the old one. If interrupted, the next start detects the pending key and finishes the promotion. Client tokens stay valid. Rotate those separately with `mcp-vault client rotate-token <name>`.

**Do not delete** the Keychain item "mcp-vault master-key": without it (and without a passphrase backup) the vault is unrecoverable.

## 7. Git / GitHub

- Repo: **https://github.com/smSamani/MCPVault** (public, confirmed by the owner in a follow-up request). `origin` points there.
- A strict `.gitignore` blocks vault and backup files, `*.enc`, keys/certs, `*token*`, `*secret*`, `clients*.json`, `audit*.log`/`*.log`, `.env*`, `node_modules/`, `dist/`, local task notes (`TASK.md`, `FOLLOWUP.md`) and `REPO_DESCRIPTION.txt`.
- Before going public, the **entire history** was scanned for token, key and credential patterns, and for the live client tokens and Keychain master key: **0 occurrences**. The only pattern hits are obviously fake test fixtures.
- Before the first push, the local history was rewritten to replace personal home-directory paths and the vault's key fingerprint with placeholders. A local branch `backup/pre-public-scrub` keeps the original commits and is never pushed.
- **Push status (2026-10-22): FAILED** with `fatal: could not read Username for 'https://github.com': terminal prompts disabled`. There are no non-interactive GitHub credentials on the build machine, and no other credentials were tried. The commits are local. To publish, authenticate (for example `gh auth login`) and run `git push -u origin main`.

## 8. Known limitations and threat model

- **Same-user processes are trusted by macOS.** The Keychain item was created by `/usr/bin/security`, which can read it without a prompt, so any process running as your user, including an AI agent with shell access, could run `security find-generic-password -s mcp-vault -w` or `mcp-vault copy`. Per-client profiles limit what each **MCP client** can do through the protocol. They are not a sandbox against an agent that also has unrestricted shell access. Mitigations: keep agent approval prompts on for shell commands, or, as future work, gate the key behind a code-signed helper with a Touch ID / user-presence prompt.
- **Local client tokens are stored in client config files** (user-only readable files). That is standard for MCP stdio servers; the tokens grant only their profile's permissions and can be rotated at any time.
- **Revealed secrets enter the AI model's context** (and possibly the provider's logs) when `deliver` is `return`. Prefer `deliver: "clipboard"` for local use.
- JavaScript strings can't be zeroed, so decrypted secrets live in process memory until garbage collected. The process is short-lived per client session.
- The whole vault is re-encrypted on each write. That's fine for hundreds to thousands of entries, not tuned for very large vaults.
- The audit log records site hosts (not secrets) in plaintext and has no rotation or tamper-chaining.
- The HTTP transport is stateless JSON only (no SSE streams or server-initiated messages, which a tools-only server doesn't need) and assumes Aryan's connector can send an `Authorization` header. If it truly supports only a bare URL, a token-in-URL mode would be needed. I deliberately didn't build that, because URLs end up in proxy logs.
- The auth-failure throttle is global, so a flood of bad tokens can briefly lock out Aryan too (HTTP 429 for ≤ 60 s).
- The Node path is pinned to nvm `v22.17.0`. If you uninstall that version, update the client configs and `~/.local/bin/mcp-vault`.
- macOS only (Keychain, pasteboard).

## 9. Always-on server deployment (2026-10-22)

| Item | Value |
|---|---|
| Host | Ubuntu 22.04 Lightsail (Paris), Node 20.20, systemd 249 |
| Public URL | `https://vault.salamaghapesar.uk/mcp` (Cloudflare named tunnel `mcpvault`, id `ceb658b9-a71c-444d-90d5-97271a91b1dc`; ingress only `/mcp` → `127.0.0.1:8765`, all else 404) |
| Services | `mcp-vault.service` (user `mcpvault`, hardened, `MemoryMax=150M`, `Restart=on-failure`), `mcpvault-tunnel.service`, `mcp-vault-backup.timer` (03:15 UTC), all enabled at boot |
| Master key | `/etc/mcp-vault/master.key` (root 0400) delivered as a systemd credential ([Linux key backend](docs/linux-key-backend.md)) |
| Client tokens | `aryan`, `siamak`: `read,write,reveal` over `http` (no `delete`; no export tool exists). Raw tokens only in `/etc/mcp-vault/clients.txt` (root 0400) |
| Backups | `/var/backups/mcp-vault/mcp-vault-<UTC>.tar.gpg` (gpg AES-256, verified after writing, newest 14 kept). Master key and `backup.pass` are NOT in the archive: keep offline copies |
| Vault | started **empty**; nothing copied from the Mac |

Verified: unauthenticated requests get 401; bad Host 403; GET 405; `delete_entry` is not offered to the remote profiles; create/list through the public URL works and the audit log records the real client IP (via `CF-Connecting-IP`); the archive decrypts and lists. Tests: 36 (35 passed, 1 opt-in Keychain test skipped). One deployment bug was found and fixed: the first syscall filter killed Node with SIGSYS (now `@system-service` + `EPERM`).

**Google Drive backups:** every change to `vault.enc`/`clients.json` triggers an encrypted `…-change.tar.gpg` archive uploaded to Drive folder `MCPVault Backups` (about 1 minute end to end, 10 s debounce), and the nightly archive uploads too. Newest 30 files are kept on Drive. rclone remote `gdrive`, scope `drive.file`, config `/etc/mcp-vault/rclone/rclone.conf` (root, 0600). Only `.tar.gpg` files are uploaded. Tested: HTTP create → archive on Drive in 50 s → decrypts on the server → matches live `vault.enc`; prune-to-N verified. Risk: it uses rclone's shared Google client id, which rclone says is being retired in 2026; the owner should create their own OAuth client ([docs/backups.md](docs/backups.md)).

Details: [server runbook](docs/runbooks/server-deployment.md) · [remote clients](docs/clients/remote.md). Residual risks: key and data share one host (root compromise = full exposure); Cloudflare terminates TLS; no Cloudflare Access layer is configured (bearer tokens + lockout only); revealed passwords enter the agents' context.

## 10. Summary

mcp-vault is built, tested (36 tests, 35 passed and 1 opt-in skipped, including an SDK-client stdio integration test, plus a passing opt-in real-Keychain test), installed, and smoke-tested end to end against the real vault. It works with any MCP client over stdio. It's AES-256-GCM encrypted with the master key in the macOS Keychain, has per-client read/write/reveal tokens, a secret-free audit log, 600/700 permissions, and is built on the official MCP SDK with two pinned runtime dependencies. On the Mac the HTTP transport stays **disabled**; remote agents (Aryan, Siamak) use a separate always-on server vault, see section 9. The code is in the public repo `smSamani/MCPVault`, and the full documentation bundle lives in `docs/` (start at `docs/index.md`).
