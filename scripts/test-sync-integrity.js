#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;

function event() {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), emit: (...args) => listeners.slice().forEach((fn) => fn(...args)) };
}

function loadModel() {
  const scope = vm.createContext({ crypto, TextEncoder, Math });
  vm.runInContext(fs.readFileSync("bg/sync-model.js", "utf8") + ";this.model=SyncModel", scope);
  return scope.model;
}

function loadTransfer(model) {
  const scope = vm.createContext({ SyncModel: model, chrome: {}, Date });
  vm.runInContext(fs.readFileSync("bg/transfer.js", "utf8") + ";this.transfer=Transfer", scope);
  return scope.transfer;
}

function dataRuntime(model) {
  const meta = new Map(), history = new Map(), archives = new Map(), outbox = new Map();
  let scheduled = 0;
  const store = {
    getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value),
    getHistory: async (id) => history.get(id), putHistory: async (value) => history.set(value.id, value),
    getArchive: async (id) => archives.get(id), putArchive: async (value) => archives.set(value.id, value),
    enqueue: async (op) => outbox.set(op.key, { ...op, revision: (outbox.get(op.key)?.revision || 0) + 1 }),
    trimBodies: async () => {}, next: async (kind, after) => {
      const source = kind === "history" ? history : archives;
      const key = [...source.keys()].sort().find((value) => after == null || value > after);
      return key == null ? null : { key, value: source.get(key) };
    }, pageHistory: async () => ({}), pageArchives: async () => ({}),
  };
  const chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { onMessage: event(), sendMessage: () => {} } };
  const scope = vm.createContext({ SyncStore: store, SyncModel: model, chrome, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" }, Date,
    SyncEngine: { scheduleLocal: () => { scheduled++; }, projectImportedState: async () => {} } });
  vm.runInContext(fs.readFileSync("bg/data.js", "utf8") + ";this.data=Data", scope);
  return { data: scope.data, meta, history, archives, outbox, scheduled: () => scheduled };
}

function syncRuntime({ entityKind = "archive", readOnly = false, duplicate = false, deadFile = false } = {}) {
  const model = loadModel(), meta = new Map(), local = new Map(), files = new Map(), outbox = new Map(), records = new Map();
  const storage = event(), uploads = [], downloads = [], notes = [];
  const timers = new Map(); let timerId = 0;
  let deviceState = { schema: 1, deviceId: "device", settings: {}, templates: {}, groups: {} }, release;
  local.set("amsSyncConfig", { connected: true, readOnly }); meta.set("pageToken", "token");
  const enqueue = async (op) => outbox.set(op.key, { ...op, revision: (outbox.get(op.key)?.revision || 0) + 1 });
  const store = {
    getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value), deleteMeta: async (key) => meta.delete(key),
    readyOutbox: async () => [...outbox.values()], enqueue,
    completeOutbox: async (key, revision) => { if (outbox.get(key)?.revision === revision) outbox.delete(key); }, countOutbox: async () => outbox.size,
    getHistory: async (id) => records.get(`history:${id}`), putHistory: async (value) => records.set(`history:${value.id}`, value),
    getArchive: async (id) => records.get(`archive:${id}`), putArchive: async (value) => records.set(`archive:${value.id}`, value),
    putFile: async (file) => files.set(file.fileId, file), getFile: async (id) => files.get(id), deleteFile: async (id) => files.delete(id),
    findFile: async (key) => [...files.values()].filter((file) => file.logicalKey === key).sort((a, b) => a.fileId.localeCompare(b.fileId))[0],
    setEntityFile: async (kind, id, fileId, expected, ownerId) => {
      const key = `${kind}:${id}`, value = records.get(key);
      if (value && (expected === undefined || value.fileId === expected)) records.set(key, { ...value, ...(fileId ? { fileId } : {}), ...(ownerId ? { deviceId: ownerId } : {}) });
    }, iterate: async (_kind, visit) => { for (const file of [...files.values()]) await visit(file); }, trimBodies: async () => {},
  };
  const data = {
    deviceId: async () => "device", deviceState: async () => deviceState,
    getHistory: (id) => store.getHistory(id), getArchive: (id) => store.getArchive(id), seedState: async () => {},
    importRecords: async ({ history = [], archives = [] }) => {
      for (const value of history) records.set(`history:${value.id}`, value);
      for (const value of archives) records.set(`archive:${value.id}`, value);
    }, applyRemoteState: async () => {},
    projectState: async (_state, suppress) => {
      const values = { amsTheme: "dark" }, cleanup = suppress(values);
      storage.emit({ amsTheme: { newValue: "dark" } }, "local");
      storage.emit({ amsTheme: { newValue: "light" } }, "local");
      cleanup();
    }, noteStorageChanges: async (changes) => { notes.push(changes); return {}; },
  };
  const drive = {
    connect: async () => {}, disconnect: async () => {}, getStartToken: async () => "start",
    visitFiles: async () => {}, visitChanges: async () => ({ newStartPageToken: "next" }),
    download: async (id) => {
      downloads.push(id);
      if (id === "dead") throw { code: "not_found", status: 404 };
      return { schema: 1, id: "a", createdAt: 1, text: "good", results: [], deviceId: "d" };
    },
    upsert: async (fileId, _name, _props, body) => {
      uploads.push({ fileId, body: structuredClone(body) });
      if (uploads.length === 1) await new Promise((resolve) => { release = resolve; });
      return { id: fileId || "created" };
    }, clearAll: async () => {},
  };
  const chrome = { storage: { local: {
    get: async (defaults) => Object.fromEntries(Object.keys(defaults || {}).map((key) => [key, local.has(key) ? local.get(key) : defaults[key]])),
    set: async (values) => { for (const [key, value] of Object.entries(values)) local.set(key, value); },
  }, onChanged: storage }, runtime: { onMessage: event(), onStartup: event() }, alarms: { create: () => {}, onAlarm: event() } };
  const scope = vm.createContext({ SyncStore: store, Data: data, Drive: drive, SyncModel: model, chrome, Date,
    setTimeout: (fn) => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id), structuredClone });
  vm.runInContext(fs.readFileSync("bg/sync.js", "utf8") + ";this.sync=SyncEngine", scope);
  if (duplicate) { files.set("z", { fileId: "z", logicalKey: "archive:a" }); files.set("a", { fileId: "a", logicalKey: "archive:a" }); }
  if (deadFile) { files.set("dead", { fileId: "dead", logicalKey: "archive:a" }); files.set("good", { fileId: "good", logicalKey: "archive:a" }); }
  const key = entityKind === "state" ? "state" : `${entityKind}:a${entityKind === "history" ? ":device" : ""}`;
  outbox.set(key, { key, kind: entityKind, entityId: entityKind === "state" ? undefined : "a", nextAt: 0, revision: 1 });
  if (entityKind === "history") records.set("history:a", { id: "a", textHash: "a", text: "old", createdAt: 1, lastUsedAt: 1, deviceId: "device" });
  if (entityKind === "archive") records.set("archive:a", { id: "a", text: "old", results: [], createdAt: 1, updatedAt: 1, deviceId: "device" });
  if (deadFile) records.set("archive:a", { id: "a", createdAt: 1, fileId: "dead" });
  return { sync: scope.sync, store, data, drive, outbox, records, files, uploads, downloads, notes, local, timers,
    waitUpload: async () => { while (!release) await new Promise(setImmediate); }, release: () => release(),
    update: async () => {
      if (entityKind === "state") deviceState = { ...deviceState, settings: { amsTheme: { value: "new", updatedAt: 2, deviceId: "device" } } };
      else if (entityKind === "history") records.set("history:a", { ...records.get("history:a"), text: "new", lastUsedAt: 2 });
      else records.set("archive:a", { id: "a", createdAt: 1, updatedAt: 2, deletedAt: 2, deviceId: "device" });
      await enqueue({ key, kind: entityKind, entityId: entityKind === "state" ? undefined : "a", nextAt: 0 });
    },
  };
}

async function main() {
  const model = loadModel(), transfer = loadTransfer(model);
  for (const bad of [null, "", true, [], -1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => transfer.validateRecord({ kind: "history", value: { id: "h", textHash: "h", text: "h", createdAt: bad, lastUsedAt: 1 } }), /invalid_record/);
  for (const bad of [null, "", true, [], -1])
    assert.throws(() => transfer.validateRecord({ kind: "archive", value: { id: "a", text: "a", results: [], createdAt: 1, deletedAt: bad } }), /invalid_record/);

  const data = dataRuntime(model);
  data.meta.set("deviceId", "local");
  data.meta.set("materializedState", { schema: 1, settings: { amsTheme: { value: "remote", updatedAt: 2, deviceId: "r" } },
    templates: { remote: { id: "remote", text: "r", updatedAt: 2, deviceId: "r" } }, groups: { gone: { id: "gone", updatedAt: 3, deletedAt: 3, deviceId: "r" } } });
  data.meta.set("deviceState", { schema: 1, deviceId: "local", settings: { amsTheme: { value: "local", updatedAt: 4, deviceId: "local" } },
    templates: { local: { id: "local", text: "l", updatedAt: 4, deviceId: "local" } }, groups: {} });
  const exported = []; for await (const row of data.data.exportRecords()) exported.push(row);
  assert.equal(exported.find((row) => row.kind === "setting").value.value, "local", "导出必须合并本地新 state 与远端物化快照");
  assert.deepEqual(exported.filter((row) => row.kind === "template").map((row) => row.value.id).sort(), ["local", "remote"]);
  assert.ok(exported.some((row) => row.kind === "group" && row.value.deletedAt === 3), "导出必须保留远端 tombstone");
  await data.data.addHistory("h"); await data.data.addArchive({ text: "a", results: [] });
  assert.equal(data.scheduled(), 2, "历史和归档写入必须进入共享防抖调度器");

  const disconnected = syncRuntime(); disconnected.outbox.clear();
  await disconnected.store.putMeta("materializedState", { schema: 1, settings: { amsTheme: { value: "remote", updatedAt: 1, deviceId: "r" } }, templates: {}, groups: {} });
  await disconnected.sync.disconnect();
  assert.ok(await disconnected.store.getMeta("materializedState"), "普通断开不得删除可离线导出的物化状态");

  for (const kind of ["state", "history", "archive"]) {
    const runtime = syncRuntime({ entityKind: kind }), running = runtime.sync.runNow("test");
    await runtime.waitUpload(); await runtime.update(); runtime.release(); await running;
    assert.equal(runtime.uploads.length, 2, `${kind} 在途更新必须保留队列并再次上传`);
    if (kind === "archive") assert.equal(runtime.uploads[1].body.deletedAt, 2, "在途删除不得被旧正文覆盖");
    if (kind === "history") assert.equal(runtime.records.get("history:a").text, "new", "回包只补 fileId，不得覆盖新历史");
  }

  const historyId = await model.hashText("shared"), crossDevice = syncRuntime({ entityKind: "history" }), sent = [];
  crossDevice.outbox.clear(); crossDevice.records.clear();
  crossDevice.records.set(`history:${historyId}`, { id: historyId, textHash: historyId, text: "local", createdAt: 1, lastUsedAt: 1, deviceId: "device" });
  crossDevice.outbox.set(`history:${historyId}:device`, { key: `history:${historyId}:device`, kind: "history", entityId: historyId, nextAt: 0, revision: 1 });
  crossDevice.drive.visitChanges = async (_token, visit) => { await visit({ file: { id: "remote-file",
    appProperties: { app: "polyask", schema: "1", kind: "history", id: historyId, device: "remote" } } }); return { newStartPageToken: "next" }; };
  crossDevice.drive.download = async () => ({ schema: 1, id: historyId, textHash: historyId, text: "shared", createdAt: 1, lastUsedAt: 2, deviceId: "remote" });
  crossDevice.drive.upsert = async (fileId, _name, props, body) => { sent.push({ fileId, props, body: structuredClone(body) }); return { id: "local-file" }; };
  await crossDevice.sync.runNow();
  assert.equal(sent[0].props.device, "device"); assert.equal(sent[0].body.deviceId, "device", "pull 后本机 history 上传正文必须重新归属本机");
  assert.equal(Object.hasOwn(sent[0].body, "fileId"), false, "Drive 正文不得携带本地物理引用");
  assert.equal(crossDevice.records.get(`history:${historyId}`).deviceId, "device", "上传回包必须在最新聚合记录上同步物理归属元数据");

  const duplicate = syncRuntime({ duplicate: true }), duplicateRun = duplicate.sync.runNow();
  await duplicate.waitUpload(); duplicate.release(); await duplicateRun;
  assert.equal(duplicate.uploads[0].fileId, "a", "重复 logical key 必须确定性 PATCH canonical fileId");

  const dead = syncRuntime({ deadFile: true }); dead.outbox.clear();
  assert.equal((await dead.sync.resolveArchive("a")).text, "good", "404 必须清死索引并重选重复副本");
  await dead.sync.resolveArchive("a");
  assert.equal(dead.downloads.filter((id) => id === "dead").length, 1, "后续不得重复请求死 fileId");
  const orphaned = syncRuntime({ deadFile: true }); orphaned.outbox.clear(); orphaned.files.delete("dead");
  assert.equal((await orphaned.sync.resolveArchive("a")).text, "good", "索引已缺失时也必须清理实体中的死 fileId");

  const sticky = syncRuntime({ readOnly: true }); await sticky.sync.connect();
  assert.equal((await sticky.sync.status()).readOnly, true, "auth reconnect 不得清 schema readOnly");
  assert.equal(sticky.uploads.length, 0, "空 changes 不能解除只读并上传");
  await sticky.sync.clearRemote();
  assert.equal((await sticky.sync.status()).readOnly, false, "完整清空云端后必须安全解除只读");

  const missingState = syncRuntime(); missingState.outbox.clear();
  missingState.files.set("dead", { fileId: "dead", logicalKey: "state:remote" });
  missingState.local.set("amsSyncConfig", { connected: true });
  missingState.store.putMeta("remoteStates", { dead: { schema: 1, deviceId: "remote", settings: { amsTheme: { value: "old", updatedAt: 1, deviceId: "r" } } } });
  missingState.drive.visitChanges = async (_token, visit) => { await visit({ file: { id: "dead", appProperties: { app: "polyask", schema: "1", kind: "state", id: "remote" } } }); return { newStartPageToken: "next" }; };
  await missingState.sync.runNow();
  assert.equal(Object.hasOwn(await missingState.store.getMeta("remoteStates"), "dead"), false, "state 404 必须移出远端物化集合");

  const invalidRemote = syncRuntime(); invalidRemote.outbox.clear();
  invalidRemote.drive.visitChanges = async (_token, visit) => { await visit({ file: { id: "invalid", appProperties: { app: "polyask", schema: "1", kind: "history", id: "invalid", device: "d" } } }); return { newStartPageToken: "next" }; };
  invalidRemote.drive.download = async () => ({ schema: 1, id: "invalid", textHash: "invalid", text: "invalid", createdAt: null, lastUsedAt: 1, deviceId: "d" });
  await invalidRemote.sync.runNow();
  assert.equal(invalidRemote.records.has("history:invalid"), false, "远端正文必须使用与迁移导入相同的严格时间校验");

  const lostPost = syncRuntime(); let post = 0; const targets = [];
  lostPost.drive.upsert = async (fileId) => { targets.push(fileId); if (!post++) { lostPost.files.set("created", { fileId: "created", logicalKey: "archive:a" }); throw { code: "network_error" }; } return { id: fileId }; };
  await lostPost.sync.runNow(); assert.equal(lostPost.outbox.size, 1, "POST 回包丢失后队列必须保留");
  await lostPost.sync.runNow();
  assert.deepEqual(targets, [undefined, "created"], "重试必须发现已提交副本并改用 PATCH");

  const debounce = syncRuntime(); debounce.outbox.clear();
  debounce.sync.scheduleLocal(); debounce.sync.scheduleLocal();
  assert.equal(debounce.timers.size, 1, "历史/归档必须复用一个 3 秒防抖任务");

  const suppression = syncRuntime(); suppression.outbox.clear(); await suppression.sync.projectImportedState({});
  assert.equal(suppression.notes.length, 1, "只抑制精确投影值，并发不同值必须进入本地状态");
  assert.equal(suppression.notes[0].amsTheme.newValue, "light");
  console.log("sync-integrity tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
