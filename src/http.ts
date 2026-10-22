import { isIP } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authenticate } from "./access.js";
import { AuditLog } from "./audit.js";
import { AuthLockout } from "./ratelimit.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import type { Vault } from "./vault.js";

/**
 * Optional Streamable HTTP transport (official SDK StreamableHTTPServerTransport,
 * stateless, JSON responses) for a remote assistant reached through a tunnel.
 * All checks below run BEFORE a request reaches the SDK transport:
 *   - binds to 127.0.0.1 only (not configurable);
 *   - disabled unless config.http.enabled is true;
 *   - every request needs `Authorization: Bearer <client token>` for a
 *     profile that allows the "http" transport;
 *   - Host allowlist + Origin rejection (DNS-rebinding / browser CSRF);
 *   - body size cap, timeouts, per-source auth-failure lockout (escalating);
 *   - every access (accepted or rejected) is written to the audit log with
 *     the client name, source address and JSON-RPC method (never secrets);
 *   - clipboard delivery is never available over HTTP.
 */

export const BIND_HOST = "127.0.0.1";
const MAX_BODY = 64 * 1024;

export interface HttpOptions {
  port: number;
  allowedHosts: string[];
  /**
   * Take the client address from Cloudflare's CF-Connecting-IP header (the
   * socket peer is always the local tunnel daemon). Only meaningful, and only
   * enabled by the CLI, when the server is reached through a tunnel.
   */
  trustProxyHeader?: boolean;
}

/** Audit-safe label for the JSON-RPC call(s) in a request body. */
function describeRpc(parsed: unknown): string {
  const one = (m: unknown): string => {
    if (!m || typeof m !== "object") return "invalid";
    const { method, params } = m as { method?: unknown; params?: { name?: unknown } };
    if (typeof method !== "string") return "response";
    const tool = method === "tools/call" && typeof params?.name === "string" ? `:${params.name}` : "";
    return (method + tool).replace(/[^A-Za-z0-9_/.:-]/g, "?").slice(0, 64);
  };
  return Array.isArray(parsed) ? `batch(${parsed.slice(0, 5).map(one).join(",")})` : one(parsed);
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the cap we keep draining (so the client still receives the 413)
    // but stop buffering; requestTimeout bounds how long that can take.
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function createHttpServer(vault: Vault, opts: HttpOptions): Server {
  const audit = new AuditLog(vault.auditPath);
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, ...opts.allowedHosts.map((h) => h.toLowerCase())]);
  const lockout = new AuthLockout();
  const sourceOf = (req: IncomingMessage): string => {
    const cf = req.headers["cf-connecting-ip"];
    if (opts.trustProxyHeader && typeof cf === "string" && isIP(cf.trim())) return cf.trim().toLowerCase();
    return req.socket.remoteAddress ?? "unknown";
  };

  const server = createServer(async (req, res) => {
    const host = (req.headers.host ?? "").toLowerCase();
    const source = sourceOf(req);
    const deny = (client: string, status: number, detail: string, body: unknown, extra: Record<string, string> = {}) => {
      audit.record({ client, transport: "http", action: "access", ok: false, detail: `${status} ${detail} src=${source}` });
      return send(res, status, body, extra);
    };
    if (!allowedHosts.has(host)) return deny("unknown", 403, "forbidden host", { error: "forbidden host" });
    if (req.headers.origin !== undefined) return deny("unknown", 403, "browser origin", { error: "browser origins are not allowed" });
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz" && req.method === "GET" && !req.headers["cf-connecting-ip"]) return send(res, 200, { ok: true });
    if (path !== "/mcp") return deny("unknown", 404, `path ${(path ?? "").slice(0, 40).replace(/[^\x21-\x7e]/g, "?")}`, { error: "not found" });

    const locked = lockout.lockedFor(source);
    if (locked > 0) return send(res, 429, { error: "too many failed attempts" }, { "Retry-After": String(locked) });

    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    let principal = null;
    try {
      principal = authenticate(vault.loadClients(), token, "http");
    } catch {
      return send(res, 500, { error: "server error" });
    }
    if (!principal) {
      const justLocked = lockout.fail(source);
      audit.record({ client: "unknown", transport: "http", action: "auth", ok: false, detail: `invalid bearer token src=${source}${justLocked ? " (source locked out)" : ""}` });
      return send(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="mcp-vault"' });
    }

    if (req.method !== "POST") return deny(principal.name, 405, "method not allowed", { error: "method not allowed" }, { Allow: "POST" });
    if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return deny(principal.name, 415, "bad content-type", { error: "content-type must be application/json" });
    const tooLarge = () => deny(principal.name, 413, "request too large", { error: "request too large" }, { Connection: "close" });
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return tooLarge();
    const body = await readBody(req);
    if (body === null) return tooLarge();

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return deny(principal.name, 400, "parse error", { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    audit.record({ client: principal.name, transport: "http", action: "request", ok: true, detail: `${describeRpc(parsed)} src=${source}` });

    // Authenticated: hand off to the SDK. Stateless mode: a fresh server +
    // transport per request, scoped to this principal, JSON responses only.
    const mcp = createMcpServer({ vault, audit, principal });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch {
      if (!res.headersSent) send(res, 500, { error: "server error" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}

export function serveHttp(vault: Vault, opts: HttpOptions): Promise<Server> {
  const server = createHttpServer(vault, opts);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, BIND_HOST, () => resolve(server));
  });
}
