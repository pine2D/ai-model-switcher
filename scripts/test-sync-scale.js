#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

function driveRuntime(handler) {
  const requests = [];
  const chrome = { identity: { getAuthToken: async () => ({ token: "token" }) } };
  const scope = vm.createContext({ chrome, fetch: async (url, init) => { requests.push({ url, init }); return handler(url, init); },
    Response, URLSearchParams, crypto: { randomUUID: () => "id" }, Date });
  vm.runInContext(fs.readFileSync("bg/drive.js", "utf8") + ";this.drive=Drive", scope);
  return { drive: scope.drive, requests };
}

function archiveStore(rows) {
  const cursor = () => {
    let index = 0, req;
    const advance = () => {
      const value = rows[index++];
      req.result = value && { value, continue: () => queueMicrotask(advance) };
      req.onsuccess?.();
    };
    req = {}; queueMicrotask(advance); return req;
  };
  const db = { transaction: () => ({ objectStore: () => ({ index: () => ({ openCursor: cursor }) }) }) };
  const indexedDB = { open: () => { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } };
  const scope = vm.createContext({ indexedDB, IDBKeyRange: { upperBound: () => {} }, queueMicrotask });
  vm.runInContext(fs.readFileSync("bg/store.js", "utf8") + ";this.store=SyncStore", scope);
  return scope.store;
}

async function assertSyncStreams(total) {
  const meta = new Map(), local = new Map(); let imported = 0, maxBatch = 0, accumulatedCalls = 0, trims = 0;
  const store = {
    getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value),
    countOutbox: async () => 0, readyOutbox: async () => [], putFile: async () => {}, findFile: async () => null, getFile: async () => null, markFile: async () => {},
    iterate: async () => {}, trimBodies: async () => { trims++; },
  };
  const data = {
    deviceId: async () => "local", deviceState: async () => ({ schema: 1, deviceId: "local", settings: {}, templates: {}, groups: {} }),
    seedState: async () => {}, applyRemoteState: async () => {}, importRecords: async (rows) => {
      const size = (rows.history || []).length + (rows.archives || []).length; maxBatch = Math.max(maxBatch, size); imported += size;
    },
  };
  const drive = {
    connect: async () => {}, getStartToken: async () => "start", listFiles: async () => { accumulatedCalls++; throw new Error("accumulated files"); },
    listChanges: async () => { accumulatedCalls++; throw new Error("accumulated changes"); },
    visitFiles: async (visit) => { for (let i = 0; i < total; i++) await visit({ id: String(i), appProperties: { app: "polyask", schema: "1", kind: "history", id: String(i), device: "d" } }); },
    visitChanges: async () => ({ newStartPageToken: "next" }),
    download: async (id) => ({ schema: 1, id, textHash: id, text: id, createdAt: 1, lastUsedAt: 1, deviceId: "d" }),
  };
  const storage = { addListener: () => {} }, chrome = { storage: { local: {
    get: async (defaults) => Object.fromEntries(Object.keys(defaults || {}).map((key) => [key, local.has(key) ? local.get(key) : defaults[key]])),
    set: async (values) => { for (const [key, value] of Object.entries(values)) local.set(key, value); },
  }, onChanged: storage }, runtime: { onMessage: storage, onStartup: storage }, alarms: { create: () => {}, onAlarm: storage } };
  const SyncModel = { SCHEMA: 1, validTime: (value) => Number.isSafeInteger(value) && value >= 0, hashText: async (text) => text,
    mergeStateFragments: () => ({ settings: {}, templates: [], groups: [], materialized: { schema: 1, settings: {}, templates: {}, groups: {} }, corrupt: 0 }) };
  const scope = vm.createContext({ SyncStore: store, Data: data, Drive: drive, SyncModel, chrome, Date, Math, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync("bg/sync.js", "utf8") + ";this.sync=SyncEngine", scope);
  await scope.sync.connect();
  assert.equal(accumulatedCalls, 0, "生产同步不得调用积累版 listFiles/listChanges");
  assert.equal(imported, total); assert.equal(maxBatch, 1, "远端正文必须逐条落 IDB"); assert.ok(trims >= 1);
}

async function main() {
  const total = 10_000, pageSize = 1000;
  const files = driveRuntime((url) => {
    const token = new URL(url).searchParams.get("pageToken"), page = token ? Number(token) : 0;
    const start = page * pageSize, count = Math.min(pageSize, total - start);
    return new Response(JSON.stringify({ files: Array.from({ length: count }, (_, i) => ({ id: String(start + i) })),
      ...(start + count < total ? { nextPageToken: String(page + 1) } : {}) }), { status: 200 });
  });
  let visited = 0, active = 0, maxActive = 0;
  await files.drive.visitFiles(async () => { active++; maxActive = Math.max(maxActive, active); visited++; active--; });
  assert.equal(visited, total, "万条文件必须逐页消费完");
  assert.equal(maxActive, 1, "visitor 必须逐条背压，不能并发积累正文");
  assert.equal(files.requests.length, total / pageSize);
  assert.ok(files.requests.every((request) => new URL(request.url).searchParams.get("pageSize") === String(pageSize)));

  const changes = driveRuntime((url) => {
    const token = new URL(url).searchParams.get("pageToken"), page = token === "start" ? 0 : Number(token);
    const start = page * pageSize, count = Math.min(pageSize, total - start);
    return new Response(JSON.stringify({ changes: Array.from({ length: count }, (_, i) => ({ fileId: String(start + i) })),
      ...(start + count < total ? { nextPageToken: String(page + 1) } : { newStartPageToken: "done" }) }), { status: 200 });
  });
  let changed = 0;
  const result = await changes.drive.visitChanges("start", async () => { changed++; });
  assert.equal(changed, total); assert.equal(result.newStartPageToken, "done");

  await assertSyncStreams(total);

  const source = fs.readFileSync("bg/store.js", "utf8");
  assert.ok(!source.includes(".getAll("), "IDB iterate/trim 不得把 store 或 outbox 全集读入内存");
  assert.match(source, /logicalKey[^\n]+unique:\s*false/, "logicalKey 索引必须允许重复 fileId");
  const store = archiveStore([{ id: "new", createdAt: 3, favorite: true }, { id: "gone", createdAt: 2, deletedAt: 0 }, { id: "old", createdAt: 1 }]);
  assert.deepEqual(Array.from((await store.searchArchives(null, 50, (row) => row.favorite)).items, (row) => row.id), ["new"]);
  assert.deepEqual(Array.from((await store.pageArchives(null, 50)).items, (row) => row.id), ["new", "old"]);
  const history = archiveStore([{ id: "new", lastUsedAt: 3 }, { id: "gone", lastUsedAt: 2, deletedAt: 2 }, { id: "old", lastUsedAt: 1 }]);
  assert.deepEqual(Array.from((await history.pageHistory(null, 50)).items, (row) => row.id), ["new", "old"], "普通历史分页不得显示 tombstone");
  const verify = fs.readFileSync("scripts/verify.sh", "utf8");
  for (const file of ["test-sync-integrity.js", "test-sync-scale.js", "test-sync-feedback.js"])
    assert.ok(verify.includes(file), `verify.sh 必须执行 ${file}`);
  console.log("sync-scale tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
