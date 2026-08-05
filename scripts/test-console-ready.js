#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const consoleUrl = "chrome-extension://polyask/console/console.html";
async function waitFor(check) {
  for (let tries = 0; tries < 20; tries++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("listener_not_registered");
}

function events() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
    get size() { return listeners.size; },
  };
}

function harness({ existing = false, missing = false, completeOnGet = false, onGet = {} } = {}) {
  const updated = events(), removed = events();
  const windows = new Map(existing ? [[7, { id: 7, type: "popup" }]] : []);
  const tabs = new Map(existing ? [[41, { id: 41, windowId: 7, url: consoleUrl, status: "complete" }]] : []);
  const createdWindowId = 8, consoleTabId = 42;
  let storedWindowId = existing ? 7 : 7;
  const chrome = {
    runtime: { lastError: null, getURL: (file) => `chrome-extension://polyask/${file}` },
    storage: {
      local: {
        get: (_key, done) => done({ amsConsoleWin: storedWindowId }),
        set: async (value) => { if (value.amsConsoleWin != null) storedWindowId = value.amsConsoleWin; },
      },
      session: { get: (_key, done) => done({}), set: (_value, done) => done() },
    },
    system: { display: { getInfo: async () => [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1280, height: 800 } }] } },
    windows: {
      get: async (id) => {
        const window = windows.get(id);
        if (!window) throw new Error("missing_window");
        return window;
      },
      update: async (id, props) => Object.assign(await chrome.windows.get(id), props),
      create: async () => {
        const window = { id: createdWindowId, type: "popup" };
        windows.set(window.id, window);
        if (!missing) tabs.set(consoleTabId, { id: consoleTabId, windowId: window.id, pendingUrl: consoleUrl, status: "loading" });
        return window;
      },
    },
    tabs: {
      query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.windowId === windowId),
      get: async (id) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("missing_tab");
        return completeOnGet ? { ...tab, status: "complete", ...onGet } : tab;
      },
      onUpdated: updated,
      onRemoved: removed,
    },
  };
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, consoleWinId: null, composeWinId: null, archiveWinId: null });
  vm.runInContext(source("bg/windows.js"), context);
  return {
    call: (expression) => vm.runInContext(expression, context), updated, removed, createdWindowId, consoleTabId,
    setConsoleTab: (props) => Object.assign(tabs.get(consoleTabId), props),
  };
}

async function testConsoleReadiness() {
  const complete = harness({ existing: true });
  assert.equal(await complete.call("ensureConsoleReady('', 20)"), 7, "complete 的既有控制台应立即返回");

  const waitingHarness = harness();
  let settled = false;
  const waiting = waitingHarness.call("ensureConsoleReady('', 50)").then((value) => { settled = true; return value; });
  await waitFor(() => waitingHarness.updated.size === 1);
  waitingHarness.updated.emit(999, { status: "complete" });
  assert.equal(settled, false, "无关标签页不得解除等待");
  waitingHarness.updated.emit(waitingHarness.consoleTabId, { status: "complete" });
  waitingHarness.updated.emit(waitingHarness.consoleTabId, { status: "complete" });
  assert.equal(await waiting, waitingHarness.createdWindowId);
  assert.equal(waitingHarness.updated.size, 0); assert.equal(waitingHarness.removed.size, 0);

  const raced = harness({ completeOnGet: true });
  assert.equal(await raced.call("ensureConsoleReady('', 20)"), raced.createdWindowId, "监听注册后的复查必须捕获完成竞态");
  assert.equal(raced.updated.size, 0); assert.equal(raced.removed.size, 0);

  const navigated = harness();
  const leftConsole = navigated.call("ensureConsoleReady('', 50)");
  await waitFor(() => navigated.updated.size === 1);
  navigated.setConsoleTab({ url: "chrome-extension://polyask/console/compose.html", pendingUrl: undefined, status: "complete" });
  navigated.updated.emit(navigated.consoleTabId, { status: "complete" });
  await assert.rejects(leftConsole, /console_missing/, "同一标签离开控制台 URL 后不得误报 ready");
  assert.equal(navigated.updated.size, 0); assert.equal(navigated.removed.size, 0);

  const rereadNavigated = harness({ completeOnGet: true, onGet: { url: "chrome-extension://polyask/console/compose.html", pendingUrl: undefined } });
  await assert.rejects(rereadNavigated.call("ensureConsoleReady('', 20)"), /console_missing/, "监听后的复查也必须验证精确控制台 URL");
  assert.equal(rereadNavigated.updated.size, 0); assert.equal(rereadNavigated.removed.size, 0);

  const timeout = harness();
  await assert.rejects(timeout.call("ensureConsoleReady('', 5)"), /console_timeout/);
  assert.equal(timeout.updated.size, 0); assert.equal(timeout.removed.size, 0, "失败也必须清理监听器");

  const closedHarness = harness();
  const closed = closedHarness.call("ensureConsoleReady('', 50)");
  await waitFor(() => closedHarness.removed.size === 1);
  closedHarness.removed.emit(closedHarness.consoleTabId);
  await assert.rejects(closed, /console_closed/);
  assert.equal(closedHarness.updated.size, 0); assert.equal(closedHarness.removed.size, 0);

  const missing = harness({ missing: true });
  await assert.rejects(missing.call("ensureConsoleReady('', 20)"), /console_missing/);
  assert.equal(missing.updated.size, 0); assert.equal(missing.removed.size, 0, "缺少标签页也不得遗留监听器");
}

function testBackgroundReadinessContract() {
  const background = source("background.js");
  assert.ok(background.includes('"bg/windows.js"'), "background 必须导入定义 readiness helper 的窗口模块");
  const branch = background.match(/if \(msg\.action === "openConsole"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(branch.includes("ensureConsoleReady(msg.host)"), "openConsole 消息必须等待控制台就绪");
  assert.ok(branch.includes("sendResponse"), "openConsole 消息必须异步响应");
  assert.ok(branch.includes("return true"), "openConsole 消息必须保持响应通道");
}

(async () => {
  await testConsoleReadiness();
  testBackgroundReadinessContract();
  console.log("[console-ready] 控制台就绪等待通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
