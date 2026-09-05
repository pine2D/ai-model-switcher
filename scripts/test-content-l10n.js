#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Step 13 之后整份删：站点侧语言由 Desktop 外壳单向注入后，i18n.js 不再自己解析 locale。

// 加载真实 i18n.js（非内容脚本世界，location.protocol 给非 chrome-extension: 值以短路 F094 的 applyI18n 早退），
// 拿到 _resolveAuto 供逐档探测，用于和 desktop/test/copy.test.ts 的 resolveLocale 表对账（F106/F223）。
function resolveAutoFor(uiLanguage) {
  const source = fs.readFileSync("i18n.js", "utf8");
  const scope = {
    chrome: {
      i18n: { getUILanguage: () => uiLanguage },
      storage: { local: { get: (defaults, cb) => cb(defaults) }, onChanged: { addListener() {} } },
    },
    document: { dispatchEvent() {} },
    location: { protocol: "https:" },
    CustomEvent: function CustomEvent(type) { this.type = type; },
  };
  vm.runInNewContext(`${source}\nglobalThis.result = _resolveAuto();`, scope);
  return scope.result;
}

// F106/F223：i18n.js 的 _resolveAuto（内容脚本注入侧）必须与 desktop/src/shared/copy.ts 的
// resolveLocale（Desktop 外壳侧，见 desktop/test/copy.test.ts 同名锁定表）逐档一致，否则同一
// locale 在站点页面内容脚本与周围外壳会显示不同语言。resolveLocale 是收敛方向的权威实现。
for (const [ui, expected] of [
  ["zh", "zh_CN"], ["zh-CN", "zh_CN"], ["zh-Hans-CN", "zh_CN"],
  ["zh-TW", "zh_TW"], ["zh-HK", "zh_TW"], ["zh-MO", "zh_TW"], ["zh-Hant-TW", "zh_TW"], ["zh-Hant-HK", "zh_TW"],
  ["zh-SG", "en"], ["zh-yue-HK", "en"], ["zh-CHS", "en"], ["en-US", "en"], ["fr-FR", "en"],
]) {
  assert.equal(resolveAutoFor(ui), expected,
    `_resolveAuto("${ui}") 应为 "${expected}"，与 desktop resolveLocale 的同档结果一致（F223）`);
}

assert.doesNotMatch(fs.readFileSync("README.md", "utf8"), /归档|歸檔|封存/);
// F210/F185：旧写法用两个 indexOf 定切片边界，任一个锚点找不到就返回 -1，slice(-1, N) 会静默
// 退化成空串或跑飞到全文，assert.doesNotMatch 对空串恒过——术语回归检查会在毫无察觉的情况下失效。
// 改成正则直接捕获「未发布」到下一个版本标题之间的内容，不依赖具体版本号做下界（下界会随发版推移）；
// match 失败时显式断言，锚点丢失時测试本身先炸，而不是悄悄放行。
const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
const unreleasedMatch = changelog.match(/## \[未发布\]([\s\S]*?)(?=\n## \[|$)/);
assert.ok(unreleasedMatch, "CHANGELOG.md: 找不到「## [未发布]」段，术语回归检查失去锚点");
assert.doesNotMatch(unreleasedMatch[1], /归档|歸檔|封存/, "CHANGELOG.md 未发布段：术语已改为「结果库」，不应再出现「归档」");

console.log("[content-l10n] _resolveAuto ↔ resolveLocale 13 档一致；README / CHANGELOG 术语守卫通过");
