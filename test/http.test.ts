import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { addClient } from "../src/access.js";
import { BIND_HOST, serveHttp } from "../src/http.js";
import { tempVault } from "./helpers.js";

/** fetch() cannot override Host, so use node:http for host-header cases. */
function rawPost(port: number, host: string, token: string, body: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { host, "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("HTTP transport: loopback bind, bearer auth, host/origin checks, profile enforcement", async () => {
  const { vault, cleanup } = tempVault();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = await serveHttp(vault, { port, allowedHosts: ["vault.example.test"] });
  try {
    assert.equal((server.address() as AddressInfo).address, BIND_HOST);
    const remote = addClient(vault, { name: "aryan", permissions: ["read"], transports: ["http"] });
    const local = addClient(vault, { name: "local", permissions: ["read", "write", "reveal"], transports: ["stdio"] });
    const url = `http://127.0.0.1:${port}/mcp`;
    const rpc = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

    assert.equal((await rpc(init)).status, 401, "no token");
    assert.equal((await rpc(init, { authorization: "Bearer nope-nope-nope-nope-nope" })).status, 401, "bad token");
    assert.equal((await rpc(init, { authorization: `Bearer ${local}` })).status, 401, "stdio-only token over http");
    assert.equal((await rpc(init, { authorization: `Bearer ${remote}`, origin: "https://evil.example" })).status, 403, "browser origin");
    assert.equal((await rawPost(port, "evil.example", remote, init)).status, 403, "dns rebinding host");

    const ok = await rpc(init, { authorization: `Bearer ${remote}` });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as any;
    assert.equal(body.result.protocolVersion, "2025-06-18");
    assert.equal(body.result.serverInfo.name, "mcp-vault");

    const tunneled = await rawPost(port, "vault.example.test", remote, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal(tunneled.status, 200, "allowed tunnel hostname");
    const names = tunneled.json.result.tools.map((t: any) => t.name).sort();
    assert.deepEqual(names, ["generate_password", "list_entries"], "read-only profile sees only read tools");

    const denied = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_entry", arguments: { site: "a.com", username: "u" } } }, { authorization: `Bearer ${remote}` })).json()) as any;
    assert.equal(denied.result.isError, true);

    const notif = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { authorization: `Bearer ${remote}` });
    assert.equal(notif.status, 202);

    const get = await fetch(url, { headers: { authorization: `Bearer ${remote}` } });
    assert.equal(get.status, 405);

    const big = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${remote}` }, body: "x".repeat(70 * 1024) });
    assert.equal(big.status, 413);
  } finally {
    await new Promise((r) => server.close(r));
    cleanup();
  }
});

test("HTTP transport throttles repeated auth failures", async () => {
  const { vault, cleanup } = tempVault();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = await serveHttp(vault, { port, allowedHosts: [] });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong-token-wrong-token" }, body: "{}" });
      statuses.push(r.status);
    }
    assert.equal(statuses[0], 401);
    assert.equal(statuses.at(-1), 429);
  } finally {
    await new Promise((r) => server.close(r));
    cleanup();
  }
});

test("HTTP lockout is per source: an attacker is locked out, other clients are not; every access is audited", async () => {
  const { vault, cleanup } = tempVault();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = await serveHttp(vault, { port, allowedHosts: ["vault.example.test"], trustProxyHeader: true });
  try {
    const token = addClient(vault, { name: "siamak", permissions: ["read", "write", "reveal"], transports: ["http"] });
    const url = `http://127.0.0.1:${port}/mcp`;
    const post = (ip: string, auth: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-connecting-ip": ip, authorization: auth }, body: JSON.stringify(body) });

    // The attacker (203.0.113.9) guesses tokens until locked out.
    const attacker: number[] = [];
    for (let i = 0; i < 12; i++) attacker.push((await post("203.0.113.9", "Bearer guess-guess-guess-guess-guess")).status);
    assert.equal(attacker[0], 401);
    assert.equal(attacker.at(-1), 429);
    const retry = await post("203.0.113.9", `Bearer ${token}`);
    assert.equal(retry.status, 429, "a locked source is refused even with a valid token");
    assert.ok(Number(retry.headers.get("retry-after")) > 0);

    // A legitimate client from another address is unaffected.
    const ok = await post("198.51.100.7", `Bearer ${token}`);
    assert.equal(ok.status, 200);
    assert.ok(((await ok.json()) as any).result.tools.length >= 3);
    // A spoofed/invalid header value falls back to the socket address (not the attacker's bucket).
    assert.equal((await post("not-an-ip", `Bearer ${token}`)).status, 200);

    // Unauthenticated health probe works on loopback only and reveals nothing.
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const audit = readFileSync(vault.auditPath, "utf8");
    assert.match(audit, /"action":"auth","ok":false,"detail":"invalid bearer token src=203\.0\.113\.9/);
    assert.match(audit, /source locked out/);
    assert.match(audit, /"client":"siamak","transport":"http","action":"request","ok":true,"detail":"tools\/list src=198\.51\.100\.7"/);
    assert.ok(!audit.includes(token), "tokens never reach the audit log");
    assert.ok(!audit.includes("guess-guess"), "submitted bad tokens never reach the audit log");
  } finally {
    await new Promise((r) => server.close(r));
    cleanup();
  }
});

test("HTTP: without trustProxyHeader the CF header is ignored; rejected requests are audited", async () => {
  const { vault, cleanup } = tempVault();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = await serveHttp(vault, { port, allowedHosts: [] });
  try {
    const token = addClient(vault, { name: "aryan", permissions: ["read"], transports: ["http"] });
    const url = `http://127.0.0.1:${port}/mcp`;
    const headers = (ip: string) => ({ "content-type": "application/json", "cf-connecting-ip": ip, authorization: "Bearer wrong-wrong-wrong-wrong-wrong" });
    for (let i = 0; i < 10; i++) await fetch(url, { method: "POST", headers: headers(`198.51.100.${i}`), body: "{}" });
    // All ten came from one socket address, so the CF header cannot be used to dodge the lockout.
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" });
    assert.equal(r.status, 429);

    const wrongPath = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.equal(wrongPath.status, 404);
    assert.match(readFileSync(vault.auditPath, "utf8"), /"action":"access","ok":false,"detail":"404 path \/admin src=/);
  } finally {
    await new Promise((r) => server.close(r));
    cleanup();
  }
});
