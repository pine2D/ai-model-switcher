#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let label = "";
const S = {
  adapters: {},
  waitFor: async (fn) => fn(),
  findByText: () => null,
  openMenu() {},
  clickEl() {},
  sleep: async () => {},
  escMenus() {},
};
const source = fs.readFileSync(path.join(__dirname, "../content/adapters-intl.js"), "utf8");
const context = {
  window: { __AMS: S },
  document: {
    querySelector: (selector) => selector === '[data-testid="model-selector-dropdown"]'
      ? { getAttribute: (name) => name === "aria-label" ? label : null }
      : null,
    querySelectorAll: () => [],
  },
  t: (key) => key,
  console,
};
vm.runInNewContext(source, context);

const state = S.adapters["claude.ai"].state.bind(S.adapters["claude.ai"]);
// 真机 2026-08-31：aria-label 用 U+00B7 中点分隔（`Model: Fable 5 · Max`），旧的空格形态在
// 滚动发布期仍会出现，两种都要判对；Extra / Max 是本次新增的两档。
for (const [value, expected] of [
  ["Model: Fable 5 \u00b7 Max", "think"],
  ["Model: Fable 5 \u00b7 Extra", "think"],
  ["Model: Fable 5 \u00b7 High", "think"],
  ["Model: Fable 5 \u00b7 Low", "fast"],
  ["Model: Fable 5 \u00b7 Medium", null],
  ["Model: Sonnet 5 \u00b7 Max", "fast"],   // 快模型恒 fast：effort 后缀不能把它抬成 think
  ["Model: Fable 5 High", "think"],
  ["Model: Fable 5 Extra", "think"],
  ["Model: Fable 5 Max", "think"],
  ["Model: Fable 5 Adaptive", "think"],
  ["Model: Fable 5 Low", "fast"],
  ["Model: Fable 5", "fast"],
  ["Model: Fable 5 Medium", null],
  ["Model: Sonnet 5", "fast"],
  ["Model: Opus 5 High", "think"], // 上一代标签在滚动发布期仍会出现，判定不能只认当代
  ["Model: Opus 5", "fast"],
]) {
  label = value;
  assert.equal(state(), expected, value);
}

// 换代时 think()/fast() 的模型正则与 state() 的可识别标签必须同步改（docs/adapters.md 的流程项）：
// 只改正则、忘了 state() 的分支，档位就恒判 null → switchTier 空转到超时报 cs_switchUnstable。
// 这里从生产源码抠出正则、反推出它期望的模型名，再喂回 state()，把两者钉在一起。
const claude = source.slice(source.indexOf('"claude.ai": {'), source.indexOf('"chatgpt.com": {'));
function modelRegex(hook) {
  const at = claude.indexOf(hook + ": async function ()");
  assert.notEqual(at, -1, `claude.ai 适配器缺少 ${hook}()`);
  const match = /_selectModel\(\/(.+?)\/i\)/.exec(claude.slice(at));
  assert.ok(match, `${hook}() 必须经 _selectModel(/…/i) 选模型`);
  return match[1];
}
const plainName = (pattern) => pattern.replace(/\\s[*+]/g, " ").replace(/\\b|[\\^$]/g, "").trim();
for (const [hook, suffix, expected] of [["think", " High", "think"], ["fast", "", "fast"]]) {
  const pattern = modelRegex(hook), name = plainName(pattern);
  assert.match(name, new RegExp(pattern, "i"), `${hook}() 的模型正则 /${pattern}/i 反推不出模型名`);
  label = "Model: " + name + suffix;
  assert.equal(state(), expected, `${hook}() 选的模型 "${name}" 必须能被 state() 判成 ${expected}（改正则要同步改 state 分支）`);
}
console.log("✓ Claude 档位状态识别正确，且 think/fast 模型正则与 state() 判定一致");
