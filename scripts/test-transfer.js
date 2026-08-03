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
  const scope = vm.createContext({ chrome, SyncEngine: { runForExport }, Data: { exportRecords: rows }, SyncModel: { hashText: async (text) => text }, crypto: require("node:crypto").webcrypto, Date });
  vm.runInContext(fs.readFileSync("bg/transfer.js", "utf8") + ";this.transfer=Transfer", scope);
  return scope.transfer;
}
function syncRuntime(connected) {
  const config = { connected }, events = { storage: event(), alarm: event(), message: event(), startup: event() };
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
  const guarded = syncRuntime(false);
  await guarded.sync.projectImportedState({});
  assert.equal(guarded.notes(), 0, "导入投影不得回写时间戳或二次排队");
  console.log("transfer tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
