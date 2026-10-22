import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Cryptographic core.
 *
 *  - The 256-bit master key lives only in the macOS Keychain.
 *  - Purpose-specific subkeys are derived with HKDF-SHA256 so the same key
 *    material is never used for two different algorithms.
 *  - Vault payloads are sealed with AES-256-GCM (96-bit random nonce,
 *    128-bit tag); the envelope header is bound as additional authenticated
 *    data so it cannot be swapped or downgraded.
 */

export const MASTER_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = Buffer.from("mcp-vault/hkdf-salt/v1", "utf8");

export type KeyPurpose = "vault-enc" | "clients-mac" | "key-id";

export function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

export function deriveKey(master: Buffer, purpose: KeyPurpose): Buffer {
  if (master.length !== MASTER_KEY_BYTES) throw new Error("master key must be 32 bytes");
  return Buffer.from(hkdfSync("sha256", master, HKDF_SALT, `mcp-vault/${purpose}/v1`, 32));
}

/** Non-secret fingerprint used to tell which key sealed an envelope. */
export function keyId(master: Buffer): string {
  return deriveKey(master, "key-id").subarray(0, 8).toString("hex");
}

export interface Envelope {
  format: string;
  version: 1;
  alg: "AES-256-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  kdf?: { name: "scrypt"; salt: string; N: number; r: number; p: number };
}

function aadFor(env: Pick<Envelope, "format" | "version" | "alg" | "keyId" | "kdf">): Buffer {
  return Buffer.from(canonicalJson({ format: env.format, version: env.version, alg: env.alg, keyId: env.keyId, kdf: env.kdf ?? null }), "utf8");
}

export function sealWithKey(key: Buffer, plaintext: Buffer, header: Pick<Envelope, "format" | "keyId" | "kdf">): Envelope {
  if (key.length !== 32) throw new Error("AES-256-GCM key must be 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  const base = { format: header.format, version: 1 as const, alg: "AES-256-GCM" as const, keyId: header.keyId, ...(header.kdf ? { kdf: header.kdf } : {}) };
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadFor(base));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ...base, nonce: nonce.toString("base64"), ciphertext: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function openWithKey(key: Buffer, env: Envelope): Buffer {
  if (env.version !== 1 || env.alg !== "AES-256-GCM") throw new Error("unsupported envelope");
  const nonce = Buffer.from(env.nonce, "base64");
  const tag = Buffer.from(env.tag, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new Error("malformed envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aadFor(env));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
  } catch {
    throw new Error("decryption failed: wrong key or data was tampered with");
  }
}

/** Seal a vault payload with the HKDF-derived vault key. */
export function sealVault(master: Buffer, plaintext: Buffer): Envelope {
  return sealWithKey(deriveKey(master, "vault-enc"), plaintext, { format: "mcp-vault", keyId: keyId(master) });
}

export function openVault(master: Buffer, env: Envelope): Buffer {
  if (env.format !== "mcp-vault") throw new Error("not an mcp-vault envelope");
  return openWithKey(deriveKey(master, "vault-enc"), env);
}

// ---- passphrase-based backups -------------------------------------------

const SCRYPT = { N: 1 << 17, r: 8, p: 1 };

function scryptKey(passphrase: string, salt: Buffer, p: { N: number; r: number; p: number }): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * 1024 * 1024 });
}

export function sealBackup(passphrase: string, plaintext: Buffer, params = SCRYPT): Envelope {
  const salt = randomBytes(16);
  const key = scryptKey(passphrase, salt, params);
  return sealWithKey(key, plaintext, { format: "mcp-vault-backup", keyId: "passphrase", kdf: { name: "scrypt", salt: salt.toString("base64"), ...params } });
}

export function openBackup(passphrase: string, env: Envelope): Buffer {
  if (env.format !== "mcp-vault-backup" || !env.kdf || env.kdf.name !== "scrypt") throw new Error("not an mcp-vault backup");
  const key = scryptKey(passphrase, Buffer.from(env.kdf.salt, "base64"), env.kdf);
  return openWithKey(key, env);
}

// ---- helpers --------------------------------------------------------------

export function hmacHex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

/** Deterministic JSON (sorted object keys) for MACs and AAD. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}
