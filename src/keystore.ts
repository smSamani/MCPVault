import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { MASTER_KEY_BYTES } from "./crypto.js";
import { VaultError } from "./errors.js";
import { ACCOUNT_CURRENT, ACCOUNT_NEXT, MacKeychain, type KeyStore } from "./keychain.js";

/** Name of the systemd credential carrying the master key (`LoadCredential=mcp-vault-master-key:<file>`). */
export const CREDENTIAL_NAME = "mcp-vault-master-key";
export const DEFAULT_KEY_FILE = "/etc/mcp-vault/master.key";

/**
 * Master key held in a single file (base64 of 32 random bytes), for Linux
 * servers without a Keychain. Deliberately minimal:
 *  - the file must be a regular file with no group/other permissions (the
 *    store refuses to use a readable-by-others key);
 *  - it can be created once (mode 0400, exclusive create) but never
 *    overwritten, so `rotate-key` is unsupported with this backend;
 *  - it is read on demand and never cached on disk or in env vars.
 * Pointing it at a systemd credential file ($CREDENTIALS_DIRECTORY/…) lets the
 * key stay root-owned: only the service's own tmpfs copy is readable by it.
 */
export class FileKeyStore implements KeyStore {
  constructor(readonly path: string) {}

  get(account: string): Buffer | null {
    if (account !== ACCOUNT_CURRENT) return null;
    let fd: number;
    try {
      fd = openSync(this.path, "r");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      if (code === "EACCES") throw new VaultError(`master key file ${this.path} is not readable by this user`);
      throw err;
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw new VaultError(`master key path ${this.path} is not a regular file`);
      if (st.mode & 0o077) throw new VaultError(`master key file ${this.path} must not be accessible by group/others (chmod 400)`);
      const key = Buffer.from(readFileSync(fd, "utf8").trim(), "base64");
      if (key.length !== MASTER_KEY_BYTES) throw new VaultError("master key file does not contain a valid base64 32-byte key");
      return key;
    } finally {
      closeSync(fd);
    }
  }

  set(account: string, key: Buffer): void {
    if (key.length !== MASTER_KEY_BYTES) throw new VaultError("master key must be 32 bytes");
    if (account === ACCOUNT_NEXT) {
      throw new VaultError("key rotation is not supported with a file/credential master key; see docs/linux-key-backend.md for the offline procedure");
    }
    if (account !== ACCOUNT_CURRENT) throw new VaultError("unsupported key account");
    const existing = this.get(account);
    if (existing) {
      if (existing.equals(key)) return;
      throw new VaultError("refusing to overwrite the existing master key file");
    }
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(this.path, "wx", 0o400);
    try {
      writeSync(fd, key.toString("base64") + "\n");
    } finally {
      closeSync(fd);
    }
  }

  delete(_account: string): void {
    // Key files are never deleted by the program; remove them by hand if intended.
  }
}

export interface KeyStoreSelection {
  store: KeyStore;
  /** Human description for `status` (never contains key material). */
  description: string;
}

/**
 * Choose the master-key backend.
 *  MCP_VAULT_KEY_BACKEND = keychain | file | credential forces one;
 *  otherwise: a systemd credential if present, else MCP_VAULT_KEY_FILE, else
 *  the macOS Keychain on darwin (unchanged behaviour), else the default key
 *  file on other platforms.
 */
export function selectKeyStore(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): KeyStoreSelection {
  const credDir = env.CREDENTIALS_DIRECTORY;
  const credPath = credDir ? join(credDir, CREDENTIAL_NAME) : null;
  const forced = env.MCP_VAULT_KEY_BACKEND;
  if (forced !== undefined && !["keychain", "file", "credential"].includes(forced)) {
    throw new VaultError("MCP_VAULT_KEY_BACKEND must be keychain, file or credential");
  }

  if (forced === "credential" || (forced === undefined && credPath && existsSync(credPath))) {
    if (!credPath) throw new VaultError("MCP_VAULT_KEY_BACKEND=credential but CREDENTIALS_DIRECTORY is not set (use systemd LoadCredential=)");
    return { store: new FileKeyStore(credPath), description: `systemd credential "${CREDENTIAL_NAME}" (read-only)` };
  }
  if (forced === "file" || (forced === undefined && (env.MCP_VAULT_KEY_FILE || platform !== "darwin"))) {
    const path = env.MCP_VAULT_KEY_FILE || DEFAULT_KEY_FILE;
    return { store: new FileKeyStore(path), description: `key file ${path}` };
  }
  return { store: new MacKeychain(), description: 'macOS Keychain, service "mcp-vault", account "master-key"' };
}
