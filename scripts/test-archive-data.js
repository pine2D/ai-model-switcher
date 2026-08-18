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
const scope = vm.createContext({ SyncStore, SyncModel: { SCHEMA: 1, utf8Preview: (text) => text,
  compareVersion: (a, b) => Number(a.updatedAt) - Number(b.updatedAt) || String(a.deviceId || "").localeCompare(String(b.deviceId || "")) }, chrome,
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
  const updateFirst = await data.addArchive({ id: "00000000-0000-4000-8000-000000000002", text: "update first", results: [] });
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const lateUpdate = data.updateArchive(updateFirst.id, { note: "late" });
  await new Promise(setImmediate);
  const deleteAfter = data.deleteArchive(updateFirst.id);
  await new Promise(setImmediate); releaseArchivePut(); await Promise.all([lateUpdate, deleteAfter]);
  assert.equal(Object.hasOwn(archives.get(updateFirst.id), "deletedAt"), true, "update 后排队的删除必须最终保留 tombstone");

  const deleteFirst = await data.addArchive({ id: "00000000-0000-4000-8000-000000000003", text: "delete first", results: [] });
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const deleting = data.deleteArchive(deleteFirst.id);
  await new Promise(setImmediate);
  const updateAfter = data.updateArchive(deleteFirst.id, { note: "resurrect" });
  await new Promise(setImmediate); releaseArchivePut(); await deleting;
  await assert.rejects(updateAfter, (error) => error.code === "not_found", "删除后排队的更新必须重新读取 tombstone");

  const slow = await data.addArchive({ id: "00000000-0000-4000-8000-000000000004", text: "slow", results: [] });
  const fast = await data.addArchive({ id: "00000000-0000-4000-8000-000000000005", text: "fast", results: [] });
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const slowUpdate = data.updateArchive(slow.id, { note: "slow" }); await new Promise(setImmediate);
  const fastUpdate = data.updateArchive(fast.id, { note: "fast" });
  const winner = await Promise.race([fastUpdate.then(() => "fast"), new Promise((resolve) => setImmediate(() => resolve("blocked")))]);
  releaseArchivePut(); await Promise.all([slowUpdate, fastUpdate]);
  assert.equal(winner, "fast", "不同归档不得共用全局写锁");

  const importUpdate = await data.addArchive({ id: "00000000-0000-4000-8000-000000000007", text: "import update", results: [] });
  const staleForUpdate = { ...importUpdate, updatedAt: importUpdate.updatedAt + 1, deviceId: "remote" };
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const importingUpdate = data.importRecords({ archives: [staleForUpdate] }); await new Promise(setImmediate);
  const newerUpdate = data.updateArchive(importUpdate.id, { note: "newer local" }); await new Promise(setImmediate);
  releaseArchivePut(); await Promise.all([importingUpdate, newerUpdate]);
  assert.equal(archives.get(importUpdate.id).note, "newer local", "陈旧 Drive 导入不得覆盖并发完成的本地更新");

  const importDelete = await data.addArchive({ id: "00000000-0000-4000-8000-000000000008", text: "import delete", results: [] });
  const staleForDelete = { kind: "archive", value: { ...importDelete, updatedAt: importDelete.updatedAt + 1, deviceId: "remote" } };
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const importingDelete = data.importRecords([staleForDelete]); await new Promise(setImmediate);
  const newerDelete = data.deleteArchive(importDelete.id); await new Promise(setImmediate);
  releaseArchivePut(); await Promise.all([importingDelete, newerDelete]);
  assert.equal(Object.hasOwn(archives.get(importDelete.id), "deletedAt"), true, "陈旧迁移导入不得复活并发删除的归档");

  const importSlow = await data.addArchive({ id: "00000000-0000-4000-8000-000000000009", text: "import slow", results: [] });
  const importFast = await data.addArchive({ id: "00000000-0000-4000-8000-000000000010", text: "import fast", results: [] });
  archivePutGate = new Promise((resolve) => { releaseArchivePut = resolve; }); blockArchivePut = true;
  const slowImport = data.importRecords({ archives: [{ ...importSlow, updatedAt: importSlow.updatedAt + 1, deviceId: "remote" }] }); await new Promise(setImmediate);
  const independentUpdate = data.updateArchive(importFast.id, { note: "independent" });
  const independentWinner = await Promise.race([independentUpdate.then(() => "fast"), new Promise((resolve) => setImmediate(() => resolve("blocked")))]);
  releaseArchivePut(); await Promise.all([slowImport, independentUpdate]);
  assert.equal(independentWinner, "fast", "归档导入队列不得阻塞其他 id");

  const response = await new Promise((resolve) => dataMessageListener({ source: "AMS_DATA", action: "archiveUpdate", id: added.id,
    patch: { note: "messaged" }, changeToken: "request-token" }, null, resolve));
  assert.equal(response.changeToken, "request-token");
  assert.deepEqual(broadcasts.at(-1), { source: "AMS_DATA", type: "archiveChanged", changeToken: "request-token" });
  assert.equal(Object.hasOwn(archives.get(added.id), "changeToken"), false, "change token 不得进入归档记录");
  const remote = { ...archives.get(added.id), updatedAt: archives.get(added.id).updatedAt + 1, deviceId: "remote" };
  assert.equal((await data.importRecords({ archives: [remote] })).archives, 1, "Drive 导入必须报告实际归档写入数");
  assert.equal((await data.importRecords({ archives: [remote] })).archives, 0, "Drive 重复版本不得报告归档变化");
  const migrated = { kind: "archive", value: { ...remote, id: "00000000-0000-4000-8000-000000000006" } };
  assert.equal((await data.importRecords([migrated])).archives, 1, "迁移导入必须报告实际归档写入数");
  assert.equal((await data.importRecords([migrated])).archives, 0, "迁移重复版本不得报告归档变化");
  // 站点健康统计：按站聚合 results[].code，tombstone 与无 results（被 trimBodies 裁过）的条目不计
  await data.addArchive({ id: "00000000-0000-4000-8000-000000000011", ts: 1000, text: "s1",
    results: [{ host: "stat-a", label: "A", text: "ok" }, { host: "stat-b", label: "B", text: null, code: "no_answer" }] });
  await data.addArchive({ id: "00000000-0000-4000-8000-000000000012", ts: 2000, text: "s2",
    results: [{ host: "stat-a", label: "A", text: null, code: "not_ready" }, { host: "stat-b", label: "B", text: null, code: "no_answer" }] });
  const trimmed = await data.addArchive({ id: "00000000-0000-4000-8000-000000000013", ts: 3000, text: "s3", results: [] });
  delete archives.get(trimmed.id).results; // 模拟 trimBodies 裁掉 results 的旧条目
  const stats = await data.archiveFailStats();
  const a = stats.find((row) => row.host === "stat-a"), b = stats.find((row) => row.host === "stat-b");
  assert.equal(a.total, 2); assert.deepEqual(a.codes, { not_ready: 1 });
  assert.equal(a.lastFailTs, 2000); assert.equal(a.lastFailCode, "not_ready");
  assert.equal(b.total, 2); assert.deepEqual(b.codes, { no_answer: 2 });
  const statsResponse = await new Promise((resolve) => dataMessageListener({ source: "AMS_DATA", action: "archiveFailStats" }, null, resolve));
  assert.equal(statsResponse.ok, true);
  assert.ok(Array.isArray(statsResponse.stats) && statsResponse.stats.length >= 2, "archiveFailStats 消息动作必须返回统计数组");
  // tombstone 守卫：带 deletedAt 的条目即使还残留 results 也不得计入（用户删了结果，统计里不能还在）
  archives.set("tomb-stat", { id: "tomb-stat", createdAt: 1, updatedAt: 2, deletedAt: 2, ts: 9000,
    results: [{ host: "stat-a", label: "A", text: null, code: "no_answer" }] });
  const afterTomb = await data.archiveFailStats();
  assert.equal(afterTomb.find((row) => row.host === "stat-a").total, 2, "tombstone 条目不得计入站点健康统计");
  console.log("archive-data tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
