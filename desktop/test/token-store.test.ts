import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TokenStore } from "../src/main/token-store";

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

test("an unknown safe storage backend is not treated as secure persistence", async () => {
  const store = new TokenStore("/unused/token", {
    backend: () => "unknown",
    available: async () => true,
    encrypt: async () => Buffer.from("unused"),
    decrypt: async () => "unused"
  });
  assert.equal(store.securePersistence(), false);
});
