# Security Policy

mcp-vault stores credentials, so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue for security problems.** Instead, use GitHub's
private vulnerability reporting: **Security → Report a vulnerability** on
this repository. Please include:

- the affected version or commit,
- a description of the issue and its impact,
- steps to reproduce or a proof of concept (use dummy data, never real passwords).

You can expect an acknowledgement within 7 days. Please allow a reasonable
window for a fix before public disclosure.

## Supported versions

Only the latest commit on `main` is supported.

## Scope

In scope:
- confidentiality or integrity of `vault.enc`, `clients.json` or the master key (Keychain, or key file / systemd credential on Linux),
- authentication or authorization bypasses (client tokens, permissions, site scoping, transports),
- secrets leaking into logs, audit entries, error messages, process arguments or files,
- the loopback HTTP transport (auth, lockout, Host/Origin checks, request handling) and the `deploy/` units.

Out of scope (documented limitations, see [docs/threat-model.md](docs/threat-model.md)):
- attacks by malware or agents that already run as the same macOS user with shell access,
- secrets that a client deliberately requested being visible to that client or its model provider,
- exposure caused by publishing the HTTP transport without the tunnel and access controls described in [docs/clients/aryan.md](docs/clients/aryan.md).

## Handling secrets in reports and PRs

Never paste real passwords, client tokens (`mcpv_…`), master keys, `vault.enc`,
`clients.json` or `audit.log` contents into issues, PRs or commits.
