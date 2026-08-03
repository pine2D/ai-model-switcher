#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const history = new Map(), archives = new Map(), outbox = new Map(), meta = new Map();
const SyncStore = {
  getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value), deleteMeta: async (key) => meta.delete(key),
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

function driveRuntime(responses, clearFails = false) {
  let tokenCalls = 0, removed = 0, uuids = 0;
  const requests = [];
  const scope = vm.createContext({
    chrome: { identity: {
      getAuthToken: async () => ({ token: `t${++tokenCalls}` }),
      removeCachedAuthToken: async () => { removed++; },
      clearAllCachedAuthTokens: async () => { if (clearFails) throw new Error("clear failed"); },
    } },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (typeof responses === "function") return responses(url, init);
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch");
      return response;
    },
    Response, URLSearchParams, Blob, TextEncoder, crypto: { randomUUID: () => `random-${++uuids}` },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/drive.js"), "utf8") + ";this.drive=Drive", scope);
  return { drive: scope.drive, tokenCalls: () => tokenCalls, removed: () => removed, requests, uuids: () => uuids };
}

async function assertDriveError(response, code, retryAfter) {
  const runtime = driveRuntime([response]);
  await assert.rejects(runtime.drive.download("missing"), (error) =>
    error.code === code && (retryAfter === undefined || error.retryAfter === retryAfter));
}

function syncRuntime({ files = [], changes = [], downloads = {}, failHistory = false, goneOnce = false } = {}) {
  const calls = [], values = new Map(), records = new Map(), queued = new Map(), fileIndex = new Map();
  const local = new Map();
  let localChangeCalls = 0, onChanged, now = 10_000;
  const store = {
    getMeta: async (key) => values.get(key), putMeta: async (key, value) => values.set(key, value), deleteMeta: async (key) => values.delete(key),
    putHistory: async (record) => records.set(`history:${record.id}`, record), getHistory: async (id) => records.get(`history:${id}`),
    putArchive: async (record) => records.set(`archive:${record.id}`, record), getArchive: async (id) => records.get(`archive:${id}`),
    enqueue: async (op) => queued.set(op.key, op), completeOutbox: async (key) => queued.delete(key),
    readyOutbox: async (at) => [...queued.values()].filter((op) => op.nextAt <= at), countOutbox: async () => queued.size,
    putFile: async (file) => fileIndex.set(file.logicalKey, file), findFile: async (key) => fileIndex.get(key),
    deleteFile: async (id) => { for (const [key, file] of fileIndex) if (file.fileId === id) fileIndex.delete(key); },
    trimBodies: async () => {}, iterate: async (kind, visit) => {
      for (const record of records.values()) if ((kind === "history") === record.textHash) await visit(record);
    },
  };
  const data = {
    deviceId: async () => "device", noteStorageChanges: async (change) => { localChangeCalls++; return change.amsTheme ? {} : null; },
    deviceState: async () => ({ schema: 1, deviceId: "device", settings: {}, templates: {}, groups: {} }),
    applyRemoteState: async () => {}, seedState: async () => {}, importRecords: async (items) => {
      for (const item of items.history || []) await store.putHistory(item);
      for (const item of items.archives || []) await store.putArchive(item);
    }, exportRecords: async () => ({ history: [], archives: [] }),
    getHistory: (id) => store.getHistory(id), getArchive: (id) => store.getArchive(id),
  };
  const drive = {
    connect: async () => {}, disconnect: async () => {}, getStartToken: async () => { calls.push("token"); return "start"; },
    listFiles: async () => { calls.push("list"); return files; },
    listChanges: async (token) => { calls.push(`changes:${token}`); if (goneOnce) { goneOnce = false; throw { status: 410 }; } return { changes, newStartPageToken: "next" }; },
    download: async (id) => { if (!(id in downloads)) throw { code: "not_found", status: 404 }; return downloads[id]; },
    upsert: async (_id, _name, props) => {
      calls.push(props.kind || "state");
      if (failHistory && props.kind === "history") throw { code: "server_error", status: 500 };
      return { id: `file-${calls.length}` };
    }, clearAll: async () => {},
  };
  const chrome = {
    storage: { local: { get: async (defaults) => Object.fromEntries(Object.keys(defaults || {}).map((key) => [key, local.has(key) ? local.get(key) : defaults[key]])), set: async (next) => { for (const [key, value] of Object.entries(next)) local.set(key, value); }, remove: async () => {} }, onChanged: { addListener: (fn) => { onChanged = fn; } } },
    runtime: { onMessage: { addListener: () => {} }, onStartup: { addListener: () => {} }, lastError: null },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  };
  const scope = vm.createContext({ SyncStore: store, Data: data, Drive: drive, SyncModel: {
    SCHEMA: 1, utf8Preview: (text) => text, retryDelay: () => 500, mergeStateFragments: () => ({ settings: {}, templates: [], groups: [], corrupt: 0 }),
    mergeHistory: (items) => items, mergeArchives: (items) => items,
  }, chrome, Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/sync.js"), "utf8") + ";this.sync=SyncEngine", scope);
  return { sync: scope.sync, calls, queued, records, values, change: (c) => onChanged(c, "local"), localChangeCalls: () => localChangeCalls, now: (value) => { now = value; } };
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
  history.set("remote", { id: "remote", fileId: "drive-history" });
  context.SyncEngine = { resolveHistory: async () => ({ id: "remote", text: "restored", fileId: "drive-history" }) };
  assert.equal((await context.data.getHistory("remote")).text, "restored", "缺正文的历史记录必须按 fileId 补回正文");

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

  const listed = driveRuntime([
    new Response("unauthorized", { status: 401 }),
    new Response(JSON.stringify({ files: [{ id: "1" }], nextPageToken: "p2" }), { status: 200 }),
    new Response(JSON.stringify({ files: [{ id: "2" }] }), { status: 200 }),
  ]);
  assert.deepEqual(Array.from(await listed.drive.listFiles(), (file) => file.id), ["1", "2"],
    "401 后必须仅刷新一次 token 并穷尽全部分页");
  assert.equal(listed.removed(), 1);
  assert.equal(listed.tokenCalls(), 2);
  assert.match(listed.requests[1].url, /spaces=appDataFolder/);
  assert.match(listed.requests[1].url, /q=trashed%3Dfalse/);

  await assertDriveError(new Response("forbidden", { status: 403 }), "forbidden");
  await assertDriveError(new Response("slow down", { status: 429, headers: { "Retry-After": "17" } }), "rate_limited", 17_000);
  await assertDriveError(new Response("bad gateway", { status: 502 }), "server_error");
  await assertDriveError(new Response("missing", { status: 404 }), "not_found");

  const uploaded = driveRuntime([
    new Response(JSON.stringify({ id: "new" }), { status: 200 }),
    new Response(JSON.stringify({ id: "newer" }), { status: 200 }),
  ]);
  assert.equal((await uploaded.drive.upsert(null, "state.json", { app: "polyask" }, { schema: 1 })).id, "new");
  assert.equal((await uploaded.drive.upsert(null, "state-2.json", { app: "polyask" }, { schema: 2 })).id, "newer");
  assert.match(uploaded.requests[0].url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart$/);
  assert.equal(uploaded.requests[0].init.headers.Authorization, "Bearer t1");
  assert.equal(uploaded.requests[0].init.headers["Content-Type"], "multipart/related; boundary=random-1");
  assert.equal(uploaded.requests[1].init.headers["Content-Type"], "multipart/related; boundary=random-2");
  assert.match(uploaded.requests[0].init.body, /^--random-1/);
  assert.match(uploaded.requests[1].init.body, /^--random-2/);
  assert.match(uploaded.requests[0].init.body, /"parents":\["appDataFolder"\]/);
  assert.match(uploaded.requests[0].init.body, /\{"schema":1\}/);

  const sync = driveRuntime([
    new Response(JSON.stringify({ startPageToken: "start" }), { status: 200 }),
    new Response(JSON.stringify({ changes: [{ fileId: "1" }], nextPageToken: "p2" }), { status: 200 }),
    new Response(JSON.stringify({ changes: [{ fileId: "2" }], newStartPageToken: "next" }), { status: 200 }),
  ]);
  assert.equal(await sync.drive.getStartToken(), "start");
  const changed = await sync.drive.listChanges("old");
  assert.deepEqual(Array.from(changed.changes, (change) => change.fileId), ["1", "2"]);
  assert.equal(changed.newStartPageToken, "next");

  let hasMine = true;
  const otherFiles = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, appProperties: { app: "other" } }));
  const cleared = driveRuntime((url, init) => {
    if (url.includes("/files?")) {
      const isSecondPage = url.includes("pageToken=p2");
      return new Response(JSON.stringify(isSecondPage
        ? { files: hasMine ? [{ id: "mine", appProperties: { app: "polyask" } }] : [] }
        : { files: otherFiles, nextPageToken: "p2" }), { status: 200 });
    }
    if (url.endsWith("/files/mine") && init.method === "DELETE") {
      hasMine = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request ${url}`);
  });
  const progress = [];
  await cleared.drive.clearAll((count) => progress.push(count));
  const deletes = cleared.requests.filter((request) => request.init.method === "DELETE");
  const pages = cleared.requests.filter((request) => request.url.includes("/files?"));
  assert.deepEqual(deletes.map((request) => request.url.match(/\/files\/([^?]+)/)[1]), ["mine"]);
  assert.equal(pages.length, 4, "首个目标在第二页时，删除后必须从首页重新扫描");
  assert.ok(pages.every((request) => request.url.includes("pageSize=100")));
  assert.ok(!pages[0].url.includes("pageToken=") && pages[1].url.includes("pageToken=p2") &&
    !pages[2].url.includes("pageToken=") && pages[3].url.includes("pageToken=p2"));
  assert.deepEqual(progress, [1]);

  const disconnect = driveRuntime([], true);
  await assert.rejects(disconnect.drive.disconnect(), (error) => error.code === "auth_failed" && error.status === 0);

  const initial = syncRuntime();
  await initial.sync.connect();
  assert.deepEqual(initial.calls.slice(0, 3), ["token", "list", "changes:start"], "首次扫描必须先取 token，再全量扫描，再增量补齐");
  assert.equal(await initial.values.get("pageToken"), "next");
  await initial.sync.runNow();
  assert.equal(initial.calls.at(-1), "changes:next", "已有 token 的同步只能走增量 Changes");
  assert.equal(initial.calls.filter((call) => call === "list").length, 1, "增量同步不得重复全量扫描");

  const expired = syncRuntime({ goneOnce: true });
  await expired.values.set("pageToken", "expired");
  await expired.sync.connect();
  assert.deepEqual(expired.calls, ["changes:expired", "token", "list", "changes:start"], "410 必须重新全量扫描而非上传空库");

  const ordered = syncRuntime({ failHistory: true });
  await ordered.queued.set("state", { key: "state", kind: "state", nextAt: 0, attempt: 0 });
  await ordered.queued.set("history:h:device", { key: "history:h:device", kind: "history", entityId: "h", nextAt: 0, attempt: 0 });
  await ordered.queued.set("archive:a", { key: "archive:a", kind: "archive", entityId: "a", nextAt: 0, attempt: 0 });
  await ordered.records.set("history:h", { id: "h", textHash: "h", text: "h", deviceId: "device" });
  await ordered.records.set("archive:a", { id: "a", text: "a", deviceId: "device" });
  await ordered.sync.connect();
  assert.equal(ordered.calls.slice(-3).join(","), "state,history,archive", "拉取完成后必须按 state/history/archive 上传");
  assert.equal(ordered.queued.has("history:h:device"), true, "上传失败不得删队列");
  assert.equal(ordered.queued.get("history:h:device").attempt, 1);
  assert.ok(ordered.queued.get("history:h:device").nextAt > 10_000);

  const remote = syncRuntime({ files: [{ id: "remote", appProperties: { app: "polyask", schema: "1", kind: "state", id: "remote" } }], downloads: { remote: { schema: 1, deviceId: "remote", settings: {} } } });
  await remote.sync.connect();
  assert.equal(remote.localChangeCalls(), 0, "远端写回不得形成上传回环");
  const callsBeforeStatus = remote.calls.length;
  remote.change({ amsSyncStatus: { newValue: {} } });
  await Promise.resolve();
  assert.equal(remote.calls.length, callsBeforeStatus, "非白名单状态变更不得调度同步");

  const future = syncRuntime({ files: [{ id: "future", appProperties: { app: "polyask", schema: "2", kind: "state" } }] });
  await future.queued.set("state", { key: "state", kind: "state", nextAt: 0, attempt: 0 });
  await future.sync.connect();
  assert.equal((await future.sync.status()).readOnly, true, "高 schema 必须进入只读");
  assert.equal(future.calls.includes("state"), false, "只读模式不得上传");

  const damaged = syncRuntime({ files: [
    { id: "bad", appProperties: { app: "polyask", schema: "1", kind: "history", id: "bad", device: "d" } },
    { id: "good", appProperties: { app: "polyask", schema: "1", kind: "history", id: "good", device: "d" } },
  ], downloads: { bad: "not json", good: { schema: 1, id: "good", textHash: "good", text: "ok", createdAt: 1, lastUsedAt: 1 } } });
  await damaged.sync.connect();
  assert.equal((await damaged.sync.status()).errorCount, 1, "单条损坏 JSON 必须计错并继续");
  await require("./test-sync-engine")();
  console.log("sync-runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
