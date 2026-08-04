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
const created = [];
const executions = [];

const chrome = {
  contextMenus: {
    removeAll(callback) {
      assert.equal(typeof callback, "function");
      removed++;
      callback();
    },
    create(item, callback) {
      assert.equal(typeof callback, "function");
      created.push(plain(item));
      callback();
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
      return Promise.resolve([{ result: "page body" }]);
    },
  },
  storage: {
    local: {
      get(defaults, callback) {
        assert.deepEqual(plain(defaults), { amsLang: "auto" });
        assert.equal(typeof callback, "function");
        callback({ amsLang: language });
      },
    },
    session: {
      set(value, callback) {
        assert.equal(typeof callback, "function");
        saved = plain(value);
        callback();
      },
    },
    onChanged: event("changed"),
  },
};

const context = vm.createContext({
  chrome,
  console,
  Date,
  URL,
  openCompose: async () => { opened++; },
});
vm.runInContext(source("bg/page-context.js"), context);
const PageContext = vm.runInContext("PageContext", context);

async function run() {
  assert.deepEqual(Object.fromEntries(Object.entries(listeners).map(([name, values]) => [name, values.length])), {
    installed: 1, startup: 1, changed: 1, clicked: 1,
  });

  await PageContext.installMenus();
  assert.deepEqual(created.map((item) => item.id), ["ams-send-selection", "ams-send-page"]);
  assert.deepEqual(created.map((item) => item.contexts), [["selection"], ["page"]]);
  assert.deepEqual(created.map((item) => item.documentUrlPatterns), [["http://*/*", "https://*/*"], ["http://*/*", "https://*/*"]]);
  assert.deepEqual(created.map((item) => item.title), ["用 PolyAsk 比較所選內容", "用 PolyAsk 比較目前網頁"]);

  language = "zh_CN";
  await listeners.installed[0]();
  assert.deepEqual(created.slice(-2).map((item) => item.title), ["用 PolyAsk 比较所选内容", "用 PolyAsk 比较当前网页"]);
  language = "en";
  await listeners.startup[0]();
  assert.deepEqual(created.slice(-2).map((item) => item.title), ["Compare selection with PolyAsk", "Compare this page with PolyAsk"]);
  language = "auto";
  uiLanguage = "zh-CN";
  await listeners.changed[0]({ amsLang: { newValue: "auto" } }, "local");
  assert.equal(removed, 4);
  assert.equal(created.length, 8);

  await PageContext.handleClick(
    { menuItemId: "ams-send-selection", selectionText: " chosen text " },
    { id: 7, url: "https://example.com/a", title: "Example" }
  );
  assert.equal(executions.length, 0);
  assert.equal(saved.amsComposeContext.text, "chosen text");
  assert.equal(saved.amsComposeContext.kind, "selection");
  assert.equal(saved.amsComposeContext.title, "Example");
  assert.equal(saved.amsComposeContext.url, "https://example.com/a");
  assert.equal(saved.amsComposeContext.truncated, false);
  assert.equal(typeof saved.amsComposeContext.capturedAt, "number");
  assert.equal(opened, 1);

  const longText = "😀".repeat(24001) + "MIDDLE" + "🦊".repeat(6001);
  await PageContext.handleClick(
    { menuItemId: "ams-send-selection", selectionText: longText },
    { id: 7, url: "https://example.com/a", title: "Example" }
  );
  assert.equal(saved.amsComposeContext.text, "😀".repeat(24000) + "🦊".repeat(6000));
  assert.equal(saved.amsComposeContext.truncated, true);

  const empty = await PageContext.handleClick(
    { menuItemId: "ams-send-selection", selectionText: "   " },
    { id: 7, url: "https://example.com/a" }
  );
  assert.deepEqual(plain(empty), { ok: false, code: "page_empty" });

  const denied = await PageContext.handleClick(
    { menuItemId: "ams-send-page" },
    { id: 8, url: "chrome://settings" }
  );
  assert.deepEqual(plain(denied), { ok: false, code: "page_access_denied" });
  assert.equal(executions.length, 0);

  const manifest = JSON.parse(source("manifest.json"));
  assert.deepEqual(manifest.permissions.slice(-3), ["contextMenus", "activeTab", "scripting"]);

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
