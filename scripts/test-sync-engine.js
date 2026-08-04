"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function runtime({ listed = [], bodies = {}, changes = [], indexed = [], localArchives = [], localHistory = [], queued = [], fail = false, clearFail = false, clearAuthOnce = false, device = {}, goneOnce = false, archiveImportChanged = true } = {}) {
  const meta = new Map(), index = new Map(indexed.map((file) => [file.logicalKey, file])), outbox = new Map(queued.map((op) => [op.key, op]));
  const local = new Map(), calls = [], auths = [], uploads = [], applied = [], imports = [], seeds = [], events = [], broadcasts = [];
  const deviceState = { schema: 1, deviceId: "device", settings: {}, templates: {}, groups: {}, ...device }; let listener, notes = 0, activeChanges = changes;
  const store = {
    getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value), deleteMeta: async (key) => meta.delete(key),
    putFile: async (file) => { index.delete(`@${file.fileId}`); index.set(file.logicalKey, file); }, findFile: async (key) => index.get(key), getFile: async (id) => [...index.values()].find((file) => file.fileId === id),
    markFile: async (id, seenAt) => { const current = [...index.values()].find((file) => file.fileId === id);
      if (current) current.seenAt = seenAt; else index.set(`@${id}`, { fileId: id, seenAt }); },
    deleteFile: async (id) => { for (const [key, file] of index) if (file.fileId === id) index.delete(key); },
    iterate: async (kind, visit) => { if (kind === "files") for (const file of index.values()) await visit(file); },
    readyOutbox: async (now, limit) => [...outbox.values()].filter((op) => op.nextAt <= now).slice(0, limit),
    enqueue: async (op) => outbox.set(op.key, op), completeOutbox: async (key) => outbox.delete(key), countOutbox: async () => outbox.size,
    getHistory: async (id) => localHistory.find((item) => item.id === id), getArchive: async (id) => localArchives.find((item) => item.id === id),
    putHistory: async () => {}, putArchive: async () => {},
  };
  const data = {
    deviceId: async () => "device", deviceState: async () => meta.get("deviceState") || deviceState,
    applyRemoteState: async (state, suppress) => { applied.push(state); events.push("apply"); const cleanup = suppress({ amsTheme: "dark" });
      listener?.({ amsTheme: { newValue: "dark" } }, "local"); cleanup(); },
    noteStorageChanges: async () => { notes++; return {}; }, seedState: async (empty) => { seeds.push(empty); events.push("seed"); },
    exportRecords: async () => ({ history: [], archives: localArchives }), importRecords: async (records) => {
      imports.push(records); return { archives: archiveImportChanged ? (records.archives || []).length : 0 };
    },
    getHistory: async (id) => localHistory.find((item) => item.id === id), getArchive: async (id) => localArchives.find((item) => item.id === id),
  };
  const drive = {
    connect: async (interactive) => { auths.push(interactive); }, disconnect: async () => { calls.push("disconnect"); }, getStartToken: async () => { calls.push("token"); return "start"; },
    listFiles: async () => { calls.push("list"); return listed; }, listChanges: async (token) => { calls.push(`changes:${token}`); if (goneOnce) { goneOnce = false; throw { status: 410 }; } return { changes: activeChanges, newStartPageToken: "next" }; },
    download: async (id) => { const body = Array.isArray(bodies[id]) ? bodies[id].shift() : bodies[id]; if (body?.throw) throw body.throw; return body; }, upsert: async (_id, _name, props, body) => { calls.push(`upload:${props.kind}`); uploads.push(body); if (fail && props.kind !== "state") throw { code: "server_error", status: 500 }; return { id: `up-${calls.length}` }; },
    clearAll: async (progress) => { if (clearAuthOnce) { clearAuthOnce = false; throw { code: "unauthorized" }; }
      await progress(1); calls.push(`progress:${local.get("amsSyncConfig").clearProgress}`); if (clearFail) throw { code: "server_error" }; calls.push("clear"); },
  };
  const chrome = {
    storage: { local: { get: async (defaults) => Object.fromEntries(Object.keys(defaults || {}).map((key) => [key, local.has(key) ? local.get(key) : defaults[key]])), set: async (next) => { for (const [key, value] of Object.entries(next)) local.set(key, value); } }, onChanged: { addListener: (fn) => { listener = fn; } } },
    runtime: { onMessage: { addListener: () => {} }, onStartup: { addListener: () => {} }, sendMessage: (message) => broadcasts.push(message) }, alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  };
  const SyncModel = {
    SCHEMA: 1, hashText: async (value) => value, utf8Preview: (value) => value || "", retryDelay: () => 50,
    mergeStateFragments: (items) => {
      const settings = {}, templates = {}, groups = {};
      for (const item of items) for (const [bucket, target] of [["settings", settings], ["templates", templates], ["groups", groups]])
        for (const [id, value] of Object.entries(item[bucket] || {})) if (!target[id] || Number(value.updatedAt) >= Number(target[id].updatedAt)) target[id] = value;
      return { settings, templates: Object.values(templates), groups: Object.values(groups), corrupt: 0, readOnly: false };
    },
    mergeHistory: (items) => items, mergeArchives: (items) => items,
    compareVersion: (a, b) => Number(a.updatedAt) - Number(b.updatedAt) || String(a.deviceId || "").localeCompare(String(b.deviceId || "")),
  };
  const scope = vm.createContext({ SyncStore: store, Data: data, Drive: drive, SyncModel, chrome, Date, setTimeout, clearTimeout, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/archive-model.js"), "utf8"), scope);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/sync.js"), "utf8") + ";this.sync=SyncEngine", scope);
  return { sync: scope.sync, calls, auths, uploads, meta, index, outbox, applied, imports, seeds, events, broadcasts, notes: () => notes, setChanges: (value) => { activeChanges = value; }, change: (value) => listener(value, "local"), deviceState: () => meta.get("deviceState") || deviceState, local };
}

const liveArchive = (id, patch = {}) => ({ schema: 1, id, createdAt: 1, updatedAt: 1, deviceId: "remote", text: "Prompt", task: "Question", source: null,
  results: [{ host: "a", label: "A", text: "Answer", state: "think", code: null }], favorite: false, tags: [], note: "", winnerHost: null,
  synthesis: null, hosts: ["a"], resultPreviews: [{ host: "a", label: "A", text: "Answer" }], searchText: "question\na\nanswer", ...patch });

module.exports = async function testSyncEngine() {
  const added = { id: "remote", appProperties: { app: "polyask", schema: "1", kind: "state", id: "remote" } };
  const initial = runtime({ changes: [{ file: added }], bodies: { remote: { schema: 1, deviceId: "remote", settings: { amsTheme: { value: "dark", updatedAt: 2, deviceId: "remote" } } } } });
  await initial.sync.connect();
  assert.deepEqual(initial.seeds, [false], "首次 changes 新增远端文件时不得把云端误判为空");
  assert.equal(initial.applied.at(-1).settings.amsTheme.value, "dark", "远端设置必须先于 seed 合并");
  assert.deepEqual(initial.events.slice(0, 2), ["seed", "apply"], "先 seed 本机集合，再应用远端 state");
  assert.equal(initial.notes(), 0, "远端写回触发 storage change 时不得生成本地 outbox");

  const retained = { id: "retained", appProperties: { app: "polyask", schema: "1", kind: "state", id: "retained" } };
  const unknownRemoval = runtime({ listed: [retained], changes: [{ fileId: "unknown", removed: true }], bodies: { retained: { schema: 1, deviceId: "retained", settings: {} } } });
  await unknownRemoval.sync.connect();
  assert.deepEqual(unknownRemoval.seeds, [false], "未知 removal 不得把仍有 PolyAsk 文件的云端误判为空");

  const future = { id: "future", appProperties: { app: "polyask", schema: "2", kind: "state", id: "future" } };
  const futureRemoval = runtime({ listed: [future], changes: [{ fileId: "future", removed: true }] });
  await futureRemoval.sync.connect(); assert.deepEqual(futureRemoval.seeds, [true], "高 schema 文件随后 removal 时云端应判空");
  const invalidRemoval = runtime({ listed: [{ id: "invalid", appProperties: { app: "polyask", schema: "1", kind: "history", id: "invalid", device: "d" } }],
    changes: [{ fileId: "invalid", removed: true }], bodies: { invalid: { schema: 1 } } });
  await invalidRemoval.sync.connect(); assert.deepEqual(invalidRemoval.seeds, [true], "损坏正文随后 removal 时云端应判空");
  const missingRemoval = runtime({ listed: [{ id: "missing", appProperties: { app: "polyask", schema: "1", kind: "state", id: "missing" } }],
    changes: [{ fileId: "missing", removed: true }], bodies: { missing: { throw: { code: "not_found", status: 404 } } } });
  await missingRemoval.sync.connect(); assert.deepEqual(missingRemoval.seeds, [true], "下载 404 后收到 removal 时云端应判空");
  const staleMapping = runtime({ listed: [future], indexed: [{ fileId: "future", logicalKey: "state:future" }] });
  await staleMapping.sync.connect();
  assert.equal(staleMapping.index.has("state:future"), false, "高 schema marker 不得保留旧 logicalKey 供 canonical 选择");
  assert.ok([...staleMapping.index.values()].some((file) => file.fileId === "future" && !file.logicalKey), "高 schema 文件只保留无 logicalKey 的扫描 marker");
  const prunedMarker = runtime({ indexed: [{ fileId: "stale", seenAt: "old" }] });
  await prunedMarker.sync.connect(); assert.equal(prunedMarker.index.size, 0, "下轮全量扫描必须清除未再出现的 marker");
  const clearedMarker = runtime({ indexed: [{ fileId: "stale", seenAt: "old" }] });
  await clearedMarker.sync.disconnect(); assert.equal(clearedMarker.index.size, 0, "清缓存必须删除无 logicalKey marker");

  const old = { id: "old", appProperties: { app: "polyask", schema: "1", kind: "state", id: "old" } };
  const newer = { id: "new", appProperties: { app: "polyask", schema: "1", kind: "state", id: "new" } };
  const lww = runtime({ listed: [old], bodies: { old: { schema: 1, deviceId: "old", settings: { amsTheme: { value: "light", updatedAt: 1, deviceId: "a" } } }, new: { schema: 1, deviceId: "new", settings: { amsTheme: { value: "dark", updatedAt: 2, deviceId: "b" } } } } });
  await lww.sync.connect(); lww.setChanges([{ file: newer }]); await lww.sync.runNow();
  assert.equal(lww.applied.at(-1).settings.amsTheme.value, "dark", "增量 state 必须与已有碎片一起 LWW");
  lww.setChanges([{ fileId: "new", removed: true }]); await lww.sync.runNow();
  assert.equal(lww.applied.at(-1).settings.amsTheme.value, "light", "删除 state 碎片后必须重算完整 LWW 集合");

  const tomb = { schema: 1, id: "a", createdAt: 1, updatedAt: 3, deletedAt: 3, deviceId: "z" };
  const archive = runtime({ listed: [{ id: "arc", appProperties: { app: "polyask", schema: "1", kind: "archive", id: "a" } }], bodies: { arc: tomb }, localArchives: [{ id: "a", createdAt: 1, updatedAt: 1, text: "live", deviceId: "a" }] });
  await archive.sync.connect();
  assert.equal(archive.imports.at(-1).archives[0].deletedAt, 3, "远端 tombstone 必须覆盖本地 active 记录");

  const liveFiles = ["one", "two"].map((id) => ({ id: `file-${id}`, appProperties: { app: "polyask", schema: "1", kind: "archive", id } }));
  const live = runtime({ listed: liveFiles, bodies: { "file-one": liveArchive("one"), "file-two": liveArchive("two") } });
  await live.sync.connect();
  assert.equal(live.imports.length, 2, "同批有效 Drive 归档必须全部导入");
  assert.deepEqual(JSON.parse(JSON.stringify(live.broadcasts)), [{ source: "AMS_DATA", type: "archiveChanged" }], "同批归档变化只能发送一次无 token 广播");
  const unchanged = runtime({ listed: [liveFiles[0]], bodies: { "file-one": liveArchive("one") }, archiveImportChanged: false });
  await unchanged.sync.connect(); assert.deepEqual(unchanged.broadcasts, [], "未实际写入归档时不得广播");
  const incomplete = liveArchive("missing"); delete incomplete.synthesis;
  const invalidLive = runtime({ listed: [{ id: "file-missing", appProperties: { app: "polyask", schema: "1", kind: "archive", id: "missing" } }], bodies: { "file-missing": incomplete } });
  await invalidLive.sync.connect();
  assert.equal(invalidLive.imports.length, 0, "缺少当前元数据的 Drive live 归档必须隔离");
  assert.equal((await invalidLive.sync.status()).errorCount, 1, "损坏 Drive live 归档必须计错");

  const waiting = runtime({ queued: [{ key: "archive:h", kind: "archive", entityId: "h", nextAt: 0, attempt: 0 }], localArchives: [{ id: "h", text: "x" }], fail: true });
  await waiting.sync.connect();
  assert.equal((await waiting.sync.status()).state, "waiting", "429/5xx 退避后状态必须是 waiting");
  assert.equal(waiting.outbox.get("archive:h").attempt, 1);

  const offline = runtime({ listed: [added], bodies: { remote: { throw: { code: "network_error" } } }, queued: [{ key: "archive:h", kind: "archive", entityId: "h", nextAt: 0 }] });
  await offline.sync.connect();
  assert.equal((await offline.sync.status()).state, "offline", "下载网络失败必须中止本轮同步");
  assert.equal(offline.seeds.length, 0); assert.equal(offline.calls.some((call) => call.startsWith("upload:")), false);
  assert.equal(offline.outbox.has("archive:h"), true);

  const malformed = runtime({ listed: [{ id: "bad", appProperties: { app: "polyask", schema: "1", kind: "history", id: "bad", device: "d" } }], bodies: { bad: { schema: 1 } } });
  await malformed.sync.connect();
  assert.equal((await malformed.sync.status()).errorCount, 1, "缺少 history 正文的文件必须隔离计错");
  assert.equal(malformed.index.has("history:bad:d"), false, "损坏文件的 marker 不得进入 logicalKey 索引");

  const combined = runtime({ listed: [added], bodies: { remote: { schema: 1, deviceId: "remote", settings: { amsTheme: { value: "dark", updatedAt: 2 } }, templates: { remote: { id: "remote", updatedAt: 2 } } } }, device: { settings: { amsTheme: { value: "light", updatedAt: 1 } }, templates: { local: { id: "local", updatedAt: 1 } } } });
  await combined.sync.connect();
  assert.equal(combined.applied.at(-1).settings.amsTheme.value, "dark", "首次本机旧设置不得覆盖远端设置");
  assert.deepEqual(combined.applied.at(-1).templates.map((item) => item.id).sort(), ["local", "remote"], "本机与远端模板必须并存");

  const reconnect = runtime({ listed: [added], bodies: { remote: { schema: 1, deviceId: "remote", settings: {} } }, device: { settings: { amsTheme: { value: "pending", updatedAt: 5 } } }, goneOnce: true });
  reconnect.meta.set("pageToken", "expired"); await reconnect.sync.connect();
  assert.equal(reconnect.deviceState().settings.amsTheme.value, "pending", "410 重扫不得清除本机待上传设置");

  const own = runtime({ listed: [{ id: "own", appProperties: { app: "polyask", schema: "1", kind: "state", id: "device" } }], bodies: { own: { schema: 1, deviceId: "device", settings: { amsTheme: { value: "cloud", updatedAt: 2 } } } }, device: { settings: { amsTheme: { value: "old", updatedAt: 1 } } } });
  await own.sync.connect(); own.outbox.set("state", { key: "state", kind: "state", nextAt: 0, attempt: 0 }); await own.sync.runNow();
  assert.equal(own.uploads.at(-1).settings.amsTheme.value, "cloud", "同设备远端 state 的设置不得在重连上传时丢失");
  const beforeNoise = own.notes(); own.change({ amsSyncStatus: { newValue: {} } }); await Promise.resolve();
  assert.equal(own.notes(), beforeNoise, "非同步白名单 storage 变更不得访问 Data/IDB");

  const changedState = { id: "same", appProperties: { app: "polyask", schema: "1", kind: "state", id: "device" } };
  const replacement = runtime({ listed: [changedState], changes: [{ file: changedState }], bodies: { same: [
    { schema: 1, deviceId: "device", settings: { amsTheme: { value: "old", updatedAt: 1 } } },
    { schema: 1, deviceId: "device", settings: { amsTheme: { value: "new", updatedAt: 2 } } },
  ] } });
  await replacement.sync.connect(); replacement.outbox.set("state", { key: "state", kind: "state", nextAt: 0 }); await replacement.sync.runNow();
  assert.equal(replacement.uploads.at(-1).settings.amsTheme.value, "new", "changes 中同 fileId 的新 state 必须覆盖扫描旧 state");

  const mismatch = runtime({ listed: [{ id: "h", appProperties: { app: "polyask", schema: "1", kind: "history", id: "h", device: "d" } }], bodies: { h: { schema: 1, id: "h", textHash: "wrong", text: "text", createdAt: 1, lastUsedAt: 1, deviceId: "d" } } });
  await mismatch.sync.connect(); assert.equal(mismatch.index.has("history:h:d"), false, "正文 hash/身份错配不得建立 logicalKey 索引");
  const resolveError = runtime({ localHistory: [{ id: "h", textHash: "h", text: undefined, fileId: "f", deviceId: "d" }], bodies: { f: { throw: { code: "network_error" } } } });
  await assert.rejects(resolveError.sync.resolveHistory("h"), (error) => error.code === "network_error", "resolver 必须透传 Drive 网络错误");

  const cleared = runtime();
  await cleared.sync.connect(); await cleared.sync.clearRemote();
  assert.equal(cleared.local.get("amsSyncConfig").clearRunning, false, "成功清理后才结束 clearRunning");
  assert.deepEqual(cleared.calls.slice(-3), ["progress:1", "clear", "disconnect"]);
  const failedClear = runtime({ clearFail: true });
  await failedClear.sync.connect(); await assert.rejects(failedClear.sync.clearRemote());
  assert.equal(failedClear.local.get("amsSyncConfig").clearRunning, true, "清除失败必须保留 clearRunning");
  assert.equal(failedClear.calls.includes("disconnect"), false);
  const resumed = runtime(); resumed.local.set("amsSyncConfig", { connected: true, clearRunning: true, clearProgress: 3 });
  await resumed.sync.clearRemote(); assert.equal(resumed.local.get("amsSyncConfig").clearProgress, 4, "中断后重试必须沿用清理进度");
  await resumed.sync.clearRemote(); assert.equal(resumed.local.get("amsSyncConfig").clearProgress, 1, "成功后的新清理必须从零开始");
  const authClear = runtime({ clearAuthOnce: true });
  await authClear.sync.connect(); await assert.rejects(authClear.sync.clearRemote(), (error) => error.code === "unauthorized");
  assert.equal((await authClear.sync.status()).state, "auth", "清云端鉴权失败必须持久化 auth 状态");
  assert.equal(authClear.local.get("amsSyncConfig").clearRunning, true, "鉴权失败必须保留 clearRunning 以便续跑");
  await authClear.sync.clearRemote();
  assert.deepEqual(authClear.auths, [true, true], "鉴权失败后的继续清理必须重新交互授权");
  assert.equal(authClear.local.get("amsSyncConfig").clearRunning, false);
  assert.equal(authClear.local.get("amsSyncConfig").readOnly, false);
};
