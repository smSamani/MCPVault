#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readSync, closeSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addClient, PERMISSIONS, removeClient, rotateClientToken, type Principal } from "./access.js";
import { AuditLog } from "./audit.js";
import { openBackup, sealBackup, type Envelope } from "./crypto.js";
import { VaultError } from "./errors.js";
import { FILE_MODE, modeOf, writeFileAtomic } from "./fsutil.js";
import { serveHttp } from "./http.js";
import { selectKeyStore } from "./keystore.js";
import { serveStdio } from "./stdio.js";
import { callTool } from "./tools.js";
import { defaultHome, Vault, type Entry, type Permission, type Transport } from "./vault.js";


const out = (s: string) => process.stdout.write(s + "\n");
const info = (s: string) => process.stderr.write(s + "\n");

function fail(msg: string): never {
  info(`mcp-vault: ${msg}`);
  process.exit(1);
}

function parseFlags(argv: string[]): { pos: string[]; flags: Map<string, string | true> } {
  const pos: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags.set(k, v);
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) flags.set(k, argv[++i]!);
      else flags.set(k, true);
    } else pos.push(a);
  }
  return { pos, flags };
}

const list = (v: string | true | undefined, dflt: string[]): string[] =>
  typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : dflt;

/** The human owner at the terminal: full permissions, audited as "cli". */
const OWNER: Principal = { name: "cli", transport: "cli", permissions: new Set(PERMISSIONS), sites: ["*"], clipboard: true };

function runTool(vault: Vault, name: string, args: Record<string, unknown>): Record<string, unknown> {
  const r = callTool({ vault, audit: new AuditLog(vault.auditPath), principal: OWNER, config: vault.loadConfig() }, name, args);
  const text = r.content[0]?.text ?? "";
  if (r.isError) fail(text.replace(/^Error: /, ""));
  return JSON.parse(text) as Record<string, unknown>;
}

/** Read a secret from the terminal with echo disabled (or one line of stdin with --stdin). */
function readSecret(prompt: string, fromStdin: boolean): string {
  if (fromStdin) {
    const buf = Buffer.alloc(4096);
    const n = readSync(0, buf, 0, buf.length, null);
    return buf.subarray(0, n).toString("utf8").split(/\r?\n/)[0] ?? "";
  }
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    fail("no terminal available; use --stdin to pipe the passphrase");
  }
  try {
    writeFileSync(fd, prompt);
    spawnSync("/bin/stty", ["-echo"], { stdio: [fd, "ignore", "ignore"] });
    const chunks: Buffer[] = [];
    const b = Buffer.alloc(1);
    while (readSync(fd, b, 0, 1, null) === 1 && b[0] !== 0x0a && b[0] !== 0x0d) chunks.push(Buffer.from(b));
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    spawnSync("/bin/stty", ["echo"], { stdio: [fd, "ignore", "ignore"] });
    writeFileSync(fd, "\n");
    closeSync(fd);
  }
}

function status(vault: Vault, keyDescription: string): void {
  const cfg = vault.loadConfig();
  const fmt = (p: string) => {
    const m = modeOf(p);
    return m === null ? "missing" : `mode ${m.toString(8)}${m & 0o077 ? "  <-- TOO OPEN" : ""}`;
  };
  out(`home:        ${vault.home} (${fmt(vault.home)})`);
  out(`vault.enc:   ${fmt(vault.vaultPath)}`);
  out(`clients:     ${fmt(vault.clientsPath)}`);
  out(`config:      ${fmt(vault.configPath)}`);
  out(`audit.log:   ${fmt(vault.auditPath)}`);
  out(`master key:  ${keyDescription}, key id ${vault.currentKeyId()}`);
  out(`entries:     ${vault.load().entries.length}`);
  const reg = vault.loadClients();
  out(`clients:     ${Object.keys(reg.clients).join(", ") || "(none)"}`);
  out(`http:        ${cfg.http.enabled ? `ENABLED on 127.0.0.1:${cfg.http.port}` : "disabled"}`);
}

const HELP = `mcp-vault: security-first password manager MCP server

Setup
  init                         create master key (Keychain, or key file on Linux), vault and config in ~/.mcp-vault (or $MCP_VAULT_HOME)
  status                       show paths, permissions, key id, counts

Clients (per-client tokens; the token is printed ONCE on stdout)
  client add <name> --perms read,write,reveal,delete --transport stdio|http[,..] [--sites a.com,b.com] [--no-clipboard]
  client list
  client rotate-token <name>
  client remove <name>

Servers
  serve                        stdio MCP server (token via MCP_VAULT_TOKEN)
  serve-http                   loopback Streamable HTTP server (requires http enable)
  http enable [--port 8765] [--allowed-host vault.example.com]
  http disable

Owner commands (never print passwords)
  list [query]                 list entries (no secrets)
  copy <site> [--user U]       copy password to clipboard, auto-clears in 30 s
  add <site> <username> [--length N] [--no-symbols] [--url U]   generate + store, copy to clipboard
  rm <id>                      delete an entry
  audit [--tail N]             show the audit log

Master key backend (auto: systemd credential > MCP_VAULT_KEY_FILE > Keychain on macOS > /etc/mcp-vault/master.key)
  env MCP_VAULT_KEY_BACKEND=keychain|file|credential, MCP_VAULT_KEY_FILE=<path>

Keys and backups
  rotate-key                   generate a new master key and re-encrypt everything (Keychain only)
  backup <file> [--stdin]      write a passphrase-encrypted (scrypt + AES-256-GCM) backup
  restore <file> [--stdin]     merge entries from a backup into the vault
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseFlags(rest);
  const { store, description: keyDescription } = selectKeyStore();
  const vault = new Vault(defaultHome(), store);

  switch (cmd) {
    case "init": {
      const { createdKey } = vault.init();
      info(createdKey ? `Created a new 256-bit master key (${keyDescription}).` : `Master key already present (${keyDescription}).`);
      info(`Vault ready at ${vault.home}`);
      return;
    }
    case "status":
      return status(vault, keyDescription);
    case "serve":
      return serveStdio(vault);
    case "serve-http": {
      const cfg = vault.loadConfig();
      if (!cfg.http.enabled) fail("HTTP transport is disabled. Enable it explicitly with `mcp-vault http enable`.");
      const httpClients = Object.entries(vault.loadClients().clients).filter(([, c]) => c.transports.includes("http"));
      if (httpClients.length === 0) fail("no client profile allows the http transport; create one with `client add <name> --transport http ...`");
      await serveHttp(vault, { port: cfg.http.port, allowedHosts: cfg.http.allowedHosts, trustProxyHeader: cfg.http.allowedHosts.length > 0 });
      info(`mcp-vault HTTP listening on http://127.0.0.1:${cfg.http.port}/mcp (loopback only)`);
      return;
    }
    case "http": {
      const cfg = vault.loadConfig();
      if (pos[0] === "enable") {
        cfg.http.enabled = true;
        if (typeof flags.get("port") === "string") cfg.http.port = Number.parseInt(flags.get("port") as string, 10);
        if (!Number.isInteger(cfg.http.port) || cfg.http.port < 1024 || cfg.http.port > 65535) fail("port must be 1024-65535");
        cfg.http.allowedHosts = list(flags.get("allowed-host"), cfg.http.allowedHosts);
      } else if (pos[0] === "disable") cfg.http.enabled = false;
      else fail("usage: http enable|disable");
      vault.saveConfig(cfg);
      info(`HTTP transport ${cfg.http.enabled ? `enabled (127.0.0.1:${cfg.http.port}, extra hosts: ${cfg.http.allowedHosts.join(", ") || "none"})` : "disabled"}.`);
      return;
    }
    case "client": {
      const [sub, name] = pos;
      if (sub === "list") {
        for (const [n, c] of Object.entries(vault.loadClients().clients)) {
          out(`${n.padEnd(16)} perms=${c.permissions.join(",") || "-"}  transports=${c.transports.join(",")}  sites=${c.sites.join(",")}  clipboard=${c.clipboard}  created=${c.createdAt}`);
        }
        return;
      }
      if (!name) fail("client name required");
      if (sub === "add") {
        const token = addClient(vault, {
          name,
          permissions: list(flags.get("perms"), ["read"]) as Permission[],
          transports: list(flags.get("transport"), ["stdio"]) as Transport[],
          sites: list(flags.get("sites"), ["*"]),
          clipboard: !flags.has("no-clipboard"),
        });
        info(`Created client "${name}". Its token is printed below ONCE; store it in that client's config.`);
        out(token);
      } else if (sub === "rotate-token") {
        const token = rotateClientToken(vault, name);
        info(`New token for "${name}" (old token is now invalid):`);
        out(token);
      } else if (sub === "remove") {
        info(removeClient(vault, name) ? `Removed client "${name}".` : `No client "${name}".`);
      } else fail("usage: client add|list|rotate-token|remove");
      return;
    }
    case "list": {
      const r = runTool(vault, "list_entries", pos[0] ? { query: pos[0] } : {});
      for (const e of r.entries as Record<string, unknown>[]) out(`${String(e.id)}  ${String(e.site).padEnd(28)} ${String(e.username).padEnd(30)} updated ${String(e.updatedAt)}`);
      info(`${String(r.count)} entr${r.count === 1 ? "y" : "ies"}`);
      return;
    }
    case "copy": {
      if (!pos[0]) fail("usage: copy <site> [--user U]");
      const args: Record<string, unknown> = { site: pos[0], deliver: "clipboard" };
      if (typeof flags.get("user") === "string") args.username = flags.get("user");
      const r = runTool(vault, "get_login_for_site", args);
      if (r.ambiguous) {
        info("Several accounts match; pick one with --user:");
        for (const c of r.candidates as Record<string, unknown>[]) info(`  ${String(c.username)}`);
        process.exit(2);
      }
      info(`Copied password for ${String(r.username)} @ ${String(r.site)}; clipboard clears in ${String(r.clipboard_clears_in_seconds)} s.`);
      return;
    }
    case "add": {
      const [site, username] = pos;
      if (!site || !username) fail("usage: add <site> <username> [--length N] [--no-symbols] [--url U]");
      const args: Record<string, unknown> = { site, username, deliver: "clipboard" };
      if (typeof flags.get("length") === "string") args.length = Number.parseInt(flags.get("length") as string, 10);
      if (flags.has("no-symbols")) args.symbols = false;
      if (typeof flags.get("url") === "string") args.url = flags.get("url");
      const r = runTool(vault, "create_entry", args);
      info(`Stored ${username} @ ${site} (id ${String((r.entry as Entry).id)}). Password copied to clipboard; clears in ${String(r.clipboard_clears_in_seconds)} s.`);
      return;
    }
    case "rm": {
      if (!pos[0]) fail("usage: rm <id>");
      const r = runTool(vault, "delete_entry", { id: pos[0], confirm: true });
      info(`Deleted ${String(r.username)} @ ${String(r.site)}.`);
      return;
    }
    case "audit": {
      const n = typeof flags.get("tail") === "string" ? Number.parseInt(flags.get("tail") as string, 10) : 50;
      if (!existsSync(vault.auditPath)) return;
      const lines = readFileSync(vault.auditPath, "utf8").trimEnd().split("\n");
      for (const l of lines.slice(-n)) out(l);
      return;
    }
    case "rotate-key": {
      const r = vault.rotateMasterKey();
      new AuditLog(vault.auditPath).record({ client: "cli", transport: "cli", action: "rotate_master_key", ok: true, detail: `${r.oldKeyId} -> ${r.newKeyId}` });
      info(`Master key rotated (key id ${r.oldKeyId} -> ${r.newKeyId}). Older backups made with \`backup\` stay readable with their passphrase.`);
      return;
    }
    case "backup": {
      const file = pos[0];
      if (!file) fail("usage: backup <file>");
      const path = resolve(file);
      if (existsSync(path)) fail("refusing to overwrite an existing file");
      const stdin = flags.has("stdin");
      const p1 = readSecret("Backup passphrase (min 12 chars): ", stdin);
      if (p1.length < 12) fail("passphrase must be at least 12 characters");
      if (!stdin && readSecret("Repeat passphrase: ", false) !== p1) fail("passphrases do not match");
      const data = vault.load();
      const payload = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries: data.entries }), "utf8");
      writeFileAtomic(path, JSON.stringify(sealBackup(p1, payload)) + "\n");
      new AuditLog(vault.auditPath).record({ client: "cli", transport: "cli", action: "backup", ok: true, detail: `${data.entries.length} entries` });
      info(`Encrypted backup of ${data.entries.length} entries written to ${path} (mode ${(modeOf(path) ?? FILE_MODE).toString(8)}).`);
      return;
    }
    case "restore": {
      const file = pos[0];
      if (!file) fail("usage: restore <file>");
      const env = JSON.parse(readFileSync(resolve(file), "utf8")) as Envelope;
      const pass = readSecret("Backup passphrase: ", flags.has("stdin"));
      let payload: { entries: Entry[] };
      try {
        payload = JSON.parse(openBackup(pass, env).toString("utf8")) as { entries: Entry[] };
      } catch {
        fail("could not decrypt backup (wrong passphrase or corrupted file)");
      }
      if (!vault.isInitialized()) vault.init();
      const added = vault.mutate((d) => {
        const ids = new Set(d.entries.map((e) => e.id));
        const fresh = payload.entries.filter((e) => !ids.has(e.id));
        d.entries.push(...fresh);
        return fresh.length;
      });
      new AuditLog(vault.auditPath).record({ client: "cli", transport: "cli", action: "restore", ok: true, detail: `${added} entries added` });
      info(`Restored ${added} new entries (${payload.entries.length - added} already present).`);
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      out(HELP);
      return;
    default:
      fail(`unknown command "${cmd}". Run \`mcp-vault help\`.`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof VaultError) fail(err.message);
  // Do not print messages of unexpected errors verbatim (could quote data).
  fail(`unexpected ${(err as Error)?.name ?? "error"}${(err as NodeJS.ErrnoException)?.code ? ` (${(err as NodeJS.ErrnoException).code})` : ""}`);
});

