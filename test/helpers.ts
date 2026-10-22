import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addClient, authenticate, type Principal } from "../src/access.js";
import { AuditLog } from "../src/audit.js";
import { MemoryKeyStore } from "../src/keychain.js";
import { callTool } from "../src/tools.js";
import { Vault, type Permission, type Transport } from "../src/vault.js";

export function tempVault(): { vault: Vault; keys: MemoryKeyStore; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "mcp-vault-test-"));
  const keys = new MemoryKeyStore();
  const vault = new Vault(join(home, "v"), keys);
  vault.init();
  return { vault, keys, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function principalFor(vault: Vault, name: string, permissions: Permission[], opts: { sites?: string[]; transports?: Transport[] } = {}): Principal {
  const transports = opts.transports ?? ["stdio"];
  const token = addClient(vault, { name, permissions, transports, sites: opts.sites, clipboard: false });
  const p = authenticate(vault.loadClients(), token, transports[0]!);
  if (!p) throw new Error("auth failed in test setup");
  return p;
}

export function call(vault: Vault, principal: Principal, tool: string, args: Record<string, unknown>) {
  const r = callTool({ vault, audit: new AuditLog(vault.auditPath), principal, config: vault.loadConfig() }, tool, args);
  const text = r.content[0]!.text;
  return { isError: Boolean(r.isError), text, json: r.isError ? null : (JSON.parse(text) as Record<string, any>) };
}
