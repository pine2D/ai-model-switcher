#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const event = { addListener() {} };
const chrome = {
  runtime: { lastError: null, onInstalled: event, onStartup: event },
  contextMenus: { onClicked: event },
  storage: { onChanged: event },
};
const context = vm.createContext({ chrome, console, Date, URL, openCompose: async () => {} });
vm.runInContext(fs.readFileSync("bg/page-context.js", "utf8"), context);
const PageContext = vm.runInContext("PageContext", context);

const documentWithEmptyArticle = {
  querySelector(selector) {
    if (selector === "article") return { innerText: "   " };
    if (selector === "main") return { innerText: " Main content " };
    return null;
  },
  body: { innerText: "Body content" },
};
assert.equal(PageContext.extractForTest(documentWithEmptyArticle), "Main content",
  "空 article 不得阻断后续正文容器");

async function latestCaptureWins() {
  let releasePage, opened = 0;
  const saved = {};
  const runtimeChrome = {
    runtime: { lastError: null, onInstalled: event, onStartup: event },
    contextMenus: { onClicked: event },
    scripting: { executeScript: () => new Promise((resolve) => { releasePage = resolve; }) },
    storage: {
      local: {}, onChanged: event,
      session: { set(value, done) { Object.assign(saved, structuredClone(value)); done(); } },
    },
  };
  const runtime = vm.createContext({ chrome: runtimeChrome, console, Date, URL, structuredClone,
    openCompose: async () => { opened++; } });
  vm.runInContext(fs.readFileSync("bg/page-context.js", "utf8"), runtime);
  const api = vm.runInContext("PageContext", runtime);
  const slow = api.handleClick({ menuItemId: api.MENU_PAGE }, { id: 1, title: "Older", url: "https://older.test/" });
  await Promise.resolve();
  await api.handleClick({ menuItemId: api.MENU_SELECTION, selectionText: "newer" },
    { id: 2, title: "Newer", url: "https://newer.test/" });
  releasePage([{ result: "older page" }]);
  await slow;
  assert.equal(saved.amsComposeContext.title, "Newer", "较慢的旧采集不得覆盖后来操作");
  assert.equal(opened, 1, "被后来操作淘汰的采集不得再次打开工作区");
}

latestCaptureWins().then(() => console.log("page context ordering tests passed"), (error) => {
  console.error(error); process.exitCode = 1;
});
