#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const listeners = { installed: [], startup: [], changed: [], clicked: [] };
const event = (name) => ({ addListener(fn) { listeners[name].push(fn); } });
const plain = (value) => JSON.parse(JSON.stringify(value));

let language = "auto";
let uiLanguage = "zh-TW";
let removed = 0;
let opened = 0;
let saved = {};
let pageDocument = { querySelector: () => null, body: { innerText: "page body" } };
const created = [];
const executions = [];
const sessionWrites = [];
const menus = new Map();
const menuOps = [];
const failNext = { get: null, create: null, session: null, execute: null };
let delayMenus = false;

function takeError(name) { const message = failNext[name]; failNext[name] = null; return message; }

function invokeCallback(callback, message, value) {
  chrome.runtime.lastError = message ? { message } : null;
  try { callback(value); } finally { chrome.runtime.lastError = null; }
}

function finishMenuOp(op) {
  if (op.type === "remove") {
    menus.clear();
    invokeCallback(op.callback, null);
    return;
  }
  const message = takeError("create") || (menus.has(op.item.id) ? `duplicate menu: ${op.item.id}` : null);
  if (!message) menus.set(op.item.id, op.item);
  invokeCallback(op.callback, message);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function driveConcurrentInstalls(first, second) {
  let settled = 0;
  first.then(() => { settled++; }, () => { settled++; });
  second.then(() => { settled++; }, () => { settled++; });
  let interleaved = false;
  for (let guard = 0; settled < 2 && guard < 30; guard++) {
    await tick();
    if (!interleaved && menuOps.filter((op) => op.type === "remove").length >= 2) {
      finishMenuOp(menuOps.splice(menuOps.findIndex((op) => op.type === "remove"), 1)[0]);
      await tick();
      finishMenuOp(menuOps.splice(menuOps.findIndex((op) => op.type === "create"), 1)[0]);
      finishMenuOp(menuOps.splice(menuOps.findIndex((op) => op.type === "remove"), 1)[0]);
      interleaved = true;
      continue;
    }
    if (menuOps.length) finishMenuOp(menuOps.shift());
  }
  assert.equal(settled, 2, "并发菜单安装应完成");
  await Promise.all([first, second]);
}

const chrome = {
  contextMenus: {
    removeAll(callback) {
      assert.equal(typeof callback, "function");
      removed++;
      const op = { type: "remove", callback };
      if (delayMenus) menuOps.push(op); else finishMenuOp(op);
    },
    create(item, callback) {
      assert.equal(typeof callback, "function");
      created.push(plain(item));
      const op = { type: "create", item: plain(item), callback };
      if (delayMenus) menuOps.push(op); else finishMenuOp(op);
      return item.id;
    },
    onClicked: event("clicked"),
  },
  i18n: { getUILanguage: () => uiLanguage },
  runtime: {
    lastError: null,
    onInstalled: event("installed"),
    onStartup: event("startup"),
  },
  scripting: {
    executeScript(options) {
      executions.push(options);
      const message = takeError("execute");
      if (message) return Promise.reject(new Error(message));
      const result = vm.runInNewContext(`(${options.func.toString()})()`, { document: pageDocument });
      return Promise.resolve([{ result }]);
    },
  },
  storage: {
    local: {
      get(defaults, callback) {
        assert.deepEqual(plain(defaults), { amsLang: "auto" });
        assert.equal(typeof callback, "function");
        const message = takeError("get");
        invokeCallback(callback, message, message ? undefined : { amsLang: language });
      },
    },
    session: {
      set(value, callback) {
        assert.equal(typeof callback, "function");
        const message = takeError("session");
        if (!message) {
          sessionWrites.push(plain(value));
          Object.assign(saved, plain(value));
        }
        invokeCallback(callback, message);
      },
    },
    onChanged: event("changed"),
  },
};

const context = vm.createContext({ chrome, console, Date, URL, openCompose: async () => { opened++; } });
vm.runInContext(source("bg/page-context.js"), context);
const PageContext = vm.runInContext("PageContext", context);

async function run() {
  const doc = (nodes = {}, body = "Body") => ({ querySelector: (selector) => nodes[selector] || null, body: { innerText: body } });
  assert.equal(PageContext.extractForTest(doc({ article: { innerText: " Article body " } })), "Article body");
  assert.equal(PageContext.extractForTest(doc({ main: { innerText: " Main body " }, '[role="main"]': { innerText: "Role body" } })), "Main body");
  assert.equal(PageContext.extractForTest(doc({ '[role="main"]': { innerText: " Role body " } })), "Role body");
  assert.equal(PageContext.extractForTest(doc({}, " Body fallback ")), "Body fallback");
  assert.equal(PageContext.extractForTest(doc({ article: { innerText: " A\r\nB\rC\n\n\n\nD " } })), "A\nB\nC\n\nD");
  const capped = PageContext.capText("a".repeat(24001) + "MIDDLE" + "z".repeat(6001));
  assert.equal([...capped.text].length, 30000);
  assert.equal(capped.text, "a".repeat(24000) + "z".repeat(6000));
  assert.equal(capped.truncated, true);

  assert.deepEqual(Object.fromEntries(Object.entries(listeners).map(([name, values]) => [name, values.length])), { installed: 1, startup: 1, changed: 1, clicked: 1 });

  await PageContext.installMenus();
  assert.deepEqual(created.map((item) => item.id), ["ams-send-selection", "ams-send-page"]);
  assert.deepEqual(created.map((item) => item.contexts), [["selection"], ["page"]]);
  assert.deepEqual(created.map((item) => item.documentUrlPatterns), [["http://*/*", "https://*/*"], ["http://*/*", "https://*/*"]]);
  assert.deepEqual(created.map((item) => item.title), ["用 PolyAsk 比較所選內容", "用 PolyAsk 比較目前網頁"]);

  language = "zh_CN";
  assert.equal(listeners.installed[0](), undefined);
  await tick();
  assert.deepEqual(created.slice(-2).map((item) => item.title), ["用 PolyAsk 比较所选内容", "用 PolyAsk 比较当前网页"]);
  language = "en";
  assert.equal(listeners.startup[0](), undefined);
  await tick();
  assert.deepEqual(created.slice(-2).map((item) => item.title), ["Compare selection with PolyAsk", "Compare this page with PolyAsk"]);
  language = "auto";
  uiLanguage = "zh-CN";
  assert.equal(listeners.changed[0]({ amsLang: { newValue: "auto" } }, "local"), undefined);
  await tick();
  assert.equal(removed, 4);
  assert.equal(created.length, 8);

  delayMenus = true;
  language = "en";
  const firstInstall = PageContext.installMenus();
  await tick();
  language = "zh_CN";
  const latestInstall = PageContext.installMenus();
  await driveConcurrentInstalls(firstInstall, latestInstall);
  delayMenus = false;
  assert.deepEqual([...menus.values()].map((item) => item.title), ["用 PolyAsk 比较所选内容", "用 PolyAsk 比较当前网页"]);
  assert.deepEqual(Object.fromEntries(Object.entries(listeners).map(([name, values]) => [name, values.length])), { installed: 1, startup: 1, changed: 1, clicked: 1 });

  failNext.get = "language read failed";
  await assert.rejects(PageContext.installMenus(), /language read failed/);
  failNext.create = "menu create failed";
  await assert.rejects(PageContext.installMenus(), /menu create failed/);

  saved.amsComposeContextError = "stale";
  await PageContext.handleClick({ menuItemId: "ams-send-selection", selectionText: " chosen text " },
    { id: 7, url: "https://example.com/a", title: "Example" });
  assert.equal(executions.length, 0);
  assert.equal(saved.amsComposeContext.text, "chosen text");
  assert.equal(saved.amsComposeContext.kind, "selection");
  assert.equal(saved.amsComposeContext.title, "Example");
  assert.equal(saved.amsComposeContext.url, "https://example.com/a");
  assert.equal(saved.amsComposeContext.truncated, false);
  assert.equal(typeof saved.amsComposeContext.capturedAt, "number");
  assert.equal(saved.amsComposeContextError, null, "成功选区必须清除残留错误");
  assert.equal(opened, 1);

  const openedBeforePage = opened;
  saved.amsComposeContextError = "stale";
  pageDocument = doc({ article: { innerText: " Page body " } });
  const page = await PageContext.handleClick({ menuItemId: "ams-send-page" },
    { id: 7, url: "https://example.com/a", title: "Example" });
  assert.equal(page.ok, true);
  assert.equal(executions.length, 1);
  assert.deepEqual(plain(executions[0].target), { tabId: 7 });
  assert.equal(typeof executions[0].func, "function");
  assert.deepEqual(plain({ ...saved.amsComposeContext, capturedAt: 0 }), {
    kind: "page", title: "Example", url: "https://example.com/a",
    text: "Page body", truncated: false, capturedAt: 0,
  });
  assert.equal(saved.amsComposeContextError, null);
  assert.equal(opened, openedBeforePage + 1);

  const oldContext = plain(saved.amsComposeContext);
  failNext.execute = "Cannot access page";
  const blocked = await PageContext.handleClick({ menuItemId: "ams-send-page" },
    { id: 7, url: "https://example.com/a" });
  assert.deepEqual(plain(blocked), { ok: false, code: "page_access_denied" });
  assert.deepEqual(sessionWrites.at(-1), { amsComposeContextError: "page_access_denied" });
  assert.deepEqual(saved.amsComposeContext, oldContext);
  assert.equal(opened, openedBeforePage + 2);

  pageDocument = doc({}, " \n\n ");
  const blank = await PageContext.handleClick({ menuItemId: "ams-send-page" },
    { id: 7, url: "https://example.com/a" });
  assert.deepEqual(plain(blank), { ok: false, code: "page_empty" });
  assert.deepEqual(sessionWrites.at(-1), { amsComposeContextError: "page_empty" });
  assert.deepEqual(saved.amsComposeContext, oldContext);
  assert.equal(opened, openedBeforePage + 3);

  const longText = "😀".repeat(24001) + "MIDDLE" + "🦊".repeat(6001);
  await PageContext.handleClick({ menuItemId: "ams-send-selection", selectionText: longText },
    { id: 7, url: "https://example.com/a", title: "Example" });
  assert.equal(saved.amsComposeContext.text, "😀".repeat(24000) + "🦊".repeat(6000));
  assert.equal(saved.amsComposeContext.truncated, true);

  const empty = await PageContext.handleClick(
    { menuItemId: "ams-send-selection", selectionText: "   " },
    { id: 7, url: "https://example.com/a" }
  );
  assert.deepEqual(plain(empty), { ok: false, code: "page_empty" });

  const executionsBeforeDenied = executions.length;
  const denied = await PageContext.handleClick(
    { menuItemId: "ams-send-page" },
    { id: 8, url: "chrome://settings" }
  );
  assert.deepEqual(plain(denied), { ok: false, code: "page_access_denied" });
  assert.equal(executions.length, executionsBeforeDenied);
  assert.deepEqual(sessionWrites.at(-1), { amsComposeContextError: "page_access_denied" });
  assert.equal(opened, openedBeforePage + 5);

  const openedBeforeFailure = opened;
  failNext.session = "session save failed";
  await assert.rejects(PageContext.handleClick(
    { menuItemId: "ams-send-selection", selectionText: "not saved" },
    { id: 7, url: "https://example.com/a", title: "Example" }
  ), /session save failed/);
  assert.equal(opened, openedBeforeFailure);

  for (const invoke of [
    () => listeners.installed[0](),
    () => listeners.startup[0](),
    () => listeners.changed[0]({ amsLang: { newValue: "en" } }, "local"),
  ]) {
    failNext.get = "background install failed";
    assert.equal(invoke(), undefined);
    await tick();
  }
  failNext.session = "background save failed";
  assert.equal(listeners.clicked[0](
    { menuItemId: "ams-send-selection", selectionText: "not saved" },
    { id: 7, url: "https://example.com/a", title: "Example" }
  ), undefined);
  await tick();
  assert.equal(opened, openedBeforeFailure);

  const manifest = JSON.parse(source("manifest.json"));
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "system.display", "identity", "alarms", "contextMenus", "activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.googleapis.com/*"]);
  assert.equal(Object.hasOwn(manifest, "optional_permissions"), false);
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);

  const imported = [];
  const noopEvent = { addListener() {} };
  vm.runInNewContext(source("background.js"), {
    chrome: {
      commands: { onCommand: noopEvent },
      runtime: { onMessage: noopEvent, onStartup: noopEvent },
      storage: { local: { remove() {} } },
      windows: { onRemoved: noopEvent },
    },
    clearTimeout,
    importScripts: (...files) => imported.push(...files),
    setTimeout,
  });
  assert.ok(imported.indexOf("bg/windows.js") < imported.indexOf("bg/page-context.js"));
  assert.ok(imported.indexOf("bg/page-context.js") < imported.indexOf("bg/broadcast.js"));

  console.log("page-context tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
