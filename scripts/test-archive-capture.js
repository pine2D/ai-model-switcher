#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = (file) => fs.readFileSync(file, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function preservesRunMetadata() {
  const saved = {}, pushed = [], now = 1720000000000;
  const chrome = {
    runtime: { lastError: null, sendMessage(message, done) { pushed.push(message); done?.(); } },
    storage: { session: { set: async (value) => Object.assign(saved, value) } },
  };
  const context = vm.createContext({ chrome, crypto: { randomUUID: () => "new-run" }, Date: { now: () => now }, setTimeout, clearTimeout, URL, console,
    getWindows: async () => ({}), popupWindowForHost: async () => null, consoleIsMinimized: async () => true,
    openTile: async () => [], tabsForHost: async () => [], getAutoRaise: async () => false, focusAll: async () => {}, raiseConsole: async () => {}, minimizeAllManaged: async () => {} });
  vm.runInContext(source("bg/broadcast.js"), context);
  await vm.runInContext('sendAll([], "Full prompt", "think", false, 0, [], { task: "Question", source: null })', context);
  assert.deepEqual(plain(saved.amsLastRun), { runId: "new-run", text: "Full prompt", task: "Question", source: null, hosts: [], tier: "think", sentAt: now });
  assert.deepEqual(plain(pushed.find((item) => item.type === "sendStart").run), plain(saved.amsLastRun));
}

async function retryKeepsLogicalRun() {
  const saved = {}, pushed = [];
  const chrome = { runtime: { lastError: null, sendMessage(message, done) { pushed.push(message); done?.(); } }, storage: { session: { set: async (value) => Object.assign(saved, value) } } };
  const context = vm.createContext({ chrome, Date: { now: () => 99 }, setTimeout, clearTimeout, URL, console,
    getWindows: async () => ({}), popupWindowForHost: async () => null, consoleIsMinimized: async () => true,
    openTile: async () => [], tabsForHost: async () => [], getAutoRaise: async () => false, focusAll: async () => {}, raiseConsole: async () => {}, minimizeAllManaged: async () => {} });
  vm.runInContext(source("bg/broadcast.js"), context);
  await vm.runInContext('sendAll([{host:"b"}], "Prompt", "think", false, 0, [], { runId: "run-1", task: "Task", source: null, hosts: ["a", "b"], tier: "fast", sentAt: 7 })', context);
  assert.deepEqual(plain(saved.amsLastRun), { runId: "run-1", text: "Prompt", task: "Task", source: null, hosts: ["a", "b"], tier: "fast", sentAt: 7 });
  assert.deepEqual(plain(pushed.find((item) => item.type === "sendStart").hosts), ["b"]);
}

async function staleRunDoesNotReplaceMetadata() {
  let sets = 0;
  const pushed = [];
  const chrome = {
    runtime: { lastError: null, sendMessage(message, done) { pushed.push(message); done?.(); } },
    storage: { session: { set: async () => { sets++; } } },
  };
  const context = vm.createContext({ chrome, Date, setTimeout, clearTimeout, URL, console });
  vm.runInContext(source("bg/broadcast.js"), context);
  await vm.runInContext('sendAll([], "Stale prompt", "think", false, 1, [], { task: "Stale task", source: null })', context);
  assert.equal(sets, 0, "过期请求不得覆盖 amsLastRun");
  assert.equal(pushed.some((item) => item.type === "sendStart"), false, "过期请求不得开始进度广播");
}

class El {
  constructor() { this.disabled = this.hidden = false; this.textContent = ""; this.style = {}; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute() {} replaceChildren() {} appendChild() {} append() {} click() {}
}
function archiveCaptureUsesRunIdentity() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  let selected = { a: true }, prompt = "Fallback task", added = [];
  const run = { runId: "run-1", text: "Full prompt", task: "Question", source: { kind: "page", title: "Source", url: "https://example.test", truncated: false, capturedAt: 1 }, hosts: ["a"], tier: "think", sentAt: 2 };
  let collectRunId, stale = false;
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.source === "AMS_CONSOLE") { collectRunId = message.runId; return done(stale ? { results: [], code: "stale_run" } : { results: [{ host: message.sites[0].host, text: "Answer" }] }); }
      if (message.action === "archiveAdd") { added.push(message.entry); return done({ ok: true, record: { id: String(added.length) } }); }
      done({ ok: true, items: [] });
    } },
    storage: {
      local: { get(_keys, done) { done({ amsConsole: { selected }, amsConsolePrompt: prompt }); } },
      session: { get(_key, done) { done({ amsLastRun: run }); } },
    },
  };
  const context = { chrome, document: { documentElement: {}, getElementById: (id) => els[id], addEventListener() {}, createElement: () => new El(), createTextNode: () => new El() },
    URL: { createObjectURL() {}, revokeObjectURL() {} }, Blob, SITES: [{ host: "a", label: "A" }, { host: "b", label: "B" }], t: (key) => key, applyI18n() {}, setTimeout, Date };
  vm.runInNewContext(source("console/archive.js"), context);
  els["ar-capture"].listeners.click[0]({ currentTarget: els["ar-capture"] });
  assert.deepEqual(plain(added[0]), { ts: added[0].ts, text: "Full prompt", task: "Question", source: run.source,
    results: [{ host: "a", label: "A", text: "Answer", state: null, code: null }] });
  assert.equal(collectRunId, "run-1", "采集请求必须携带稳定运行身份");
  stale = true; run.runId = "run-2";
  els["ar-capture"].listeners.click[0]({ currentTarget: els["ar-capture"] });
  assert.equal(added.length, 1, "同 host 的新运行不得保存旧采集回调");
  stale = false;
  run.runId = null; prompt = "Fallback task";
  els["ar-capture"].listeners.click[0]({ currentTarget: els["ar-capture"] });
  assert.equal(added[1].task, "Fallback task");
  assert.equal(added[1].source, null);
}

function delayedSummaryKeepsClickedRun() {
  let receive, added;
  const elements = Object.fromEntries(["failsum", "live", "send", "retry"].map((id) => [id, new El()]));
  const chrome = { runtime: { lastError: null, onMessage: { addListener(fn) { receive = fn; } }, sendMessage(message, done) {
    if (message.action === "archiveAdd") added = message.entry;
    done?.({ ok: true });
  } } };
  const context = { chrome, document: { documentElement: {}, getElementById: (id) => elements[id], querySelector: () => null, querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: () => Promise.resolve() } }, t: (key) => key, setTimeout: () => 0, clearTimeout: () => {}, Date, Map, console };
  vm.runInNewContext(source("console/status.js"), context);
  const sourceMeta = { kind: "selection", title: "Source", url: "https://example.test", truncated: false, capturedAt: 3 };
  const run = { runId: "run-1", text: "Full prompt", task: "Question", source: sourceMeta, hosts: ["a"], tier: "think", sentAt: 1 };
  receive({ from: "AMS_BG", type: "sendStart", hosts: ["a"], run, text: run.text, task: run.task, source: run.source, tier: run.tier, hasImage: false });
  receive({ from: "AMS_BG", type: "sendStart", hosts: ["a"], run: { ...run, runId: "run-2", text: "New prompt", task: "New task" }, text: "New prompt", task: "New task", source: null, tier: "fast", hasImage: false });
  context.archiveSummary([{ host: "a", label: "A" }], [{ host: "a", text: "Answer" }], "Full prompt", run);
  assert.equal(added.text, "Full prompt");
  assert.equal(added.task, "Question");
  assert.deepEqual(plain(added.source), sourceMeta);
}

async function collectRejectsRunThatChangesDuringRead() {
  let receive, response, resolveCollect, currentRun = "run-1", epoch = 0;
  const chrome = {
    runtime: { lastError: null, onStartup: { addListener() {} }, onMessage: { addListener(fn) { receive = fn; } }, sendMessage() {} },
    commands: { onCommand: { addListener() {} } }, windows: { onRemoved: { addListener() {} } },
    storage: { session: { get(_key, done) { done({ amsLastRun: { runId: currentRun } }); } }, local: {} },
  };
  const context = vm.createContext({ chrome, importScripts() {}, console, Date, setTimeout, clearTimeout,
    currentSendEpoch: () => epoch, cancelPendingSends: () => { epoch++; }, collectAll: () => new Promise((resolve) => { resolveCollect = resolve; }) });
  vm.runInContext(source("background.js"), context);
  receive({ source: "AMS_CONSOLE", action: "collect", runId: "run-1", sites: [{ host: "a" }] }, null, (value) => { response = value; });
  await new Promise((resolve) => setTimeout(resolve, 0)); currentRun = "run-2"; resolveCollect([{ host: "a", text: "old" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plain(response), { results: [], code: "stale_run" });
}

async function collectRejectsNullIdentityAndCancellation() {
  let receive, response, resolveCollect, currentRun = null, epoch = 0;
  const chrome = {
    runtime: { lastError: null, onStartup: { addListener() {} }, onMessage: { addListener(fn) { receive = fn; } }, sendMessage() {} },
    commands: { onCommand: { addListener() {} } }, windows: { onRemoved: { addListener() {} } },
    storage: { session: { get(_key, done) { done({ amsLastRun: currentRun && { runId: currentRun } }); } }, local: {} },
  };
  const context = vm.createContext({ chrome, importScripts() {}, console, Date, setTimeout, clearTimeout,
    currentSendEpoch: () => epoch, cancelPendingSends: () => { epoch++; }, collectAll: () => new Promise((resolve) => { resolveCollect = resolve; }) });
  vm.runInContext(source("background.js"), context);
  receive({ source: "AMS_CONSOLE", action: "collect", runId: null, sites: [{ host: "a" }] }, null, (value) => { response = value; });
  await new Promise((resolve) => setTimeout(resolve, 0)); currentRun = "run-2"; resolveCollect([{ host: "a", text: "old" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plain(response), { results: [], code: "stale_run" }, "无运行快照也必须拒绝期间出现的新运行");
  currentRun = "run-2"; response = null;
  receive({ source: "AMS_CONSOLE", action: "collect", runId: "run-2", sites: [{ host: "a" }] }, null, (value) => { response = value; });
  await new Promise((resolve) => setTimeout(resolve, 0)); context.cancelPendingSends(); resolveCollect([{ host: "a", text: "old" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plain(response), { results: [], code: "stale_run" }, "取消先于 session 清理时也必须拒绝旧采集");
}

async function sessionsClearRun() {
  const removed = [];
  const chrome = { storage: { session: { remove: async (key) => removed.push(key) } }, runtime: { lastError: null, sendMessage() {} } };
  const context = vm.createContext({ chrome, Date, setTimeout, clearTimeout, URL, console,
    getWindows: async () => ({}), tabsForHost: async () => [], pushBroadcast() {} });
  vm.runInContext(source("bg/broadcast.js"), context);
  await vm.runInContext('newSessionAll([{host:"a",url:"https://a.test/new"}])', context);
  assert.deepEqual(removed, ["amsLastRun"], "新会话必须清除当前运行");
}

async function closeAllClearsRun() {
  const removed = [];
  const chrome = {
    runtime: { lastError: null, sendMessage(_message, done) { done?.(); } }, windows: {},
    storage: {
      session: { get(_key, done) { done({ amsWindows: {} }); }, set(_value, done) { done?.(); }, remove: async (key) => removed.push(key) },
      local: { get(_key, done) { done({}); } },
    },
  };
  const context = vm.createContext({ chrome, Date, setTimeout, clearTimeout, URL, console, consoleWinId: null, composeWinId: null, scopeWinId: null, archiveWinId: null,
    getScopeWinId: async () => null });
  vm.runInContext(source("bg/broadcast.js"), context);
  vm.runInContext(source("bg/windows.js"), context);
  await vm.runInContext("closeAll()", context);
  assert.deepEqual(removed, ["amsLastRun"], "关闭工作区必须清除当前运行");
}

(async () => {
  await preservesRunMetadata();
  await retryKeepsLogicalRun();
  await staleRunDoesNotReplaceMetadata();
  archiveCaptureUsesRunIdentity();
  delayedSummaryKeepsClickedRun();
  await collectRejectsRunThatChangesDuringRead();
  await collectRejectsNullIdentityAndCancellation();
  await sessionsClearRun();
  await closeAllClearsRun();
  console.log("archive capture metadata tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
