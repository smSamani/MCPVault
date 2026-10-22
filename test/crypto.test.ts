import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJson, deriveKey, generateMasterKey, keyId, openBackup, openVault, sealBackup, sealVault } from "../src/crypto.js";
import { generatePassword } from "../src/generator.js";
import { ACCOUNT_CURRENT, ACCOUNT_NEXT } from "../src/keychain.js";
import { tempVault } from "./helpers.js";

test("AES-256-GCM vault round-trip", () => {
  const key = generateMasterKey();
  const pt = Buffer.from(JSON.stringify({ hello: "wörld", n: 42 }));
  const env = sealVault(key, pt);
  assert.equal(env.alg, "AES-256-GCM");
  assert.equal(env.keyId, keyId(key));
  assert.ok(!env.ciphertext.includes("hello"));
  assert.deepEqual(openVault(key, env), pt);
});

test("each seal uses a fresh nonce", () => {
  const key = generateMasterKey();
  const pt = Buffer.from("same plaintext");
  const nonces = new Set(Array.from({ length: 200 }, () => sealVault(key, pt).nonce));
  assert.equal(nonces.size, 200);
});

test("wrong key fails to decrypt", () => {
  const env = sealVault(generateMasterKey(), Buffer.from("secret"));
  assert.throws(() => openVault(generateMasterKey(), env), /decryption failed/);
});

test("tampering with ciphertext, tag, nonce or header is detected", () => {
  const key = generateMasterKey();
  const env = sealVault(key, Buffer.from("a fairly long secret payload"));
  const flip = (b64: string) => {
    const b = Buffer.from(b64, "base64");
    b[0]! ^= 1;
    return b.toString("base64");
  };
  assert.throws(() => openVault(key, { ...env, ciphertext: flip(env.ciphertext) }));
  assert.throws(() => openVault(key, { ...env, tag: flip(env.tag) }));
  assert.throws(() => openVault(key, { ...env, nonce: flip(env.nonce) }));
  // Header fields are bound as AAD.
  assert.throws(() => openVault(key, { ...env, keyId: "0000000000000000" }));
});

test("HKDF subkeys are distinct per purpose", () => {
  const m = generateMasterKey();
  assert.notDeepEqual(deriveKey(m, "vault-enc"), deriveKey(m, "clients-mac"));
  assert.notDeepEqual(deriveKey(m, "vault-enc"), m);
});

test("passphrase backup round-trip and wrong passphrase", () => {
  const params = { N: 1 << 12, r: 8, p: 1 }; // fast params for tests
  const env = sealBackup("correct horse battery staple", Buffer.from("payload"), params);
  assert.equal(openBackup("correct horse battery staple", env).toString(), "payload");
  assert.throws(() => openBackup("wrong passphrase!!", env));
});

test("canonicalJson is key-order independent", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("vault file never contains plaintext passwords or site names", () => {
  const { vault, cleanup } = tempVault();
  try {
    const pw = generatePassword({ length: 32 }).password;
    vault.addEntry({ site: "example-unique-site.com", username: "alice@example.com", password: pw, notes: "security answer: blue" });
    const raw = readFileSync(vault.vaultPath, "utf8");
    for (const needle of [pw, "example-unique-site", "alice@example.com", "security answer"]) assert.ok(!raw.includes(needle));
    assert.equal(vault.load().entries[0]!.password, pw);
  } finally {
    cleanup();
  }
});

test("on-disk vault tampering is rejected", () => {
  const { vault, cleanup } = tempVault();
  try {
    vault.addEntry({ site: "a.com", username: "u", password: "p".repeat(12) });
    const env = JSON.parse(readFileSync(vault.vaultPath, "utf8"));
    const ct = Buffer.from(env.ciphertext, "base64");
    ct[5]! ^= 0xff;
    env.ciphertext = ct.toString("base64");
    writeFileSync(vault.vaultPath, JSON.stringify(env));
    assert.throws(() => vault.load(), /could not decrypt/);
  } finally {
    cleanup();
  }
});

test("master key rotation re-encrypts and keeps data", () => {
  const { vault, keys, cleanup } = tempVault();
  try {
    vault.addEntry({ site: "a.com", username: "u", password: "hunter2hunter2" });
    const before = keys.get(ACCOUNT_CURRENT)!;
    const r = vault.rotateMasterKey();
    const after = keys.get(ACCOUNT_CURRENT)!;
    assert.notDeepEqual(before, after);
    assert.notEqual(r.oldKeyId, r.newKeyId);
    assert.equal(keys.get(ACCOUNT_NEXT), null);
    assert.equal(vault.load().entries[0]!.password, "hunter2hunter2");
    assert.ok(vault.loadClients());
    // The old key can no longer open the vault.
    assert.throws(() => openVault(before, JSON.parse(readFileSync(vault.vaultPath, "utf8"))));
  } finally {
    cleanup();
  }
});

test("interrupted rotation (pending key) is recovered", () => {
  const { vault, keys, cleanup } = tempVault();
  try {
    vault.addEntry({ site: "a.com", username: "u", password: "hunter2hunter2" });
    vault.rotateMasterKey();
    // Simulate crash between re-encrypt and promotion: current = stale key, next = real key.
    const real = keys.get(ACCOUNT_CURRENT)!;
    keys.set(ACCOUNT_NEXT, real);
    keys.set(ACCOUNT_CURRENT, generateMasterKey());
    assert.equal(vault.load().entries.length, 1);
    assert.deepEqual(keys.get(ACCOUNT_CURRENT), real);
    assert.equal(keys.get(ACCOUNT_NEXT), null);
  } finally {
    cleanup();
  }
});

test("password generator: length, classes, charset, bounds", () => {
  const g = generatePassword();
  assert.equal(g.password.length, 24);
  assert.match(g.password, /[a-z]/);
  assert.match(g.password, /[A-Z]/);
  assert.match(g.password, /[0-9]/);
  assert.match(g.password, /[^A-Za-z0-9]/);
  assert.ok(g.entropyBits >= 140);
  assert.match(generatePassword({ length: 40, symbols: false }).password, /^[A-Za-z0-9]{40}$/);
  assert.match(generatePassword({ length: 30, symbolSet: "-_" }).password, /^[A-Za-z0-9_-]{30}$/);
  assert.doesNotMatch(generatePassword({ length: 200, excludeAmbiguous: true }).password, /[Il1O0o]/);
  assert.throws(() => generatePassword({ length: 4 }));
  assert.throws(() => generatePassword({ length: 1000 }));
  assert.throws(() => generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }));
  const many = new Set(Array.from({ length: 500 }, () => generatePassword().password));
  assert.equal(many.size, 500);
});
