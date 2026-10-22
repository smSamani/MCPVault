import { z } from "zod";
import { VaultError } from "./errors.js";
import { AccessDenied, canSeeHost, requirePermission, type Principal } from "./access.js";
import type { AuditLog } from "./audit.js";
import { copyToClipboard } from "./clipboard.js";
import { DEFAULT_LENGTH, DEFAULT_SYMBOLS, generatePassword, MAX_LENGTH, MIN_LENGTH, type GenerateOptions } from "./generator.js";
import { hostMatches, normalizeHost } from "./sites.js";
import { toMeta, type Config, type Entry, type Permission, type Vault } from "./vault.js";

// ---------------------------------------------------------------------------
// Input schemas (zod). The same strict object schemas are given to the MCP SDK
// (which validates and advertises them as JSON Schema) and used by callTool,
// so the CLI and tests go through identical validation.
// ---------------------------------------------------------------------------

export class ToolInputError extends Error {}

type ObjectSchema = z.ZodObject<z.ZodRawShape>;

/** Validation messages name the field and rule, never the submitted value. */
function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
    .join("; ");
}

export function validateArgs(schema: ObjectSchema, args: unknown): Record<string, unknown> {
  const r = schema.safeParse(args ?? {});
  if (!r.success) throw new ToolInputError(formatIssues(r.error));
  return r.data as Record<string, unknown>;
}

const genShape = {
  length: z.number().int().min(MIN_LENGTH).max(MAX_LENGTH).optional().describe(`Password length (default ${DEFAULT_LENGTH}).`),
  lowercase: z.boolean().optional().describe("Include a-z (default true)."),
  uppercase: z.boolean().optional().describe("Include A-Z (default true)."),
  digits: z.boolean().optional().describe("Include 0-9 (default true)."),
  symbols: z.boolean().optional().describe("Include symbols (default true)."),
  exclude_ambiguous: z.boolean().optional().describe("Exclude look-alike characters such as I l 1 O 0 (default false)."),
  symbol_set: z.string().min(1).max(64).optional().describe(`Custom symbol alphabet (default "${DEFAULT_SYMBOLS}").`),
};

const deliverField = z
  .enum(["return", "clipboard"])
  .optional()
  .describe(
    'How to hand over the secret. "return" (default) includes it in this tool result for the calling client only. ' +
      '"clipboard" copies it to the macOS clipboard (auto-cleared after 30 s) and does NOT include it in the result (local stdio clients only).',
  );

const siteField = z.string().min(1).max(256).describe("Site or service, e.g. 'github.com' or a full URL.");
const usernameField = z.string().min(1).max(256).describe("Account username or email.");
const urlField = z.string().max(2048).optional().describe("Optional login/signup URL.");
const notesField = z.string().max(4096).optional().describe("Optional notes (encrypted; only returned by reveal_password).");
const idField = z.string().min(1).max(64).describe("Entry id from list_entries.");

function genOptions(a: Record<string, unknown>): GenerateOptions {
  return {
    length: a.length as number | undefined,
    lowercase: a.lowercase as boolean | undefined,
    uppercase: a.uppercase as boolean | undefined,
    digits: a.digits as boolean | undefined,
    symbols: a.symbols as boolean | undefined,
    excludeAmbiguous: a.exclude_ambiguous as boolean | undefined,
    symbolSet: a.symbol_set as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolContext {
  vault: Vault;
  audit: AuditLog;
  principal: Principal;
  config: Config;
}

interface ToolDef {
  name: string;
  description: string;
  /** Permission needed to see and call the tool (null = any authenticated client). */
  permission: Permission | null;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
  inputSchema: ObjectSchema;
  handler: (ctx: ToolContext, args: Record<string, unknown>, audit: Audit) => Record<string, unknown>;
}

type Audit = { entryId?: string; site?: string };

/** Hand a secret to the caller per `deliver`; returns the result fields. */
function deliverSecret(ctx: ToolContext, secret: string, deliver: unknown): Record<string, unknown> {
  if (deliver === "clipboard") {
    if (!ctx.principal.clipboard) throw new AccessDenied("clipboard delivery is not available for this client/transport");
    copyToClipboard(secret, ctx.config.clipboardClearSeconds);
    return { delivered: "clipboard", clipboard_clears_in_seconds: ctx.config.clipboardClearSeconds };
  }
  return { delivered: "return", password: secret };
}

function visibleEntries(ctx: ToolContext, entries: Entry[]): Entry[] {
  return entries.filter((e) => canSeeHost(ctx.principal, e.host));
}

function findVisible(ctx: ToolContext, id: string): Entry {
  const e = visibleEntries(ctx, ctx.vault.load().entries).find((x) => x.id === id);
  if (!e) throw new ToolInputError("no entry with that id");
  return e;
}

function publicMeta(e: Entry): Record<string, unknown> {
  const { notes, ...m } = toMeta(e);
  return { ...m, has_notes: Boolean(notes) };
}

const ann = (title: string, readOnly: boolean, destructive = false, idempotent = readOnly) => ({
  title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false as const,
});

export const TOOLS: ToolDef[] = [
  {
    name: "generate_password",
    description: "Generate a strong random password with the OS CSPRNG. Does not store anything.",
    permission: null,
    annotations: ann("Generate password", true, false, false),
    inputSchema: z.object({ ...genShape }).strict(),
    handler: (_ctx, a) => {
      const g = generatePassword(genOptions(a));
      return { password: g.password, length: g.length, entropy_bits: g.entropyBits };
    },
  },
  {
    name: "list_entries",
    description: "List or search stored entries (site, username, url, timestamps). Never returns passwords or notes.",
    permission: "read",
    annotations: ann("List entries", true),
    inputSchema: z
      .object({
        query: z.string().max(256).optional().describe("Optional case-insensitive filter on site, host, username or url."),
        limit: z.number().int().min(1).max(1000).optional().describe("Max results (default 100)."),
      })
      .strict(),
    handler: (ctx, a, au) => {
      const q = typeof a.query === "string" ? a.query.trim().toLowerCase() : "";
      const all = visibleEntries(ctx, ctx.vault.load().entries)
        .filter((e) => !q || [e.site, e.host, e.username, e.url ?? ""].some((f) => f.toLowerCase().includes(q)))
        .sort((x, y) => x.host.localeCompare(y.host) || x.username.localeCompare(y.username));
      const limit = (a.limit as number | undefined) ?? 100;
      return { count: all.length, entries: all.slice(0, limit).map(publicMeta) };
    },
  },
  {
    name: "create_entry",
    description:
      "Create and store a credential for a site/account. If `password` is omitted a strong one is generated. " +
      "The new password is returned only to the calling client (or copied to the clipboard) so it can be filled into a signup form.",
    permission: "write",
    annotations: ann("Create entry", false),
    inputSchema: z
      .object({
        site: siteField,
        username: usernameField,
        url: urlField,
        notes: notesField,
        password: z.string().min(1).max(1024).optional().describe("Use this password instead of generating one."),
        ...genShape,
        deliver: deliverField,
        allow_duplicate: z.boolean().optional().describe("Allow a second entry for the same site+username (default false)."),
      })
      .strict(),
    handler: (ctx, a, au) => {
      const site = a.site as string;
      const host = normalizeHost((a.url as string | undefined) || site);
      if (!canSeeHost(ctx.principal, host)) throw new AccessDenied("this client is not allowed to manage that site");
      const username = a.username as string;
      if (!a.allow_duplicate) {
        const dup = ctx.vault.load().entries.find((e) => e.host === host && e.username === username);
        if (dup) throw new ToolInputError(`an entry for ${host} / that username already exists (id ${dup.id}); use update_entry or allow_duplicate`);
      }
      const password = (a.password as string | undefined) ?? generatePassword(genOptions(a)).password;
      const entry = ctx.vault.addEntry({ site, username, password, url: (a.url as string | undefined) || undefined, notes: a.notes as string | undefined });
      au.entryId = entry.id;
      au.site = entry.host;
      return { entry: publicMeta(entry), generated: a.password === undefined, ...deliverSecret(ctx, password, a.deliver) };
    },
  },
  {
    name: "get_login_for_site",
    description:
      "Fill helper: return the username and password stored for a site (subdomains match their parent domain). " +
      "If several accounts exist and no username is given, returns the candidate usernames without passwords.",
    permission: "reveal",
    annotations: ann("Get login for site", true),
    inputSchema: z
      .object({ site: siteField, username: z.string().max(256).optional().describe("Pick a specific account."), deliver: deliverField })
      .strict(),
    handler: (ctx, a, au) => {
      const host = normalizeHost(a.site as string);
      let matches = visibleEntries(ctx, ctx.vault.load().entries).filter((e) => hostMatches(e.host, host));
      if (typeof a.username === "string") matches = matches.filter((e) => e.username === a.username);
      au.site = host;
      if (matches.length === 0) throw new ToolInputError("no stored login for that site");
      if (matches.length > 1) {
        return { ambiguous: true, candidates: matches.map((e) => ({ id: e.id, site: e.site, username: e.username })) };
      }
      const e = matches[0]!;
      au.entryId = e.id;
      return { id: e.id, site: e.site, url: e.url, username: e.username, ...deliverSecret(ctx, e.password, a.deliver) };
    },
  },
  {
    name: "reveal_password",
    description: "Explicitly reveal the password (and notes) of one entry by id. Every reveal is audit-logged.",
    permission: "reveal",
    annotations: ann("Reveal password", true),
    inputSchema: z.object({ id: idField, deliver: deliverField }).strict(),
    handler: (ctx, a, au) => {
      const e = findVisible(ctx, a.id as string);
      au.entryId = e.id;
      au.site = e.host;
      return { id: e.id, site: e.site, username: e.username, notes: e.notes ?? null, ...deliverSecret(ctx, e.password, a.deliver) };
    },
  },
  {
    name: "update_entry",
    description: "Update an entry's site, username, url, notes, or password. Set regenerate=true to rotate to a new generated password.",
    permission: "write",
    annotations: ann("Update entry", false, true, false),
    inputSchema: z
      .object({
        id: idField,
        site: siteField.optional(),
        username: usernameField.optional(),
        url: urlField,
        notes: notesField,
        password: z.string().min(1).max(1024).optional().describe("New password."),
        regenerate: z.boolean().optional().describe("Generate a new password (uses the generator options)."),
        ...genShape,
        deliver: deliverField,
      })
      .strict(),
    handler: (ctx, a, au) => {
      if (a.password !== undefined && a.regenerate) throw new ToolInputError("give either password or regenerate, not both");
      const id = a.id as string;
      const newPassword = a.regenerate ? generatePassword(genOptions(a)).password : (a.password as string | undefined);
      const updated = ctx.vault.mutate((d) => {
        const e = d.entries.find((x) => x.id === id && canSeeHost(ctx.principal, x.host));
        if (!e) throw new ToolInputError("no entry with that id");
        const now = new Date().toISOString();
        if (a.site !== undefined) e.site = (a.site as string).trim();
        if (a.url !== undefined) e.url = (a.url as string) || undefined;
        if (a.site !== undefined || a.url !== undefined) {
          const host = normalizeHost(e.url || e.site);
          if (!canSeeHost(ctx.principal, host)) throw new AccessDenied("this client is not allowed to manage that site");
          e.host = host;
        }
        if (a.username !== undefined) e.username = a.username as string;
        if (a.notes !== undefined) e.notes = (a.notes as string) || undefined;
        if (newPassword !== undefined) {
          e.password = newPassword;
          e.passwordUpdatedAt = now;
        }
        e.updatedAt = now;
        return { ...e };
      });
      au.entryId = updated.id;
      au.site = updated.host;
      return {
        entry: publicMeta(updated),
        password_changed: newPassword !== undefined,
        ...(a.regenerate ? deliverSecret(ctx, newPassword!, a.deliver) : {}),
      };
    },
  },
  {
    name: "delete_entry",
    description: "Permanently delete an entry. Requires confirm=true.",
    permission: "delete",
    annotations: ann("Delete entry", false, true, true),
    inputSchema: z.object({ id: idField, confirm: z.boolean().describe("Must be true.") }).strict(),
    handler: (ctx, a, au) => {
      if (a.confirm !== true) throw new ToolInputError("set confirm=true to delete");
      const id = a.id as string;
      const removed = ctx.vault.mutate((d) => {
        const i = d.entries.findIndex((x) => x.id === id && canSeeHost(ctx.principal, x.host));
        if (i < 0) throw new ToolInputError("no entry with that id");
        return d.entries.splice(i, 1)[0]!;
      });
      au.entryId = removed.id;
      au.site = removed.host;
      return { deleted: true, id: removed.id, site: removed.site, username: removed.username };
    },
  },
];

/** Tools visible to a principal: tools it lacks permission for are hidden entirely. */
export function toolsFor(principal: Principal): ToolDef[] {
  return TOOLS.filter((t) => t.permission === null || principal.permissions.has(t.permission));
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Validate, authorise, execute and audit one tool call. Error messages are
 * fixed strings or validator output; they never echo secret arguments.
 */
export function callTool(ctx: ToolContext, name: string, rawArgs: unknown): ToolCallResult {
  const tool = TOOLS.find((t) => t.name === name);
  const audit = (ok: boolean, a: Audit, detail?: string) =>
    ctx.audit.record({ client: ctx.principal.name, transport: ctx.principal.transport, action: tool ? name : "unknown_tool", ok, ...a, ...(detail ? { detail } : {}) });
  const au: Audit = {};
  try {
    if (!tool) throw new ToolInputError("unknown tool");
    if (tool.permission) requirePermission(ctx.principal, tool.permission);
    const a = validateArgs(tool.inputSchema, rawArgs);
    const result = tool.handler(ctx, a, au);
    audit(true, au, a.deliver === "clipboard" ? "delivered via clipboard" : undefined);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const known = err instanceof ToolInputError || err instanceof AccessDenied || err instanceof VaultError;
    const msg = known ? (err as Error).message : "internal error";
    // Unknown errors: log only the class/code, never the message (could carry data).
    if (!known) process.stderr.write(`mcp-vault: tool ${name} failed: ${(err as Error)?.name ?? "Error"} ${(err as NodeJS.ErrnoException)?.code ?? ""}\n`);
    audit(false, au, err instanceof AccessDenied ? `denied: ${msg}` : msg);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
}
