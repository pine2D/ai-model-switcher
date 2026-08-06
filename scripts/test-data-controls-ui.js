#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const html = fs.readFileSync("options/options.html", "utf8");
for (const id of ["clear-history", "clear-archives", "reset-local", "local-data-confirmation", "local-data-continue", "local-data-cancel", "local-data-status"])
  assert.ok(html.includes(`id="${id}"`), `本机数据控制缺少 ${id}`);
assert.match(html, /id="local-data-confirmation"[^>]*hidden/, "危险操作确认必须默认隐藏");

const nodes = new Map(), actionButtons = [];
function node(id, action) {
  const listeners = new Map(), value = { id, hidden: false, disabled: false, dataset: action ? { localDataAction: action } : {}, textContent: "",
    addEventListener: (type, fn) => listeners.set(type, fn), click: () => listeners.get("click")?.(), focus() {} };
  nodes.set(id, value); if (action) actionButtons.push(value); return value;
}
node("clear-history", "clearHistory"); node("clear-archives", "clearArchives"); node("reset-local", "resetLocal");
node("local-data-confirmation").hidden = true; node("local-data-warning"); node("local-data-continue"); node("local-data-cancel"); node("local-data-status");
const messages = [], documentListeners = new Map();
const document = { getElementById: (id) => nodes.get(id), querySelectorAll: () => actionButtons,
  addEventListener: (type, fn) => documentListeners.set(type, fn) };
const chrome = { runtime: { sendMessage: async (message) => { messages.push(message); return { ok: true, count: 2 }; } } };
const scope = vm.createContext({ document, chrome, t: (key, value) => `${key}${value == null ? "" : `:${value}`}` });
vm.runInContext(fs.readFileSync("options/data.js", "utf8"), scope);

(async () => {
  nodes.get("clear-history").click();
  assert.equal(nodes.get("local-data-confirmation").hidden, false);
  assert.equal(nodes.get("local-data-warning").textContent, "localData_historyWarning");
  nodes.get("local-data-continue").click(); await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), { source: "AMS_DATA_ADMIN", action: "clearHistory" });
  assert.equal(nodes.get("local-data-status").textContent, "localData_historyDone:2");
  nodes.get("reset-local").click(); documentListeners.get("i18n:changed")();
  assert.equal(nodes.get("local-data-warning").textContent, "localData_resetWarning");
  nodes.get("local-data-cancel").click(); assert.equal(nodes.get("local-data-confirmation").hidden, true);
  console.log("data-controls-ui tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
