#!/usr/bin/env node
"use strict";
const assert = require("node:assert"), fs = require("node:fs"), vm = require("node:vm");

const archives = new Map(), outbox = new Map(), meta = new Map();
let blockArchivePut = false, releaseArchivePut, archivePutGate;
let dataMessageListener;
const broadcasts = [];
const SyncStore = {
  getArchive: async (id) => archives.get(id),
  putArchive: async (row) => {
    if (blockArchivePut) { blockArchivePut = false; await archivePutGate; }
    archives.set(row.id, row); return row;
  },
  enqueue: async (row) => (outbox.set(row.key, row), row),
  trimBodies: async () => {},
  searchArchives: async (_cursor, limit, accept) => {
    const items = [...archives.values()].sort((a, b) => b.createdAt - a.createdAt).filter(accept).slice(0, limit);
    return { items, nextCursor: null };
  },
  iterate: async (kind, visit) => { if (kind === "archives") for (const row of archives.values()) await visit(row); },
  getMeta: async (key) => meta.get(key),
  putMeta: async (key, value) => meta.set(key, value),
};
const chrome = { storage: { local: { get: async (defaults) => defaults, set: async () => {} } }, runtime: {
  onMessage: { addListener(fn) { dataMessageListener = fn; } }, sendMessage(message) { broadcasts.push(message); },
} };
const scope = vm.createContext({ SyncStore, SyncModel: { SCHEMA: 1, utf8Preview: (text) => text }, chrome,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" }, Date });
vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8") + ";this.model=ArchiveModel", scope);
vm.runInContext(fs.readFileSync("bg/data.js", "utf8") + ";this.data=Data", scope);

async function main() {
  const data = scope.data;
  const added = await data.addArchive({ text: "Prompt", task: "Question", results: [{ host: "a", label: "A", text: "Answer" }] });
  assert.equal(added.schema, 1);
  assert.equal(added.preview, "Prompt");
  const changed = await data.updateArchive(added.id, { favorite: true, tags: ["work"], note: "keep", winnerHost: "a" });
  assert.equal(changed.favorite, true);
  assert.equal(outbox.get(`archive:${added.id}`).kind, "archive");
  const page = await data.searchArchives(null, 50, { query: "keep", favorite: true, tag: "work" });
  assert.deepEqual(page.items.map((item) => item.id), [added.id]);
  assert.deepEqual(await data.archiveTags(), ["work"]);
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const concurrent = [data.updateArchive(added.id, { favorite: false }), data.updateArchive(added.id, { note: "parallel" })];
  await new Promise(setImmediate); releaseArchivePut(); await Promise.all(concurrent);
  assert.equal(archives.get(added.id).favorite, false);
  assert.equal(archives.get(added.id).note, "parallel", "同一归档的并发 patch 不得相互覆盖");
  const failed = data.updateArchive(added.id, { favorite: "invalid" });
  const afterFailure = data.updateArchive(added.id, { tags: ["after-failure"] });
  await assert.rejects(failed, /invalid_favorite/);
  assert.deepEqual((await afterFailure).tags, ["after-failure"], "失败更新不得永久锁住同一归档");
  const response = await new Promise((resolve) => dataMessageListener({ source: "AMS_DATA", action: "archiveUpdate", id: added.id,
    patch: { note: "messaged" }, changeToken: "request-token" }, null, resolve));
  assert.equal(response.changeToken, "request-token");
  assert.deepEqual(broadcasts.at(-1), { source: "AMS_DATA", type: "archiveChanged", changeToken: "request-token" });
  assert.equal(Object.hasOwn(archives.get(added.id), "changeToken"), false, "change token 不得进入归档记录");
  console.log("archive-data tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
