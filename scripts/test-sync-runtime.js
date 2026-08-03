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
  console.log("sync-runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
