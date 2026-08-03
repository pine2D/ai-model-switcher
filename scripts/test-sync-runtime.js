#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const history = new Map(), archives = new Map(), outbox = new Map(), meta = new Map();
const SyncStore = {
  getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value),
  putHistory: async (value) => history.set(value.id, value), getHistory: async (id) => history.get(id),
  putArchive: async (value) => archives.set(value.id, value), getArchive: async (id) => archives.get(id),
  enqueue: async (value) => outbox.set(value.key, value), trimBodies: async () => {},
};
const chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
const context = vm.createContext({ SyncStore, SyncModel: { SCHEMA: 1, hashText: async () => "hash", utf8Preview: (text) => text },
  chrome, crypto: { randomUUID: () => "uuid" }, Date });

function deviceRuntime(fail = false) {
  const values = new Map(); let writes = 0, ids = 0;
  const store = {
    getMeta: async (key) => values.get(key),
    putMeta: async (key, value) => { writes++; if (fail) throw new Error("put failed"); values.set(key, value); },
  };
  const scope = vm.createContext({ SyncStore: store, SyncModel: { SCHEMA: 1, utf8Preview: (text) => text }, chrome,
    crypto: { randomUUID: () => `uuid-${++ids}` }, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/data.js"), "utf8") + ";this.data=Data", scope);
  return { data: scope.data, retry: () => { fail = false; }, writes: () => writes, ids: () => ids };
}

async function main() {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/data.js"), "utf8") + ";this.data=Data", context);
  await context.data.addHistory("question");
  await context.data.addHistory("question");
  assert.equal(history.size, 1);
  assert.equal(outbox.size, 1, "同设备同文本上传必须折叠");

  await context.data.addArchive({ text: "q", results: [] });
  assert.equal(archives.size, 1);
  await context.data.deleteArchive("uuid");
  assert.ok(archives.get("uuid").deletedAt, "删除必须写 tombstone");

  const failed = deviceRuntime(true);
  const failedCalls = await Promise.allSettled([failed.data.deviceId(), failed.data.deviceId()]);
  assert.ok(failedCalls.every((call) => call.status === "rejected"), "首次持久化失败不能返回幽灵 ID");
  assert.equal(failed.writes(), 1, "并发失败也只能尝试一次持久化");
  failed.retry();
  assert.equal(await failed.data.deviceId(), "uuid-2", "失败后必须重新生成并持久化 ID");
  assert.equal(failed.writes(), 2, "失败后调用必须再次持久化");

  const concurrent = deviceRuntime();
  const [first, second] = await Promise.all([concurrent.data.deviceId(), concurrent.data.deviceId()]);
  assert.equal(first, second, "并发首次调用必须得到同一 ID");
  assert.equal(concurrent.ids(), 1, "并发首次调用只能生成一个 ID");
  assert.equal(concurrent.writes(), 1, "并发首次调用只能写入一次 ID");
  console.log("sync-runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
