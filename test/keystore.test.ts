import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addClient, authenticate } from "../src/access.js";
import { ACCOUNT_CURRENT, ACCOUNT_NEXT, MacKeychain } from "../src/keychain.js";
import { CREDENTIAL_NAME, DEFAULT_KEY_FILE, FileKeyStore, selectKeyStore } from "../src/keystore.js";
import { Vault } from "../src/vault.js";

function tmp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mcp-vault-keystore-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("FileKeyStore creates a 0400 key once and reads it back", () => {
  const { dir, cleanup } = tmp();
  try {
    const path = join(dir, "etc", "master.key");
    const ks = new FileKeyStore(path);
    assert.equal(ks.get(ACCOUNT_CURRENT), null);
    const key = randomBytes(32);
    ks.set(ACCOUNT_CURRENT, key);
    assert.equal(statSync(path).mode & 0o777, 0o400);
    assert.equal(statSync(join(dir, "etc")).mode & 0o777, 0o700);
    assert.deepEqual(ks.get(ACCOUNT_CURRENT), key);
    assert.deepEqual(new FileKeyStore(path).get(ACCOUNT_CURRENT), key, "fresh instance reads the same key");
    ks.set(ACCOUNT_CURRENT, key); // idempotent for the same key
    assert.equal(ks.get(ACCOUNT_NEXT), null);
  } finally {
    cleanup();
  }
});

test("FileKeyStore never overwrites, never rotates, never deletes", () => {
  const { dir, cleanup } = tmp();
  try {
    const path = join(dir, "master.key");
    const ks = new FileKeyStore(path);
    const key = randomBytes(32);
    ks.set(ACCOUNT_CURRENT, key);
    assert.throws(() => ks.set(ACCOUNT_CURRENT, randomBytes(32)), /refusing to overwrite/);
    assert.throws(() => ks.set(ACCOUNT_NEXT, randomBytes(32)), /rotation is not supported/);
    assert.throws(() => ks.set(ACCOUNT_CURRENT, randomBytes(16)), /32 bytes/);
    ks.delete(ACCOUNT_CURRENT);
    assert.deepEqual(ks.get(ACCOUNT_CURRENT), key, "delete is a no-op");
  } finally {
    cleanup();
  }
});

test("FileKeyStore rejects group/other-accessible, malformed and non-regular key files", () => {
  const { dir, cleanup } = tmp();
  try {
    const path = join(dir, "master.key");
    writeFileSync(path, randomBytes(32).toString("base64") + "\n", { mode: 0o644 });
    chmodSync(path, 0o644);
    assert.throws(() => new FileKeyStore(path).get(ACCOUNT_CURRENT), /must not be accessible by group\/others/);
    chmodSync(path, 0o400);
    assert.ok(new FileKeyStore(path).get(ACCOUNT_CURRENT));

    const bad = join(dir, "bad.key");
    writeFileSync(bad, "not-a-key\n", { mode: 0o400 });
    assert.throws(() => new FileKeyStore(bad).get(ACCOUNT_CURRENT), /valid base64 32-byte key/);

    const sub = join(dir, "isdir");
    mkdirSync(sub, { mode: 0o700 });
    assert.throws(() => new FileKeyStore(sub).get(ACCOUNT_CURRENT), /not a regular file|EISDIR/);
  } finally {
    cleanup();
  }
});

test("a Vault works end to end on a FileKeyStore, and the key never lands in vault files", () => {
  const { dir, cleanup } = tmp();
  try {
    const keyPath = join(dir, "master.key");
    const ks = new FileKeyStore(keyPath);
    const vault = new Vault(join(dir, "data"), ks);
    assert.equal(vault.init().createdKey, true);
    const token = addClient(vault, { name: "remote", permissions: ["read", "write", "reveal"], transports: ["http"] });
    vault.addEntry({ site: "example.com", username: "me", password: "Sup3r-Secret-Value" });

    // A second process (new instance) opens the same vault with the same key file.
    const again = new Vault(join(dir, "data"), new FileKeyStore(keyPath));
    assert.equal(again.isInitialized(), true);
    assert.equal(again.init().createdKey, false);
    assert.equal(again.load().entries[0]!.password, "Sup3r-Secret-Value");
    assert.equal(authenticate(again.loadClients(), token, "http")?.name, "remote");
    assert.throws(() => again.rotateMasterKey(), /rotation is not supported/);
    assert.equal(again.load().entries.length, 1, "failed rotation changed nothing");

    const keyB64 = readFileSync(keyPath, "utf8").trim();
    for (const f of ["vault.enc", "clients.json", "config.json"]) assert.ok(!readFileSync(join(dir, "data", f), "utf8").includes(keyB64));

    // Losing the key file must not let init mint a new key over an existing vault.
    rmSync(keyPath);
    assert.throws(() => new Vault(join(dir, "data"), new FileKeyStore(keyPath)).init(), /refusing to overwrite/);
  } finally {
    cleanup();
  }
});

test("selectKeyStore: credential > MCP_VAULT_KEY_FILE > Keychain on macOS > default file elsewhere", () => {
  const { dir, cleanup } = tmp();
  try {
    writeFileSync(join(dir, CREDENTIAL_NAME), randomBytes(32).toString("base64"), { mode: 0o400 });
    const cred = selectKeyStore({ CREDENTIALS_DIRECTORY: dir, MCP_VAULT_KEY_FILE: "/ignored" }, "linux");
    assert.ok(cred.store instanceof FileKeyStore);
    assert.equal((cred.store as FileKeyStore).path, join(dir, CREDENTIAL_NAME));
    assert.match(cred.description, /systemd credential/);

    const file = selectKeyStore({ MCP_VAULT_KEY_FILE: "/x/k" }, "darwin");
    assert.equal((file.store as FileKeyStore).path, "/x/k");

    assert.ok(selectKeyStore({}, "darwin").store instanceof MacKeychain, "macOS default unchanged");
    assert.equal((selectKeyStore({}, "linux").store as FileKeyStore).path, DEFAULT_KEY_FILE);
    assert.ok(selectKeyStore({ MCP_VAULT_KEY_BACKEND: "keychain" }, "linux").store instanceof MacKeychain);
    assert.equal((selectKeyStore({ MCP_VAULT_KEY_BACKEND: "file" }, "darwin").store as FileKeyStore).path, DEFAULT_KEY_FILE);

    assert.throws(() => selectKeyStore({ MCP_VAULT_KEY_BACKEND: "credential" }, "linux"), /CREDENTIALS_DIRECTORY/);
    assert.throws(() => selectKeyStore({ MCP_VAULT_KEY_BACKEND: "bogus" }, "linux"), /must be keychain, file or credential/);
  } finally {
    cleanup();
  }
});
