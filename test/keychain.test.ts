import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MacKeychain } from "../src/keychain.js";

// Touches the real login Keychain (throwaway service name, deleted afterwards).
// Opt-in: MCP_VAULT_KEYCHAIN_TEST=1 npm test
test("MacKeychain set/get/update/delete round-trip", { skip: process.env.MCP_VAULT_KEYCHAIN_TEST !== "1" }, () => {
  const kc = new MacKeychain(`mcp-vault-test-${randomBytes(4).toString("hex")}`);
  try {
    assert.equal(kc.get("k"), null);
    const a = randomBytes(32);
    kc.set("k", a);
    assert.deepEqual(kc.get("k"), a);
    const b = randomBytes(32);
    kc.set("k", b); // -U updates in place
    assert.deepEqual(kc.get("k"), b);
  } finally {
    kc.delete("k");
  }
  assert.equal(kc.get("k"), null);
});
