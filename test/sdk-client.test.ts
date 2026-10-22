import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { addClient } from "../src/access.js";
import { ACCOUNT_CURRENT } from "../src/keychain.js";
import { tempVault } from "./helpers.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "memory-server.js");

type TextResult = { content: { type: string; text: string }[]; isError?: boolean };

async function connect(home: string, keyHex: string, token: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE],
    env: { MCP_VAULT_TEST_HOME: home, MCP_VAULT_TEST_KEY: keyHex, MCP_VAULT_TOKEN: token, PATH: "/usr/bin:/bin" },
    stderr: "ignore",
  });
  const client = new Client({ name: "sdk-integration-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const text = (r: unknown) => (r as TextResult).content[0]!.text;

test("SDK client over stdio: list tools, call tools, permissions enforced", async () => {
  const { vault, keys, cleanup } = tempVault();
  const keyHex = keys.get(ACCOUNT_CURRENT)!.toString("hex");
  const fullToken = addClient(vault, { name: "full", permissions: ["read", "write", "reveal", "delete"], transports: ["stdio"], clipboard: false });
  const readToken = addClient(vault, { name: "reader", permissions: ["read"], transports: ["stdio"] });
  const full = await connect(vault.home, keyHex, fullToken);
  const reader = await connect(vault.home, keyHex, readToken);
  try {
    assert.equal(full.getServerVersion()?.name, "mcp-vault");
    const tools = (await full.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["create_entry", "delete_entry", "generate_password", "get_login_for_site", "list_entries", "reveal_password", "update_entry"]);
    const create = (await full.listTools()).tools.find((t) => t.name === "create_entry")!;
    assert.deepEqual([...(create.inputSchema.required ?? [])].sort(), ["site", "username"]);

    const gen = JSON.parse(text(await full.callTool({ name: "generate_password", arguments: { length: 40 } })));
    assert.equal(gen.password.length, 40);

    const created = JSON.parse(text(await full.callTool({ name: "create_entry", arguments: { site: "sdk.example", username: "bot" } })));
    assert.equal(created.password.length, 24);

    const listed = await reader.callTool({ name: "list_entries", arguments: {} });
    assert.ok(!text(listed).includes(created.password));
    assert.equal(JSON.parse(text(listed)).count, 1);

    const revealed = JSON.parse(text(await full.callTool({ name: "reveal_password", arguments: { id: created.entry.id } })));
    assert.equal(revealed.password, created.password);

    // Reader: only read tools are registered; reveal is unknown to it.
    assert.deepEqual((await reader.listTools()).tools.map((t) => t.name).sort(), ["generate_password", "list_entries"]);
    const denied = (await reader.callTool({ name: "reveal_password", arguments: { id: created.entry.id } })) as TextResult;
    assert.equal(denied.isError, true);
    assert.ok(!text(denied).includes(created.password));

    // SDK-level schema validation rejects bad input without echoing it.
    const bad = (await full.callTool({ name: "generate_password", arguments: { length: "SuperSecretValue" } })) as TextResult;
    assert.equal(bad.isError, true);
    assert.ok(!text(bad).includes("SuperSecretValue"));

    const del = JSON.parse(text(await full.callTool({ name: "delete_entry", arguments: { id: created.entry.id, confirm: true } })));
    assert.equal(del.deleted, true);
    assert.equal(vault.load().entries.length, 0);
  } finally {
    await full.close();
    await reader.close();
    cleanup();
  }
});

test("SDK client over stdio: invalid token is rejected before any MCP traffic", async () => {
  const { vault, keys, cleanup } = tempVault();
  try {
    await assert.rejects(connect(vault.home, keys.get(ACCOUNT_CURRENT)!.toString("hex"), "mcpv_not-a-real-token-not-a-real-token-xx"));
  } finally {
    cleanup();
  }
});
