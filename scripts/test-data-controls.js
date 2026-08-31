#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

const history = [{ id: "h1" }, { id: "h2", deletedAt: 2 }], archives = [{ id: "a1" }, { id: "a2", deletedAt: 2 }];
const deleted = [], events = [], localRemovals = [], sessionRemovals = [];
let listener;
const SyncStore = {
  iterate: async (kind, visit) => { for (const row of kind === "history" ? history : archives) await visit(row); },
  clearLocalData: async () => events.push("clear-db"),
};
const Data = {
  deleteHistory: async (id) => deleted.push(`history:${id}`),
  deleteArchive: async (id) => deleted.push(`archive:${id}`),
  resetDeviceId: () => events.push("reset-device"),
};
const SyncEngine = { disconnect: async () => events.push("disconnect") };
const chrome = { storage: {
  local: { remove: async (keys) => localRemovals.push(...keys) },
  session: { remove: async (keys) => sessionRemovals.push(...keys) },
}, runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: (message) => events.push(message.type) } };
const scope = vm.createContext({ SyncStore, Data, SyncEngine, chrome });
vm.runInContext(fs.readFileSync("bg/data-admin.js", "utf8") + ";this.admin=DataAdmin", scope);

// 受管窗口登记：有意不进重置清单（重置不得破坏当前打开的窗口，理由同下方断言）。
const WINDOW_REGISTRY_EXEMPT = new Map([
  ["amsWindows", "受管窗口登记，重置不得破坏当前受管窗口"],
  ["amsConsoleWin", "受管窗口登记，重置不得破坏当前受管窗口"],
  ["amsComposeWin", "受管窗口登记，重置不得破坏当前受管窗口"],
  ["amsScopeWin", "受管窗口登记，重置不得破坏当前受管窗口"],
  ["amsArchiveWin", "受管窗口登记，重置不得破坏当前受管窗口"],
]);
const SCAN_ROOTS = ["bg", "console", "popup", "options", "content", "background.js"];
function scanAmsLiterals(roots) {
  const files = [], found = new Set();
  for (const root of roots) {
    if (root.endsWith(".js")) { files.push(root); continue; }
    for (const name of fs.readdirSync(root)) if (name.endsWith(".js")) files.push(`${root}/${name}`);
  }
  for (const file of files) for (const [, key] of fs.readFileSync(file, "utf8").matchAll(/"(ams[A-Za-z0-9]+)"/g)) found.add(key);
  return found;
}

const send = (action) => new Promise((resolve) => listener({ source: "AMS_DATA_ADMIN", action }, null, resolve));
(async () => {
  assert.equal((await send("clearHistory")).count, 1);
  assert.equal((await send("clearArchives")).count, 1);
  assert.deepEqual(deleted, ["history:h1", "archive:a1"]);
  assert.ok(events.includes("historyChanged") && events.includes("archiveChanged"));
  const reset = await send("resetLocal"); assert.equal(reset.ok, true);
  assert.deepEqual(events.slice(-5), ["disconnect", "clear-db", "reset-device", "historyChanged", "archiveChanged"]);
  assert.ok(localRemovals.includes("amsTheme") && localRemovals.includes("amsSyncConfig"));
  assert.ok(localRemovals.includes("displayMode"), "displayMode 无 ams 前缀、不进入下方字面量扫描，需单独断言登记");
  assert.ok(!localRemovals.includes("amsConsoleWin") && !localRemovals.includes("amsArchiveWin"), "重置不得破坏当前受管窗口登记");
  assert.ok(sessionRemovals.includes("amsComposeContext") && sessionRemovals.includes("amsPendingSynthesis"));
  assert.match(fs.readFileSync("bg/sync.js", "utf8"), /DataAdmin\?\.resetting/, "重置移除设置时不得重新生成同步 outbox");

  // 全仓 "ams*" 字面量与重置清单对账：新增持久化键漏登记（LOCAL_KEYS/SESSION_KEYS/受管窗口豁免表）时在此现形。
  const registered = new Set([...localRemovals, ...sessionRemovals, ...WINDOW_REGISTRY_EXEMPT.keys()]);
  for (const key of scanAmsLiterals(SCAN_ROOTS))
    assert.ok(registered.has(key), `ams* 键未登记：${key} 既不在 LOCAL_KEYS/SESSION_KEYS，也不在受管窗口豁免表`);
  console.log("data-controls tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
