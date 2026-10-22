// Test-only entrypoint: runs the real stdio MCP server (serveStdio + SDK
// transport) against a temp vault whose master key is held in memory, so the
// integration test never touches the real Keychain. Not used in production.
import { ACCOUNT_CURRENT, MemoryKeyStore } from "../../src/keychain.js";
import { serveStdio } from "../../src/stdio.js";
import { Vault } from "../../src/vault.js";

const keys = new MemoryKeyStore();
keys.set(ACCOUNT_CURRENT, Buffer.from(process.env.MCP_VAULT_TEST_KEY ?? "", "hex"));
delete process.env.MCP_VAULT_TEST_KEY;
await serveStdio(new Vault(process.env.MCP_VAULT_TEST_HOME ?? "", keys));
