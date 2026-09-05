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

test("a decrypt failure that is not ENOENT degrades to null and keeps the file for the next successful save", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  await writeFile(path, "corrupted", { mode: 0o600 });
  const store = new TokenStore(path, {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async (value) => Buffer.from(`cipher:${value}`),
    decrypt: async () => { throw Object.assign(new Error("cipher mismatch"), { code: "ERR_OSSL_BAD_DECRYPT" }); }
  });
  try {
    assert.equal(await store.load(), null);
    // 密文与当前密钥不匹配和「钥匙环没解锁」在 safeStorage 层分不开：一律不删，等下次 save() 覆盖
    assert.equal((await readFile(path)).toString(), "corrupted");
    assert.equal(await store.save("fresh"), true, "下一次成功授权直接覆盖坏文件");
    assert.equal(await new TokenStore(path, store.crypto).load(), null, "本桩的 decrypt 仍然失败，但文件已是新密文");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a decrypt failure while safe storage has become unavailable keeps the stored token", async () => {
  // Linux 钥匙环未解锁：decrypt 抛错——「现在读不到」不是「坏了」，不能删掉唯一的 refresh token。
  const directory = await mkdtemp(join(tmpdir(), "polyask-token-"));
  const path = join(directory, "oauth-token.bin");
  await writeFile(path, "locked", { mode: 0o600 });
  const store = new TokenStore(path, {
    backend: () => "gnome_libsecret",
    available: async () => true, // 生产接线里 available() 是启动时探测一次的常量：即使钥匙环锁着也返回 true，不能拿它当判据
    encrypt: async () => { throw new Error("must_not_encrypt"); },
    decrypt: async () => { throw new Error("keyring locked"); }
  });
  try {
    assert.equal(await store.load(), null);
    assert.equal((await readFile(path)).toString(), "locked", "令牌文件必须原样保留");
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
