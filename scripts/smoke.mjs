#!/usr/bin/env node
// End-to-end smoke test against the REAL installed vault, using the official
// MCP SDK Client over stdio exactly like any MCP client does. Uses a temporary "smoke-test" client
// profile and a dummy entry on a reserved domain; both are removed at the end.
// Secrets are compared in-process and NEVER printed.
//
//   node scripts/smoke.mjs [--clipboard]
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "dist", "src", "cli.js");
const CLIENT = "smoke-test";
const SITE = "smoke-test.mcp-vault.invalid";

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const check = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
};

cli("client", "remove", CLIENT);
const added = cli("client", "add", CLIENT, "--perms", "read,write,reveal,delete", "--transport", "stdio", "--no-clipboard");
if (added.status !== 0) throw new Error("could not create smoke-test client");
const token = added.stdout.trim();

const client = new Client({ name: "mcp-vault-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "serve"], env: { ...getDefaultEnvironment(), MCP_VAULT_TOKEN: token }, stderr: "inherit" }));
const tool = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: Boolean(r.isError), text, json: r.isError ? null : JSON.parse(text) };
};

let entryId;
try {
  console.log("mcp-vault smoke test (stdio, real vault)");
  const info = client.getServerVersion();
  check(info?.name === "mcp-vault", `initialize (SDK client) -> ${info.name} ${info.version}`);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check(tools.length === 7, `tools/list -> ${tools.join(", ")}`);

  const gen = await tool("generate_password", { length: 32 });
  check(!gen.isError && gen.json.password.length === 32, `generate_password -> 32 chars, ${gen.json.entropy_bits} bits (value not shown)`);

  const created = await tool("create_entry", { site: SITE, username: "dummy@example.invalid", notes: "smoke test dummy" });
  check(!created.isError && created.json.password.length === 24, `create_entry -> id ${created.json.entry.id}, generated 24-char password (not shown)`);
  entryId = created.json.entry.id;
  const createdPw = created.json.password;

  const listed = await tool("list_entries", { query: "smoke-test" });
  check(listed.json.count === 1 && !listed.text.includes(createdPw) && !("password" in listed.json.entries[0]), "list_entries -> 1 match, no password field, secret absent from output");

  const fill = await tool("get_login_for_site", { site: `https://login.${SITE}/` });
  check(fill.json.username === "dummy@example.invalid" && fill.json.password === createdPw, "get_login_for_site (subdomain URL) -> correct username, password matches");

  const revealed = await tool("reveal_password", { id: entryId });
  check(revealed.json.password === createdPw && revealed.json.notes === "smoke test dummy", "reveal_password -> password matches, notes returned");

  const clip = await tool("reveal_password", { id: entryId, deliver: "clipboard" });
  check(clip.isError && /clipboard/.test(clip.text), "clipboard refused for profile created with --no-clipboard");

  const del = await tool("delete_entry", { id: entryId, confirm: true });
  check(del.json.deleted === true, "delete_entry -> deleted");
  entryId = undefined;

  const after = await tool("list_entries", { query: "smoke-test" });
  check(after.json.count === 0, "list_entries -> dummy entry gone");

  if (process.argv.includes("--clipboard")) {
    const { copyToClipboard } = await import(join(ROOT, "dist", "src", "clipboard.js"));
    const types = spawnSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", "ObjC.import('AppKit'); ObjC.deepUnwrap($.NSPasteboard.generalPasteboard.types).join(',')"], { encoding: "utf8" }).stdout.trim();
    const saved = types.split(",").every((t) => /text|string|utf8|nspasteboard/i.test(t) || t === "") ? spawnSync("/usr/bin/pbpaste", { encoding: "utf8" }).stdout : null;
    const dummy = "dummy-clipboard-value-" + Date.now();
    copyToClipboard(dummy, 5);
    const nowTypes = spawnSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", "ObjC.import('AppKit'); ObjC.deepUnwrap($.NSPasteboard.generalPasteboard.types).join(',')"], { encoding: "utf8" }).stdout;
    check(spawnSync("/usr/bin/pbpaste", { encoding: "utf8" }).stdout === dummy, "clipboard copy works (dummy value)");
    check(nowTypes.includes("org.nspasteboard.ConcealedType"), "clipboard marked concealed for clipboard managers");
    await new Promise((r) => setTimeout(r, 7000));
    check(spawnSync("/usr/bin/pbpaste", { encoding: "utf8" }).stdout === "", "clipboard auto-cleared after timeout");
    if (saved) spawnSync("/usr/bin/pbcopy", { input: saved });
  }
  console.log("SMOKE TEST PASSED");
} finally {
  if (entryId) await tool("delete_entry", { id: entryId, confirm: true });
  await client.close();
  cli("client", "remove", CLIENT);
}
