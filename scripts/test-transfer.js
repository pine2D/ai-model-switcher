#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

function event() { const all = []; return { addListener: (fn) => all.push(fn), removeListener: (fn) => all.splice(all.indexOf(fn), 1), emit: (...args) => all.slice().forEach((fn) => fn(...args)) }; }
function port() {
  const onMessage = event(), onDisconnect = event(), sent = [];
  return { name: "ams-transfer", onMessage, onDisconnect, sent, postMessage: (row) => sent.push(row), disconnect: () => onDisconnect.emit(), ack: (seq) => onMessage.emit({ ack: seq }) };
}
function transferRuntime({ runForExport, rows }) {
  const chrome = { runtime: { onConnect: event(), onMessage: event() } };
  const scope = vm.createContext({ chrome, SyncEngine: { runForExport }, Data: { exportRecords: rows }, SyncModel: { hashText: async (text) => text }, crypto: require("node:crypto").webcrypto, Date, URL });
  vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8"), scope);
  vm.runInContext(fs.readFileSync("bg/transfer.js", "utf8") + ";this.transfer=Transfer", scope);
  return scope.transfer;
}
function migrationRuntime(importRecords) {
  const broadcasts = []; let listener;
  const chrome = { runtime: { onConnect: event(), onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: (message) => broadcasts.push(message) } };
  const scope = vm.createContext({ chrome, SyncEngine: { finishImport: async () => {} }, Data: { importRecords },
    SyncModel: { hashText: async (text) => text }, crypto: require("node:crypto").webcrypto, Date, URL });
  vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8"), scope);
  vm.runInContext(fs.readFileSync("bg/transfer.js", "utf8"), scope);
  return { broadcasts, send: (message) => new Promise((resolve) => listener(message, null, resolve)) };
}
function syncRuntime(connected, readOnly = false) {
  const config = { connected, readOnly }, events = { storage: event(), alarm: event(), message: event(), startup: event() };
  let notes = 0;
  const store = { countOutbox: async () => 0, getMeta: async () => "token", putMeta: async () => {}, readyOutbox: async () => [], iterate: async () => {}, deleteMeta: async () => {}, deleteFile: async () => {} };
  const chrome = { storage: { local: { get: async (defaults) => ({ ...defaults, amsSyncConfig: config, amsSyncStatus: {} }), set: async () => {} }, onChanged: events.storage }, runtime: { onMessage: events.message, onStartup: events.startup }, alarms: { create: () => {}, onAlarm: events.alarm } };
  const Data = { projectState: async (_state, suppress) => { const cleanup = suppress({ amsTheme: "dark" });
    events.storage.emit({ amsTheme: { newValue: "dark" } }, "local"); cleanup(); }, noteStorageChanges: async () => { notes++; } };
  const scope = vm.createContext({ chrome, SyncStore: store, Data, Drive: { listChanges: async () => { throw { code: "network_error" }; } }, SyncModel: { SCHEMA: 1, retryDelay: () => 1 }, setTimeout, clearTimeout, Date });
  vm.runInContext(fs.readFileSync("bg/sync.js", "utf8") + ";this.sync=SyncEngine", scope);
  return { sync: scope.sync, notes: () => notes };
}

async function main() {
  let release, reads = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const transfer = transferRuntime({ runForExport: () => pending, rows: async function* () { reads++; yield { kind: "archive", value: { id: "00000000-0000-4000-8000-000000000001", createdAt: 1, deletedAt: 1 } }; } });
  const cancelled = port(), exporting = transfer.attachPort(cancelled);
  cancelled.disconnect(); release(); await exporting;
  assert.equal(reads, 0, "断开期间不得启动预检或继续读取");
  assert.equal(cancelled.sent.length, 0, "断开后不得再发送错误或数据");

  await assert.rejects(syncRuntime(true).sync.runForExport(), (error) => error.code === "network_error", "已连接导出必须传播非交互同步失败");
  await assert.doesNotReject(syncRuntime(false).sync.runForExport(), "未连接导出可只使用本地数据");
  await assert.rejects(syncRuntime(false, true).sync.runForExport(), (error) => error.code === "schema", "断开后高 schema 仍必须阻止不完整导出");
  const guarded = syncRuntime(false);
  await guarded.sync.projectImportedState({});
  assert.equal(guarded.notes(), 0, "导入投影不得回写时间戳或二次排队");

  const archive = { id: "00000000-0000-4000-8000-000000000001", createdAt: 1, updatedAt: 1, text: "Prompt", task: "Question", source: null,
    results: [{ host: "a", label: "A", text: "Answer" }], favorite: true, tags: ["work"], note: "keep", winnerHost: "a",
    synthesis: null, hosts: ["a"], resultPreviews: [{ host: "a", label: "A", text: "Answer" }], searchText: "question\nkeep\nwork\na\nanswer" };
  assert.equal(await transferRuntime({ runForExport: async () => {}, rows: async function* () {} }).validateContent({ kind: "archive", value: JSON.parse(JSON.stringify(archive)) }), true);
  const synthesized = { ...archive, synthesis: { host: "a", text: "Combined", state: "fast", instruction: "Compare", createdAt: 2 },
    searchText: "question\nkeep\nwork\na\nanswer\ncombined" };
  assert.equal(await transferRuntime({ runForExport: async () => {}, rows: async function* () {} }).validateContent({ kind: "archive", value: synthesized }), true);
  const invalid = (patch) => assert.throws(() => transferRuntime({ runForExport: async () => {}, rows: async function* () {} })
    .validateRecord({ kind: "archive", value: { ...archive, ...patch } }), (error) => error.code === "invalid_record");
  invalid({ note: "x".repeat(4001) });
  invalid({ tags: Array(21).fill("work") });
  invalid({ winnerHost: "b" });
  invalid({ synthesis: { host: "a", text: "", state: null, instruction: "Compare", createdAt: 2 } });
  invalid({ resultPreviews: [null] });
  invalid({ source: { kind: "page", title: "Bad", url: "https://example.test/", truncated: false, capturedAt: 1, extra: true } });
  invalid({ source: { kind: "page", title: "Bad", url: "https://example.test/" } });
  for (const url of ["javascript:alert(1)", "data:text/plain,x", "not a url"])
    invalid({ source: { kind: "page", title: "Bad", url, truncated: false, capturedAt: 1 } });
  assert.doesNotThrow(() => transferRuntime({ runForExport: async () => {}, rows: async function* () {} })
    .validateRecord({ kind: "archive", value: { ...archive, source: { kind: "selection", title: "Web", url: "https://example.test/path", truncated: false, capturedAt: 1 },
      searchText: "question\nweb\nhttps://example.test/path\nkeep\nwork\na\nanswer" } }));

  let changed = 2;
  const migration = migrationRuntime(async () => ({ archives: changed, histories: changed ? 1 : 0 }));
  const rows = [1, 2].map((at) => ({ kind: "archive", value: { id: `00000000-0000-4000-8000-00000000000${at}`, createdAt: at, deletedAt: at } }));
  assert.equal((await migration.send({ source: "AMS_TRANSFER", action: "importBatch", records: rows })).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(migration.broadcasts)), [{ source: "AMS_DATA", type: "historyChanged" },
    { source: "AMS_DATA", type: "archiveChanged" }], "迁移批次必须分别通知历史与归档变化");
  changed = 0;
  await migration.send({ source: "AMS_TRANSFER", action: "importBatch", records: rows });
  assert.equal(migration.broadcasts.length, 2, "迁移批次未改变数据时不得广播");
  console.log("transfer tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
