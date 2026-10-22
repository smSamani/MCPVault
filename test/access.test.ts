import { strict as assert } from "node:assert";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { addClient, authenticate, removeClient, rotateClientToken } from "../src/access.js";
import { toolsFor } from "../src/tools.js";
import { call, principalFor, tempVault } from "./helpers.js";

test("tokens authenticate only their own profile and transport", () => {
  const { vault, cleanup } = tempVault();
  try {
    const t1 = addClient(vault, { name: "local", permissions: ["read"], transports: ["stdio"] });
    const t2 = addClient(vault, { name: "aryan", permissions: ["read", "reveal"], transports: ["http"] });
    const reg = vault.loadClients();
    assert.equal(authenticate(reg, t1, "stdio")?.name, "local");
    assert.equal(authenticate(reg, t2, "http")?.name, "aryan");
    assert.equal(authenticate(reg, t1, "http"), null, "stdio-only token rejected over http");
    assert.equal(authenticate(reg, t2, "stdio"), null, "http-only token rejected over stdio");
    assert.equal(authenticate(reg, undefined, "stdio"), null);
    assert.equal(authenticate(reg, "mcpv_" + "x".repeat(43), "stdio"), null);
    assert.equal(authenticate(reg, t1.slice(0, -1) + (t1.endsWith("A") ? "B" : "A"), "stdio"), null);
  } finally {
    cleanup();
  }
});

test("clients.json stores only token hashes and is tamper-evident", () => {
  const { vault, cleanup } = tempVault();
  try {
    const token = addClient(vault, { name: "c", permissions: ["read"], transports: ["stdio"] });
    const raw = readFileSync(vault.clientsPath, "utf8");
    assert.ok(!raw.includes(token));
    // Privilege escalation by editing the file must be detected.
    const j = JSON.parse(raw);
    j.clients.c.permissions = ["read", "write", "reveal"];
    writeFileSync(vault.clientsPath, JSON.stringify(j));
    assert.throws(() => vault.loadClients(), /integrity/);
  } finally {
    cleanup();
  }
});

test("rotate-token invalidates the old token; remove revokes access", () => {
  const { vault, cleanup } = tempVault();
  try {
    const old = addClient(vault, { name: "c", permissions: ["read"], transports: ["stdio"] });
    const fresh = rotateClientToken(vault, "c");
    assert.equal(authenticate(vault.loadClients(), old, "stdio"), null);
    assert.equal(authenticate(vault.loadClients(), fresh, "stdio")?.name, "c");
    assert.ok(removeClient(vault, "c"));
    assert.equal(authenticate(vault.loadClients(), fresh, "stdio"), null);
  } finally {
    cleanup();
  }
});

test("permissions gate tools: hidden from tools/list and refused on call", () => {
  const { vault, cleanup } = tempVault();
  try {
    const owner = principalFor(vault, "owner", ["read", "write", "reveal"]);
    const reader = principalFor(vault, "reader", ["read"]);
    const writer = principalFor(vault, "writer", ["write"]);
    const created = call(vault, owner, "create_entry", { site: "github.com", username: "me" });
    assert.equal(created.isError, false);
    const id = created.json!.entry.id;

    assert.deepEqual(toolsFor(reader).map((t) => t.name).sort(), ["generate_password", "list_entries"]);
    assert.ok(!toolsFor(writer).some((t) => t.name === "reveal_password" || t.name === "list_entries"));

    for (const [tool, args] of [
      ["reveal_password", { id }],
      ["get_login_for_site", { site: "github.com" }],
      ["create_entry", { site: "x.com", username: "u" }],
      ["delete_entry", { id, confirm: true }],
    ] as const) {
      const r = call(vault, reader, tool, args);
      assert.equal(r.isError, true, `${tool} must be refused for reader`);
      assert.match(r.text, /lacks the "(reveal|write|delete)" permission/);
    }
    assert.equal(call(vault, writer, "list_entries", {}).isError, true);
    assert.equal(call(vault, writer, "reveal_password", { id }).isError, true);
    assert.equal(call(vault, reader, "list_entries", {}).isError, false);
    assert.equal(vault.load().entries.length, 1, "nothing was deleted");
  } finally {
    cleanup();
  }
});

test("list/search never returns passwords or notes; reveal does", () => {
  const { vault, cleanup } = tempVault();
  try {
    const p = principalFor(vault, "p", ["read", "write", "reveal"]);
    const c = call(vault, p, "create_entry", { site: "https://www.Example.com/signup", username: "bob", notes: "pin 1234", length: 30 });
    const pw = c.json!.password as string;
    assert.equal(pw.length, 30);
    assert.equal(c.json!.entry.host, "example.com");
    const l = call(vault, p, "list_entries", { query: "example" });
    assert.equal(l.json!.count, 1);
    assert.ok(!l.text.includes(pw));
    assert.ok(!l.text.includes("pin 1234"));
    assert.equal(l.json!.entries[0].has_notes, true);
    const r = call(vault, p, "reveal_password", { id: c.json!.entry.id });
    assert.equal(r.json!.password, pw);
    assert.equal(r.json!.notes, "pin 1234");
  } finally {
    cleanup();
  }
});

test("site scoping: a profile only sees and manages its allowed sites", () => {
  const { vault, cleanup } = tempVault();
  try {
    const owner = principalFor(vault, "owner", ["read", "write", "reveal"]);
    const scoped = principalFor(vault, "scoped", ["read", "write", "reveal", "delete"], { sites: ["github.com"] });
    const bank = call(vault, owner, "create_entry", { site: "mybank.com", username: "me" }).json!.entry.id;
    call(vault, owner, "create_entry", { site: "github.com", username: "me" });
    const l = call(vault, scoped, "list_entries", {});
    assert.equal(l.json!.count, 1);
    assert.equal(l.json!.entries[0].host, "github.com");
    assert.equal(call(vault, scoped, "reveal_password", { id: bank }).isError, true);
    assert.equal(call(vault, scoped, "delete_entry", { id: bank, confirm: true }).isError, true);
    assert.equal(call(vault, scoped, "update_entry", { id: bank, notes: "x" }).isError, true);
    assert.equal(call(vault, scoped, "get_login_for_site", { site: "mybank.com" }).isError, true);
    assert.equal(call(vault, scoped, "create_entry", { site: "evil.com", username: "x" }).isError, true);
    assert.equal(call(vault, scoped, "get_login_for_site", { site: "gist.github.com" }).isError, false, "subdomain of allowed site");
    assert.equal(call(vault, scoped, "list_entries", {}).json!.count, 1);
  } finally {
    cleanup();
  }
});

test("get_login_for_site: subdomain match, dot-boundary, ambiguity without leaking", () => {
  const { vault, cleanup } = tempVault();
  try {
    const p = principalFor(vault, "p", ["read", "write", "reveal"]);
    call(vault, p, "create_entry", { site: "google.com", username: "a@x.com" });
    call(vault, p, "create_entry", { site: "google.com", username: "b@x.com" });
    const amb = call(vault, p, "get_login_for_site", { site: "https://accounts.google.com/signin" });
    assert.equal(amb.json!.ambiguous, true);
    assert.ok(!("password" in amb.json!));
    assert.ok(!amb.text.includes("password"));
    const one = call(vault, p, "get_login_for_site", { site: "accounts.google.com", username: "b@x.com" });
    assert.equal(one.json!.username, "b@x.com");
    assert.equal(typeof one.json!.password, "string");
    assert.equal(call(vault, p, "get_login_for_site", { site: "evilgoogle.com" }).isError, true);
  } finally {
    cleanup();
  }
});

test("clipboard delivery is refused for clients without clipboard / over http", () => {
  const { vault, cleanup } = tempVault();
  try {
    const http = principalFor(vault, "remote", ["read", "write", "reveal"], { transports: ["http"] });
    assert.equal(http.clipboard, false);
    const r = call(vault, http, "create_entry", { site: "a.com", username: "u", deliver: "clipboard" });
    assert.equal(r.isError, true);
    assert.match(r.text, /clipboard delivery is not available/);
  } finally {
    cleanup();
  }
});

test("input validation rejects unknown args and bad types; delete needs confirm", () => {
  const { vault, cleanup } = tempVault();
  try {
    const p = principalFor(vault, "p", ["read", "write", "reveal", "delete"]);
    assert.match(call(vault, p, "generate_password", { length: "24" }).text, /length: Invalid input: expected number/);
    assert.match(call(vault, p, "generate_password", { evil: true }).text, /Unrecognized key/);
    assert.match(call(vault, p, "generate_password", { length: 4 }).text, /length: Too small: expected number to be >=8/);
    // Validation errors must not echo submitted values (they could be secrets).
    const leak = call(vault, p, "create_entry", { site: "a.com", username: "u", deliver: "SuperSecretValue123!" });
    assert.equal(leak.isError, true);
    assert.ok(!leak.text.includes("SuperSecretValue123"));
    assert.ok(!readFileSync(vault.auditPath, "utf8").includes("SuperSecretValue123"));
    const id = call(vault, p, "create_entry", { site: "a.com", username: "u" }).json!.entry.id;
    assert.equal(call(vault, p, "create_entry", { site: "a.com", username: "u" }).isError, true, "duplicate refused");
    assert.match(call(vault, p, "delete_entry", { id, confirm: false }).text, /confirm=true/);
    assert.equal(call(vault, p, "delete_entry", { id, confirm: true }).json!.deleted, true);
    assert.equal(vault.load().entries.length, 0);
  } finally {
    cleanup();
  }
});

test("audit log records actions but never secrets", () => {
  const { vault, cleanup } = tempVault();
  try {
    const p = principalFor(vault, "auditor", ["read", "write", "reveal"]);
    const reader = principalFor(vault, "reader", ["read"]);
    const c = call(vault, p, "create_entry", { site: "a.com", username: "u", notes: "my secret note" });
    const pw = c.json!.password as string;
    call(vault, p, "reveal_password", { id: c.json!.entry.id });
    call(vault, p, "update_entry", { id: c.json!.entry.id, password: "ExplicitPassw0rd!!" });
    call(vault, reader, "reveal_password", { id: c.json!.entry.id });
    const log = readFileSync(vault.auditPath, "utf8");
    assert.ok(!log.includes(pw));
    assert.ok(!log.includes("ExplicitPassw0rd"));
    assert.ok(!log.includes("my secret note"));
    const lines = log.trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.action === "reveal_password" && l.ok && l.client === "auditor"));
    assert.ok(lines.some((l) => l.action === "reveal_password" && !l.ok && l.client === "reader" && /denied/.test(l.detail)));
  } finally {
    cleanup();
  }
});

test("data files and dir are 600/700", () => {
  const { vault, cleanup } = tempVault();
  try {
    const p = principalFor(vault, "p", ["read", "write"]);
    call(vault, p, "create_entry", { site: "a.com", username: "u" });
    assert.equal(statSync(vault.home).mode & 0o777, 0o700);
    for (const f of [vault.vaultPath, vault.clientsPath, vault.configPath, vault.auditPath]) assert.equal(statSync(f).mode & 0o777, 0o600, f);
  } finally {
    cleanup();
  }
});

test("delete is a separate permission: write alone cannot delete (new profiles); legacy write profiles keep delete", () => {
  const { vault, cleanup } = tempVault();
  try {
    const owner = principalFor(vault, "owner", ["read", "write", "reveal", "delete"]);
    const remote = principalFor(vault, "remote", ["read", "write", "reveal"], { transports: ["http"] });
    const id = call(vault, owner, "create_entry", { site: "a.com", username: "u" }).json!.entry.id;
    assert.ok(!toolsFor(remote).some((t) => t.name === "delete_entry"), "delete_entry hidden without delete");
    const denied = call(vault, remote, "delete_entry", { id, confirm: true });
    assert.equal(denied.isError, true);
    assert.match(denied.text, /lacks the "delete" permission/);
    assert.equal(vault.load().entries.length, 1);

    // A profile written before the "delete" permission existed (no schema marker).
    const token = addClient(vault, { name: "legacy", permissions: ["read", "write"], transports: ["stdio"] });
    vault.mutateClients((reg) => {
      delete reg.clients.legacy!.schema;
    });
    const legacy = authenticate(vault.loadClients(), token, "stdio")!;
    assert.ok(legacy.permissions.has("delete"), "legacy write implies delete");
    assert.equal(call(vault, legacy, "delete_entry", { id, confirm: true }).json!.deleted, true);
    const rotated = rotateClientToken(vault, "legacy");
    assert.equal(authenticate(vault.loadClients(), rotated, "stdio")!.permissions.has("delete"), true, "rotation keeps legacy semantics");
  } finally {
    cleanup();
  }
});
