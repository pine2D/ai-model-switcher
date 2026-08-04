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
  const context = vm.createContext({ chrome, Date: { now: () => now }, setTimeout, clearTimeout, URL, console,
    getWindows: async () => ({}), popupWindowForHost: async () => null, consoleIsMinimized: async () => true,
    openTile: async () => [], tabsForHost: async () => [], getAutoRaise: async () => false, focusAll: async () => {}, raiseConsole: async () => {}, minimizeAllManaged: async () => {} });
  vm.runInContext(source("bg/broadcast.js"), context);
  await vm.runInContext('sendAll([], "Full prompt", "think", false, 0, [], { task: "Question", source: null })', context);
  assert.deepEqual(plain(saved.amsLastRun), { text: "Full prompt", task: "Question", source: null, hosts: [], tier: "think", sentAt: now });
  assert.equal(pushed.find((item) => item.type === "sendStart").task, "Question");
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
function archiveCaptureUsesMatchingRun() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  let selected = { a: true }, prompt = "Fallback task", added = [];
  const run = { text: "Full prompt", task: "Question", source: { kind: "page", title: "Source", url: "https://example.test", truncated: false, capturedAt: 1 }, hosts: ["a"], tier: "think", sentAt: 2 };
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.source === "AMS_CONSOLE") return done({ results: [{ host: message.sites[0].host, text: "Answer" }] });
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
  selected = { b: true }; prompt = "Fallback task";
  els["ar-capture"].listeners.click[0]({ currentTarget: els["ar-capture"] });
  assert.equal(added[1].task, "Fallback task");
  assert.equal(added[1].source, null);
}

function summaryKeepsRunMetadata() {
  let receive, added;
  const elements = Object.fromEntries(["failsum", "live", "send", "retry"].map((id) => [id, new El()]));
  const chrome = { runtime: { lastError: null, onMessage: { addListener(fn) { receive = fn; } }, sendMessage(message, done) {
    if (message.action === "archiveAdd") added = message.entry;
    done?.({ ok: true });
  } } };
  const context = { chrome, document: { documentElement: {}, getElementById: (id) => elements[id], querySelector: () => null, querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: () => Promise.resolve() } }, t: (key) => key, setTimeout, clearTimeout, Date, Map, console };
  vm.runInNewContext(source("console/status.js"), context);
  const sourceMeta = { kind: "selection", title: "Source", url: "https://example.test", truncated: false, capturedAt: 3 };
  receive({ from: "AMS_BG", type: "sendStart", hosts: ["a"], text: "Full prompt", task: "Question", source: sourceMeta, tier: "think", hasImage: false });
  context.archiveSummary([{ host: "a", label: "A" }], [{ host: "a", text: "Answer" }], "Full prompt");
  assert.equal(added.text, "Full prompt");
  assert.equal(added.task, "Question");
  assert.deepEqual(plain(added.source), sourceMeta);
}

function sourcesForwardRunMetadata() {
  assert.match(source("background.js"), /sendAll\([^\n]*msg\.images \|\| \[\], msg\.run \|\| \{\}\)/, "后台必须将 run 传入广播层");
  for (const file of ["console/console.js", "console/compose.js"])
    assert.match(source(file), /run:\s*\{\s*task:\s*text,\s*source:\s*null\s*\}/, `${file} 必须发送普通提示词元数据`);
  assert.match(source("console/archive.js"), /storage\.session\.get\([^\n]*amsLastRun/, "归档捕获必须读取本轮运行元数据");
}

(async () => {
  await preservesRunMetadata();
  await staleRunDoesNotReplaceMetadata();
  archiveCaptureUsesMatchingRun();
  summaryKeepsRunMetadata();
  sourcesForwardRunMetadata();
  console.log("archive capture metadata tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
