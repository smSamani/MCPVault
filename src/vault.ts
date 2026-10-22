import { randomUUID } from "node:crypto";
import { VaultError } from "./errors.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalJson, deriveKey, generateMasterKey, hmacHex, keyId, openVault, sealVault, type Envelope, constantTimeEqualHex } from "./crypto.js";
import { ensurePrivateDir, readFileIfExists, withFileLock, writeFileAtomic } from "./fsutil.js";
import { ACCOUNT_CURRENT, ACCOUNT_NEXT, type KeyStore } from "./keychain.js";
import { normalizeHost } from "./sites.js";

export interface Entry {
  id: string;
  site: string;
  host: string;
  url?: string;
  username: string;
  password: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
}

/** Entry metadata as returned by list/search: never contains the password. */
export type EntryMeta = Omit<Entry, "password">;

export interface VaultData {
  version: 1;
  entries: Entry[];
}

export type Permission = "read" | "write" | "reveal" | "delete";
export type Transport = "stdio" | "http";

export interface ClientProfile {
  tokenHash: string;
  permissions: Permission[];
  transports: Transport[];
  sites: string[];
  clipboard: boolean;
  createdAt: string;
  description?: string;
  /**
   * 2 = permissions are exact. Profiles without it predate the separate
   * "delete" permission: there, "write" implies "delete" (see authenticate).
   */
  schema?: 2;
}

export interface ClientRegistry {
  version: 1;
  clients: Record<string, ClientProfile>;
}

export interface Config {
  version: 1;
  clipboardClearSeconds: number;
  http: {
    enabled: boolean;
    port: number;
    /** Extra Host header values accepted (e.g. the tunnel hostname). */
    allowedHosts: string[];
  };
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  clipboardClearSeconds: 30,
  http: { enabled: false, port: 8765, allowedHosts: [] },
};

export function defaultHome(): string {
  return process.env.MCP_VAULT_HOME || join(homedir(), ".mcp-vault");
}

export function toMeta(e: Entry): EntryMeta {
  const { password: _omit, ...meta } = e;
  return meta;
}

/**
 * File layout (all under ~/.mcp-vault, dir 700, files 600):
 *   vault.enc     AES-256-GCM envelope of all entries (incl. site names)
 *   clients.json  client profiles (SHA-256 token hashes only) + HMAC
 *   config.json   non-secret settings
 *   audit.log     JSON lines, never contains secrets
 */
export class Vault {
  readonly vaultPath: string;
  readonly clientsPath: string;
  readonly configPath: string;
  readonly auditPath: string;
  readonly lockPath: string;

  constructor(readonly home: string, readonly keys: KeyStore) {
    this.vaultPath = join(home, "vault.enc");
    this.clientsPath = join(home, "clients.json");
    this.configPath = join(home, "config.json");
    this.auditPath = join(home, "audit.log");
    this.lockPath = join(home, "vault.lock");
  }

  isInitialized(): boolean {
    return existsSync(this.vaultPath) && this.keys.get(ACCOUNT_CURRENT) !== null;
  }

  /** Create the master key (if absent), an empty vault and default config. */
  init(): { createdKey: boolean } {
    ensurePrivateDir(this.home);
    let createdKey = false;
    let master = this.keys.get(ACCOUNT_CURRENT);
    if (!master) {
      if (existsSync(this.vaultPath)) {
        throw new VaultError("vault.enc exists but no master key was found in the key store; refusing to overwrite it");
      }
      master = generateMasterKey();
      this.keys.set(ACCOUNT_CURRENT, master);
      createdKey = true;
    }
    withFileLock(this.lockPath, () => {
      if (!existsSync(this.vaultPath)) this.writeVault(master!, { version: 1, entries: [] });
      if (!existsSync(this.clientsPath)) this.writeClients(master!, { version: 1, clients: {} });
      if (!existsSync(this.configPath)) writeFileAtomic(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    });
    return { createdKey };
  }

  // ---- master key -------------------------------------------------------

  /**
   * Return the key that sealed vault.enc. Handles an interrupted rotation:
   * if the envelope was written with the pending "next" key, promote it.
   */
  private masterKeyFor(env: Envelope | null): Buffer {
    const current = this.keys.get(ACCOUNT_CURRENT);
    if (!env) {
      if (!current) throw new VaultError("vault is not initialised; run `mcp-vault init`");
      return current;
    }
    if (current && keyId(current) === env.keyId) return current;
    const next = this.keys.get(ACCOUNT_NEXT);
    if (next && keyId(next) === env.keyId) {
      this.keys.set(ACCOUNT_CURRENT, next);
      this.keys.delete(ACCOUNT_NEXT);
      return next;
    }
    throw new VaultError("the master key in the key store does not match vault.enc");
  }

  private readEnvelope(): Envelope | null {
    const raw = readFileIfExists(this.vaultPath);
    return raw ? (JSON.parse(raw) as Envelope) : null;
  }

  // ---- vault data -------------------------------------------------------

  load(): VaultData {
    const env = this.readEnvelope();
    if (!env) throw new VaultError("vault is not initialised; run `mcp-vault init`");
    const master = this.masterKeyFor(env);
    let data: VaultData;
    try {
      data = JSON.parse(openVault(master, env).toString("utf8")) as VaultData;
    } catch {
      // Never surface parser messages: they can quote decrypted plaintext.
      throw new VaultError("could not decrypt/parse vault.enc");
    }
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new VaultError("unsupported vault data");
    return data;
  }

  private writeVault(master: Buffer, data: VaultData): void {
    writeFileAtomic(this.vaultPath, JSON.stringify(sealVault(master, Buffer.from(JSON.stringify(data), "utf8"))) + "\n");
  }

  /** Locked read-modify-write of the vault. */
  mutate<T>(fn: (data: VaultData) => T): T {
    return withFileLock(this.lockPath, () => {
      const env = this.readEnvelope();
      const master = this.masterKeyFor(env);
      const data = this.load();
      const result = fn(data);
      this.writeVault(master, data);
      return result;
    });
  }

  addEntry(input: { site: string; username: string; password: string; url?: string; notes?: string }): Entry {
    const now = new Date().toISOString();
    const entry: Entry = {
      id: randomUUID(),
      site: input.site.trim(),
      host: normalizeHost(input.url ?? input.site),
      username: input.username,
      password: input.password,
      createdAt: now,
      updatedAt: now,
      passwordUpdatedAt: now,
      ...(input.url ? { url: input.url } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    this.mutate((d) => {
      d.entries.push(entry);
    });
    return entry;
  }

  // ---- client registry --------------------------------------------------

  private clientsMac(master: Buffer, reg: ClientRegistry): string {
    return hmacHex(deriveKey(master, "clients-mac"), canonicalJson(reg));
  }

  private writeClients(master: Buffer, reg: ClientRegistry): void {
    writeFileAtomic(this.clientsPath, JSON.stringify({ ...reg, mac: this.clientsMac(master, reg) }, null, 2) + "\n");
  }

  /** Load the client registry, verifying its HMAC (tamper detection). */
  loadClients(): ClientRegistry {
    const raw = readFileIfExists(this.clientsPath);
    if (!raw) return { version: 1, clients: {} };
    const parsed = JSON.parse(raw) as ClientRegistry & { mac?: string };
    const { mac, ...reg } = parsed;
    const master = this.masterKeyFor(this.readEnvelope());
    if (!mac || !constantTimeEqualHex(mac, this.clientsMac(master, reg))) {
      throw new VaultError("clients.json failed integrity check (modified outside mcp-vault?)");
    }
    return reg;
  }

  mutateClients<T>(fn: (reg: ClientRegistry) => T): T {
    return withFileLock(this.lockPath, () => {
      const reg = this.loadClients();
      const result = fn(reg);
      this.writeClients(this.masterKeyFor(this.readEnvelope()), reg);
      return result;
    });
  }

  // ---- config -----------------------------------------------------------

  loadConfig(): Config {
    const raw = readFileIfExists(this.configPath);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const c = JSON.parse(raw) as Partial<Config>;
    return {
      ...DEFAULT_CONFIG,
      ...c,
      http: { ...DEFAULT_CONFIG.http, ...(c.http ?? {}) },
    } as Config;
  }

  saveConfig(c: Config): void {
    writeFileAtomic(this.configPath, JSON.stringify(c, null, 2) + "\n");
  }

  // ---- key rotation -----------------------------------------------------

  /**
   * Replace the master key. Crash-safe ordering:
   *   1. store new key as "master-key-next" in the key store
   *   2. re-seal vault.enc and re-MAC clients.json with it (atomic renames)
   *   3. promote it to "master-key" and delete "master-key-next"
   * If interrupted after 2, the next load promotes the pending key.
   */
  rotateMasterKey(): { oldKeyId: string; newKeyId: string } {
    return withFileLock(this.lockPath, () => {
      const env = this.readEnvelope();
      const oldKey = this.masterKeyFor(env);
      const data = this.load();
      const reg = this.loadClients();
      const newKey = generateMasterKey();
      this.keys.set(ACCOUNT_NEXT, newKey);
      this.writeVault(newKey, data);
      this.writeClients(newKey, reg);
      this.keys.set(ACCOUNT_CURRENT, newKey);
      this.keys.delete(ACCOUNT_NEXT);
      return { oldKeyId: keyId(oldKey), newKeyId: keyId(newKey) };
    });
  }

  currentKeyId(): string {
    return keyId(this.masterKeyFor(this.readEnvelope()));
  }
}
