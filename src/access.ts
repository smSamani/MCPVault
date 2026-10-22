import { randomBytes } from "node:crypto";
import { constantTimeEqualHex, sha256Hex } from "./crypto.js";
import { siteAllowed } from "./sites.js";
import type { ClientProfile, ClientRegistry, Permission, Transport, Vault } from "./vault.js";

export const PERMISSIONS: readonly Permission[] = ["read", "write", "reveal", "delete"];
export const TRANSPORTS: readonly Transport[] = ["stdio", "http"];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** An authenticated caller. */
export interface Principal {
  name: string;
  /** "cli" = the human owner running mcp-vault commands in a terminal. */
  transport: Transport | "cli";
  permissions: ReadonlySet<Permission>;
  sites: readonly string[];
  clipboard: boolean;
}

export function newClientToken(): string {
  return `mcpv_${randomBytes(32).toString("base64url")}`;
}

/**
 * Resolve a bearer token to a principal. Tokens are 256-bit random values,
 * so an unsalted SHA-256 is a sufficient verifier; only the hash is stored.
 * Every profile is compared (constant time) so timing does not reveal which
 * one matched.
 */
export function authenticate(reg: ClientRegistry, token: string | undefined, transport: Transport): Principal | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  const hash = sha256Hex(token);
  let match: [string, ClientProfile] | null = null;
  for (const [name, profile] of Object.entries(reg.clients)) {
    if (constantTimeEqualHex(profile.tokenHash, hash)) match = [name, profile];
  }
  if (!match) return null;
  const [name, p] = match;
  if (!p.transports.includes(transport)) return null;
  const granted = new Set(p.permissions.filter((x) => PERMISSIONS.includes(x)));
  // Back-compat: profiles created before "delete" existed could delete with "write".
  if (p.schema !== 2 && granted.has("write")) granted.add("delete");
  return {
    name,
    transport,
    permissions: granted,
    sites: p.sites.length ? p.sites : ["*"],
    // The clipboard is local to this Mac: never usable over HTTP.
    clipboard: p.clipboard && transport === "stdio",
  };
}

export class AccessDenied extends Error {}

export function requirePermission(principal: Principal, perm: Permission): void {
  if (!principal.permissions.has(perm)) throw new AccessDenied(`client "${principal.name}" lacks the "${perm}" permission`);
}

export function canSeeHost(principal: Principal, host: string): boolean {
  return siteAllowed(principal.sites, host);
}

export interface AddClientOptions {
  name: string;
  permissions: Permission[];
  transports: Transport[];
  sites?: string[];
  clipboard?: boolean;
  description?: string;
}

/** Create (or replace) a client profile; returns the plaintext token ONCE. */
export function addClient(vault: Vault, opts: AddClientOptions, replace = false): string {
  if (!NAME_RE.test(opts.name)) throw new Error("client name must match [a-z0-9][a-z0-9._-]{0,63}");
  for (const p of opts.permissions) if (!PERMISSIONS.includes(p)) throw new Error(`unknown permission: ${p}`);
  for (const t of opts.transports) if (!TRANSPORTS.includes(t)) throw new Error(`unknown transport: ${t}`);
  if (opts.transports.length === 0) throw new Error("at least one transport is required");
  const token = newClientToken();
  vault.mutateClients((reg) => {
    if (reg.clients[opts.name] && !replace) throw new Error(`client "${opts.name}" already exists (use rotate-token)`);
    reg.clients[opts.name] = {
      tokenHash: sha256Hex(token),
      permissions: [...new Set(opts.permissions)],
      transports: [...new Set(opts.transports)],
      sites: opts.sites?.length ? opts.sites : ["*"],
      clipboard: opts.clipboard ?? true,
      createdAt: new Date().toISOString(),
      schema: 2,
      ...(opts.description ? { description: opts.description } : {}),
    };
  });
  return token;
}

export function rotateClientToken(vault: Vault, name: string): string {
  const token = newClientToken();
  vault.mutateClients((reg) => {
    const c = reg.clients[name];
    if (!c) throw new Error(`no such client: ${name}`);
    c.tokenHash = sha256Hex(token);
  });
  return token;
}

export function removeClient(vault: Vault, name: string): boolean {
  return vault.mutateClients((reg) => {
    if (!reg.clients[name]) return false;
    delete reg.clients[name];
    return true;
  });
}
