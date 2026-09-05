import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { safeEncryptionAvailability, TokenStore } from "../src/main/token-store";

test("refresh tokens are persisted only through asynchronous safe storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  const calls: string[] = [];
  const store = new TokenStore(path, {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async (value) => { calls.push(`encrypt:${value}`); return Buffer.from(`cipher:${value}`); },
    decrypt: async (value) => { calls.push(`decrypt:${value.toString()}`); return value.toString().slice(7); }
  });
  try {
    assert.equal(await store.save("refresh-secret"), true);
    assert.equal((await readFile(path)).toString(), "cipher:refresh-secret");
    assert.equal(await new TokenStore(path, store.crypto).load(), "refresh-secret");
    assert.deepEqual(calls, ["encrypt:refresh-secret", "decrypt:cipher:refresh-secret"]);
    await store.clear();
    assert.equal(await store.load(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linux basic_text keeps the refresh token in memory for this session only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  const store = new TokenStore(path, {
    backend: () => "basic_text",
    available: async () => true,
    encrypt: async () => { throw new Error("must_not_encrypt"); },
    decrypt: async () => { throw new Error("must_not_decrypt"); }
  });
  try {
    assert.equal(await store.save("session-only"), false);
    assert.equal(await store.load(), "session-only");
    assert.equal(await new TokenStore(path, store.crypto).load(), null);
    assert.equal(store.securePersistence(), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a decrypt failure that is not ENOENT degrades to null and clears the corrupted file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  await writeFile(path, "corrupted", { mode: 0o600 });
  const store = new TokenStore(path, {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async () => { throw new Error("must_not_encrypt"); },
    decrypt: async () => { throw Object.assign(new Error("cipher mismatch"), { code: "ERR_OSSL_BAD_DECRYPT" }); }
  });
  try {
    assert.equal(await store.load(), null);
    await assert.rejects(
      () => readFile(path),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a decrypt failure while safe storage has become unavailable keeps the stored token", async () => {
  // Linux 钥匙环未解锁：decrypt 抛错、available() 复查为 false ——「现在读不到」不是「坏了」，不能删掉唯一的 refresh token。
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  await writeFile(path, "locked", { mode: 0o600 });
  let availability = 0;
  const store = new TokenStore(path, {
    backend: () => "gnome_libsecret",
    available: async () => { availability += 1; return availability === 1; },
    encrypt: async () => { throw new Error("must_not_encrypt"); },
    decrypt: async () => { throw new Error("keyring locked"); }
  });
  try {
    assert.equal(await store.load(), null);
    assert.equal((await readFile(path)).toString(), "locked", "令牌文件必须原样保留");
    assert.equal(availability, 2, "catch 分支必须复查一次 available()");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unknown safe storage backend is not treated as secure persistence", async () => {
  const store = new TokenStore("/unused/token", {
    backend: () => "unknown",
    available: async () => true,
    encrypt: async () => Buffer.from("unused"),
    decrypt: async () => "unused"
  });
  assert.equal(store.securePersistence(), false);
});

test("optional safe storage initialization failures degrade instead of blocking app startup", async () => {
  assert.equal(await safeEncryptionAvailability(async () => { throw new Error("keyring unavailable"); }), false);
  assert.equal(await safeEncryptionAvailability(async () => true), true);
});
