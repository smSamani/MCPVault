import { execFileSync, spawnSync } from "node:child_process";
import { VaultError } from "./errors.js";
import { MASTER_KEY_BYTES } from "./crypto.js";

/**
 * Where the master key lives. Production uses the macOS login Keychain;
 * tests inject an in-memory provider. There is deliberately NO file- or
 * env-var-based provider.
 */
export interface KeyStore {
  get(account: string): Buffer | null;
  set(account: string, key: Buffer): void;
  delete(account: string): void;
}

export const ACCOUNT_CURRENT = "master-key";
export const ACCOUNT_NEXT = "master-key-next";

const SECURITY = "/usr/bin/security";

export class MacKeychain implements KeyStore {
  constructor(readonly service = "mcp-vault") {}

  get(account: string): Buffer | null {
    const r = spawnSync(SECURITY, ["find-generic-password", "-s", this.service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status === 44) return null; // errSecItemNotFound
    if (r.status !== 0) throw new VaultError(`Keychain read failed (status ${r.status}); is the login keychain unlocked?`);
    const key = Buffer.from(r.stdout.trim(), "base64");
    if (key.length !== MASTER_KEY_BYTES) throw new VaultError("Keychain item does not contain a valid 32-byte key");
    return key;
  }

  set(account: string, key: Buffer): void {
    if (key.length !== MASTER_KEY_BYTES) throw new VaultError("master key must be 32 bytes");
    // `security -i` reads the command from stdin, so the key never appears
    // in argv (visible via `ps`). Base64 contains no shell-special chars.
    const cmd = `add-generic-password -U -s ${this.service} -a ${account} -l "mcp-vault ${account}" -D "mcp-vault master key" -j "AES-256 master key for mcp-vault. Deleting it makes the vault unrecoverable." -w ${key.toString("base64")}\n`;
    spawnSync(SECURITY, ["-i"], { input: cmd, stdio: ["pipe", "ignore", "ignore"] });
    const back = this.get(account);
    if (!back || !back.equals(key)) throw new VaultError("failed to store master key in Keychain");
  }

  delete(account: string): void {
    spawnSync(SECURITY, ["delete-generic-password", "-s", this.service, "-a", account], { stdio: "ignore" });
  }
}

/** In-memory key store for tests only. */
export class MemoryKeyStore implements KeyStore {
  private readonly items = new Map<string, Buffer>();
  get(account: string): Buffer | null {
    const k = this.items.get(account);
    return k ? Buffer.from(k) : null;
  }
  set(account: string, key: Buffer): void {
    this.items.set(account, Buffer.from(key));
  }
  delete(account: string): void {
    this.items.delete(account);
  }
}

export function keychainAvailable(): boolean {
  try {
    execFileSync(SECURITY, ["show-keychain-info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
