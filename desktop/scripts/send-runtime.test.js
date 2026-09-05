// desktop/scripts/send-runtime.test.js — site-runtime/send.js（通用发送键定位）的离线回归。
// 从 test-intl-runtime.js 拆出：那份已贴着 300 行上限。
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../src/site-runtime");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

// send.js 的三条不变量。桩只喂 sendBtn 需要的东西：候选按钮 + 输入框 + getComputedStyle。
function sendBtnCase(buttons, composerRect, ancestor) {
  const composer = { getBoundingClientRect: () => composerRect, parentElement: ancestor || null };
  const context = {
    window: { __AMS: { findComposer: () => composer } },
    document: { querySelectorAll: () => buttons },
    getComputedStyle: (node) => node.style || { overflowX: "visible", overflowY: "visible" },
  };
  vm.runInNewContext(source("send.js"), context);
  return context.window.__AMS.sendBtn(composer);
}
function fakeButton(name, rect, extra) {
  return Object.assign({ name, disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => rect }, extra || {});
}

// 长提示词把 ProseMirror 撑高、溢出裁剪容器；发送键贴的是容器下沿，与编辑节点 top 的差会越过 240 带。
// 旧实现按编辑节点 top 取锚点 → 15 行就返回 null，整条按钮路径失效，全押在 Enter 兜底上。
function sendBtnMustSurviveTallComposer() {
  const clip = { style: { overflowX: "visible", overflowY: "auto" },
    getBoundingClientRect: () => ({ left: 100, right: 700, top: 418, bottom: 802, width: 600, height: 384 }) };
  const send = fakeButton("send", { left: 660, right: 692, top: 810, bottom: 842, width: 32, height: 32 });
  const picked = sendBtnCase([send],
    { left: 100, right: 700, top: 418, bottom: 748, width: 600, height: 330 }, clip);
  assert.equal(picked && picked.name, "send", "长提示词撑高输入框后仍必须找到发送键");
}

// 侧栏假按钮纵向也落在带内（真机 2026-08-31 Claude 带内 9 个），只有横向能把它们分开。
function sendBtnMustIgnoreSidebarDecoyInBand() {
  const decoy = fakeButton("decoy", { left: 12, right: 36, top: 360, bottom: 384, width: 24, height: 24 });
  const send = fakeButton("send", { left: 660, right: 692, top: 475, bottom: 507, width: 32, height: 32 });
  const picked = sendBtnCase([decoy, send],
    { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 });
  assert.equal(picked && picked.name, "send", "带内的侧栏假按钮不得抢先命中");
}

// 旧实现用 .find 取首个满足几何条件的候选，首命中若不可用就整轮放弃按钮路径。
function sendBtnMustSkipDisabledCandidate() {
  const dead = fakeButton("dead", { left: 600, right: 632, top: 475, bottom: 507, width: 32, height: 32 },
    { disabled: true });
  const live = fakeButton("live", { left: 660, right: 692, top: 475, bottom: 507, width: 32, height: 32 });
  const picked = sendBtnCase([dead, live],
    { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 });
  assert.equal(picked && picked.name, "live", "首个候选不可用时必须继续试下一个");

  const aria = fakeButton("aria", { left: 600, right: 632, top: 475, bottom: 507, width: 32, height: 32 },
    { getAttribute: (name) => (name === "aria-disabled" ? "true" : null) });
  const picked2 = sendBtnCase([aria, live],
    { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 });
  assert.equal(picked2 && picked2.name, "live", "aria-disabled 同样算不可用");
}

// 全部候选都不可用时仍返回首个：调用点的 `btn && !btn.disabled` 会拦下它并落到 Enter 兜底，
// 保持既有语义（返回 null 会让「点不动就退 Enter」那条回归失去被点过的证据）。
function sendBtnMustFallBackWhenAllDisabled() {
  const a = fakeButton("a", { left: 600, right: 632, top: 475, bottom: 507, width: 32, height: 32 }, { disabled: true });
  const b = fakeButton("b", { left: 660, right: 692, top: 475, bottom: 507, width: 32, height: 32 }, { disabled: true });
  const picked = sendBtnCase([a, b], { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 });
  assert.equal(picked && picked.name, "a", "全不可用时返回首个候选，由调用点决定退回 Enter");
}

// 唯一能让「横向量到裁剪祖先」翻车的几何：祖先是横跨侧栏的整页容器 → 假按钮中心也落在它的
// 横向区间里 → 双方距离同为 0 → 只能由文档序裁决，侧栏在前。旧实现的窄纵向带本能挡掉它，
// 所以量错参照系是**比改动前更差**。横向锚点必须是编辑节点自身。
function sendBtnMustNotBeFooledByAWideClippingAncestor() {
  const page = { style: { overflowX: "hidden", overflowY: "visible" },
    getBoundingClientRect: () => ({ left: 0, right: 1280, top: 0, bottom: 900, width: 1280, height: 900 }) };
  const decoy = fakeButton("decoy", { left: 12, right: 36, top: 300, bottom: 324, width: 24, height: 24 });
  const send = fakeButton("send", { left: 1190, right: 1222, top: 702, bottom: 734, width: 32, height: 32 });
  const picked = sendBtnCase([decoy, send],
    { left: 340, right: 1240, top: 700, bottom: 740, width: 900, height: 40 }, page);
  assert.equal(picked && picked.name, "send", "裁剪祖先横跨侧栏时，横向锚点仍必须是编辑节点自身");
}

// getComputedStyle 抛异常时退化成编辑节点自身的矩形——纵向带变窄但仍是旧实现的等价物，不能返回 null。
function sendBtnMustDegradeWhenComputedStyleThrows() {
  const composerRect = { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 };
  const composer = { getBoundingClientRect: () => composerRect, parentElement: { parentElement: null } };
  const send = fakeButton("send", { left: 660, right: 692, top: 475, bottom: 507, width: 32, height: 32 });
  const context = {
    window: { __AMS: { findComposer: () => composer } },
    document: { querySelectorAll: () => [send] },
    getComputedStyle: () => { throw new Error("cross-origin"); },
  };
  vm.runInNewContext(source("send.js"), context);
  assert.equal(context.window.__AMS.sendBtn(composer), send, "getComputedStyle 失败时必须退化而不是放弃");
}

// 纵向带之外的候选必须排除；一个都不剩时返回 null（core 靠这个 null 落到 Enter 兜底）。
function sendBtnMustRejectCandidatesOutsideTheBand() {
  const far = fakeButton("far", { left: 400, right: 432, top: 20, bottom: 52, width: 32, height: 32 });
  const picked = sendBtnCase([far], { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 });
  assert.equal(picked, null, "远在输入区上方的候选必须被纵向带排除，且无候选时返回 null");
}

// 选择子字面量对账：三个子选择子少一个，九站里就有站的按钮路径静默退化成纯 Enter。
function sendSelectorMustKeepAllThreeForms() {
  const text = source("send.js");
  for (const needle of ['data-testid*="send" i', 'aria-label*="send" i', 'aria-label*="发送"']) {
    assert.ok(text.includes(needle), `site-runtime/send.js 的发送键选择子缺少「${needle}」`);
  }
}

let failed = 0;
for (const test of [sendBtnMustSurviveTallComposer, sendBtnMustIgnoreSidebarDecoyInBand,
  sendBtnMustNotBeFooledByAWideClippingAncestor, sendBtnMustDegradeWhenComputedStyleThrows,
  sendBtnMustRejectCandidatesOutsideTheBand, sendSelectorMustKeepAllThreeForms,
  sendBtnMustSkipDisabledCandidate, sendBtnMustFallBackWhenAllDisabled]) {
  try { test(); }
  catch (error) { failed++; console.error(error.stack || error); }
}
if (failed) process.exit(1);
console.log("send runtime tests passed");
