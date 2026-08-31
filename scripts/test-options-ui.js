#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
assert.deepEqual(manifest.options_ui, { page: "options/options.html", open_in_tab: true });
assert.equal(fs.existsSync("options/sync.html"), false, "旧 sync.html 不得保留");

const html = fs.readFileSync("options/options.html", "utf8");
for (const id of ["general", "sync", "transfer", "privacy"]) {
  assert.match(html, new RegExp(`id="section-${id}"[^>]*data-options-section`));
  assert.match(html, new RegExp(`href="#${id}"[^>]*data-options-nav`));
}
const controls = new Map();
function control(id, type = "select-one") {
  const listeners = new Map();
  const node = {
    id, type, value: "", checked: false,
    addEventListener: (event, listener) => listeners.set(event, listener),
    change: () => listeners.get("change")(),
  };
  controls.set(id, node);
  return node;
}
for (const id of ["theme", "language", "display-mode", "auto-raise"]) {
  assert.ok(html.includes(`id="${id}"`), `常规设置缺少 ${id}`);
  control(id, id === "auto-raise" ? "checkbox" : "select-one");
}

const values = new Map([["amsTheme", "dark"], ["amsLang", "zh_CN"], ["displayMode", "always"], ["amsAutoRaise", false]]);
const writes = [];
const storageListeners = [];
const chrome = { storage: {
  local: {
    get(defaults, done) {
      const result = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, values.has(key) ? values.get(key) : fallback]));
      done(result);
    },
    set(next) {
      writes.push(next);
      for (const [key, value] of Object.entries(next)) values.set(key, value);
    },
  },
  onChanged: { addListener: (listener) => storageListeners.push(listener) },
} };
const document = {
  getElementById: (id) => controls.get(id),
  querySelectorAll: () => [],
};
const scope = vm.createContext({ chrome, document, location: { hash: "#unknown" }, history: { replaceState() {} },
  window: { addEventListener() {} } });
vm.runInContext(fs.readFileSync("options/options.js", "utf8"), scope);

assert.equal(scope.optionSection("#general"), "general");
assert.equal(scope.optionSection("#privacy"), "privacy");
assert.equal(scope.optionSection("#unknown"), "general");
assert.equal(scope.optionSection(""), "general");
assert.deepEqual(Object.fromEntries([...controls].map(([id, node]) => [id, node.type === "checkbox" ? node.checked : node.value])),
  { theme: "dark", language: "zh_CN", "display-mode": "always", "auto-raise": false });

controls.get("theme").value = "light";
controls.get("theme").change();
controls.get("auto-raise").checked = true;
controls.get("auto-raise").change();
assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ amsTheme: "light" }, { amsAutoRaise: true }], "控件 change 必须写回 local storage");

for (const listener of storageListeners) listener({
  amsTheme: { newValue: "light" }, amsLang: { newValue: "en" },
  displayMode: { newValue: "hidden" }, amsAutoRaise: { newValue: true },
}, "local");
assert.deepEqual(Object.fromEntries([...controls].map(([id, node]) => [id, node.type === "checkbox" ? node.checked : node.value])),
  { theme: "light", language: "en", "display-mode": "hidden", "auto-raise": true }, "远端或导入写入必须更新已打开的设置页");

for (const listener of storageListeners) listener({
  amsTheme: { newValue: undefined }, amsLang: { newValue: undefined },
  displayMode: { newValue: undefined }, amsAutoRaise: { newValue: undefined },
}, "local");
assert.deepEqual(Object.fromEntries([...controls].map(([id, node]) => [id, node.type === "checkbox" ? node.checked : node.value])),
  { theme: "auto", language: "auto", "display-mode": "handle", "auto-raise": true }, "删除设置必须恢复既有 fallback");

// F105：日期/数字格式化一律传 document.documentElement.lang，不得取浏览器默认 locale（否则界面语言与
// 日期格式互相打架）——仓库其它三处（status.js/archive-detail.js/archive-stats.js）都显式传了，只有
// options/sync.js 这一处漏传 undefined locale，钉死防回归。
const syncSource = fs.readFileSync("options/sync.js", "utf8");
assert.doesNotMatch(syncSource, /Intl\.DateTimeFormat\(undefined/, "日期格式化不得取浏览器默认 locale，须传 document.documentElement.lang");
assert.match(syncSource, /Intl\.DateTimeFormat\(document\.documentElement\?\.lang \|\| undefined/, "日期格式化应与 status.js/archive-detail.js/archive-stats.js 对齐，显式传当前界面语言（?. 是容错写法，含义不变）");

console.log("[options-ui] 设置中心入口、分区、路由与 storage 同步通过");
