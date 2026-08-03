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
  console.log("sync-runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
