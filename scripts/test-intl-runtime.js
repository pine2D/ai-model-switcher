#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function chatGptNewTurnMustBeCollected() {
  const markdown = { marker: "answer" };
  const turns = [{ querySelector: () => null }, { querySelector: (selector) => selector === ".markdown" ? markdown : null }];
  const S = { adapters: {}, waitFor: async (fn) => fn(), findByText: () => null,
    openMenu() {}, clickEl() {}, sleep: async () => {}, escMenus() {} };
  const context = {
    window: { __AMS: S }, t: (key) => key, console,
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === '[data-turn="assistant"]' ? turns : [],
    },
  };
  vm.runInNewContext(source("content/adapters-intl.js"), context);
  assert.equal(S.adapters["chatgpt.com"].answer(), markdown,
    "ChatGPT 新版 data-turn 回答必须可被汇总复制");
}

function twentyPixelComposerMustBeFound() {
  const composer = { // 19.98 而非 20：页面缩放会让标称 20px 的单行编辑器算出小数高度
    tagName: "DIV", textContent: "", focus() {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 500, bottom: 519.98, width: 400, height: 19.98 }),
  };
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const context = {
    window: {},
    document: {
      body: { dispatchEvent() {}, appendChild() {} },
      querySelectorAll: (selector) => selector === 'textarea, [contenteditable="true"]' ? [composer] : [],
      querySelector: () => null, dispatchEvent() {}, createElement: () => ({}),
    },
    location: { hostname: "claude.ai" }, innerHeight: 800, innerWidth: 900,
    chrome: { runtime: { onMessage: { addListener() {} } } }, t: (key) => key,
    Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, CustomEvent: FakeEvent,
    matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, Date,
  };
  vm.runInNewContext(source("content/core.js"), context);
  assert.equal(context.window.__AMS.findComposer(), composer,
    "Claude 新版 20px 单行编辑器必须被识别");
}

// 2026-08 改版：Claude 顶层只留当前模型，其余在「More models」子菜单里
function claudeModelInMoreMenuMustBeSelected() {
  const clicked = [];
  let expanded = false;
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });
  const sonnet = Object.assign({ textContent: "Sonnet 5Most efficient for everyday tasks" }, attr({ "aria-checked": "true" }));
  const fable = Object.assign({ textContent: "Fable 5" }, attr({ "aria-checked": "false" }));
  const more = Object.assign({ textContent: "More models" }, attr({ "aria-haspopup": "menu" }));
  const document = {
    querySelector: (selector) => selector === '[data-testid="model-selector-dropdown"]'
      ? attr({ "aria-label": "Model: Sonnet 5 Medium" })
      : (selector === '[role="menuitemradio"]' ? sonnet : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitemradio"]') return expanded ? [sonnet, fable] : [sonnet];
      if (selector === '[role="menuitem"][aria-haspopup="menu"]') return [more];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, (el) => { if (el === more) expanded = true; });
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return S.adapters["claude.ai"]._selectModel(/fable\s*5/i).then(() => {
    assert.ok(clicked.includes(fable), "Claude 深度思考模型必须能从 More models 子菜单选中");
    assert.equal(S.escCount, 1, "选中模型的成功路径必须 escMenus 收尾");
  });
}

// 2026-08 改版：ChatGPT 档位 radio 只存在于 Effort 子菜单，Model 子菜单同为 menuitemradio。
// view 从 "model" 起步：think() 先选模型，_pickEdge 进场时残留的正是模型列表。
function chatGptTierCase(effortLabel, dropEffortEntry) {
  const clicked = [];
  let expanded = false, view = "model";
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });
  const radio = (text) => Object.assign({ textContent: text }, attr({ "aria-checked": "false" }));
  const efforts = ["Instant", "Medium", "High", "Extra High", "Pro"].map(radio);
  const models = ["GPT-5.6 Sol", "GPT-5.5", "o3"].map(radio);
  const trigger = (text, next) => Object.assign({ textContent: text, click() { view = next; } }, attr({ "aria-haspopup": "menu" }));
  const triggers = [trigger("ModelGPT-5.6 Sol", "model")];
  if (!dropEffortEntry) triggers.push(trigger(effortLabel, "effort"));
  const pill = { textContent: "High", className: "__composer-pill",
    getAttribute: (name) => (name === "aria-haspopup" ? "menu" : (name === "aria-expanded" ? String(expanded) : null)) };
  const document = {
    querySelector: (selector) => (selector.includes("__composer-pill") ? pill : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitemradio"]') return view === "effort" ? efforts : (view === "model" ? models : []);
      if (selector === '[role="menuitem"][aria-haspopup="menu"]') return triggers;
      if (selector.includes("__composer-pill")) return [pill];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, (el) => { if (el === pill) expanded = true; });
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["chatgpt.com"], S, clicked, efforts, models, pill };
}

async function chatGptEffortMustComeFromEffortSubmenu() {
  for (const label of ["EffortHigh", "档位High"]) { // 英文入口 + 未知译法（回退：排除带模型名的入口）
    const c = chatGptTierCase(label, false);
    await c.adapter._pickEdge(true);
    assert.ok(c.clicked.includes(c.efforts[4]), "ChatGPT 最高档必须取自 Effort 子菜单（Pro）：" + label);
    assert.ok(!c.clicked.some((el) => c.models.includes(el)), "档位切换绝不能点到 Model 子菜单的模型项：" + label);
    assert.equal(c.S.escCount, 1, "选档成功后必须 escMenus 收尾（Effort 子菜单会罩住输入框）：" + label);
  }
}

// 巡检的两项必须彼此独立：档位标签集漂移（pill 文本不在 _LABELS 里）时只有「已识别档位」该红，
// 入口项跟着红会把改版剧本指去 composer/菜单层，而真正要改的是 _LABELS。
function chatGptEntryCheckMustSurviveLabelDrift() {
  const c = chatGptTierCase("EffortHigh", false);
  c.pill.textContent = "Ludicrous"; // 站点新加了一个我们还不认识的档位词
  const checks = c.adapter.diagnose();
  assert.equal(checks[0].ok, true, "按钮还在，Intelligence 入口项不该跟着标签集一起红");
  assert.equal(checks[1].ok, false, "档位读不出必须由「已识别档位」这一项单独报出");
}

async function chatGptMustNotClickModelWhenTiersMissing() {
  const c = chatGptTierCase("", true); // 只剩 Model 入口：宁可报错，也不能把末位模型 o3 当最高档
  await assert.rejects(async () => c.adapter._pickEdge(true));
  assert.equal(c.clicked.length, 0, "找不到档位列表时不得点击任何 radio");
}

// helper 语义贴近生产：findByText 走真实选择器、openMenu/clickEl 记录副作用。
// escMenus 必须是计数器而非空桩——「每个菜单动作自己收尾」是硬约束，空桩让违反者永远绿。
// waitFor 也必须消耗 timeout：忽略它就分不清 waitFor(fn, 1500) 与无超时调用，短超时用例形同虚设。
function fakeRuntime(document, clicked, onOpen) {
  const findByText = (selector, re, root) =>
    [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null;
  const runtime = {
    adapters: {}, findByText, sleep: async () => {}, escCount: 0, escMenus() { runtime.escCount++; },
    waitFor: async (fn, timeout = 3500, step = 120) => { // 与生产 core.js 同构：轮询到超时才返回 null
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu: (el) => onOpen(el),
    clickEl: (el) => { clicked.push(el); return true; },
  };
  return runtime;
}

// Gemini 是九站里唯一在离线层零适配器覆盖的站；下面三条都用纯 DOM 假对象，不需要真机。
function geminiCase(build) {
  const clicked = [];
  let open = false;
  const rect = () => ({ width: 200, height: 40 });
  const item = (text, active) => ({ textContent: text, getBoundingClientRect: rect,
    classList: { contains: (name) => !!active && name === "selected" }, getAttribute: () => null });
  const state = { label: "Mode picker, currently 3.6 Flash" };
  const button = { getAttribute: (name) => name === "aria-label" ? state.label
    : (name === "aria-expanded" ? String(open) : null) };
  const items = build(item);
  const document = {
    // 中文界面下 aria-label 不含 "mode picker"，_modelBtn 落到 class 前缀回退——两条锚点都要覆盖
    querySelector: (selector) => selector.includes("input-area-swi") ? button : null,
    querySelectorAll: (selector) => {
      if (selector === "button") return [button];
      if (selector.includes("mat-mdc-menu-item")) return open ? items : [];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, () => { open = true; });
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["gemini.google.com"], S, clicked, items, state };
}

// aria-label 只报模式名，state 必须按粗档位判；读不出时返回 null 而不是谎报 fast
function geminiStateMustFollowModeLabel() {
  const c = geminiCase(() => []);
  for (const [label, expected] of [
    ["Mode picker, currently 3.6 Flash", "fast"],
    ["Mode picker, currently 3.1 Pro", "think"],
    ["Mode picker, currently Extended thinking", "think"],
    ["模式选择器，当前为扩展思考", "think"],       // 中文界面走 class 回退锚点
    ["Mode picker, currently Deep Research", null], // 既非 flash 也非 pro/extended：不猜
    ["", null],                                     // 按钮在但标签读不出
  ]) { c.state.label = label; assert.equal(c.adapter.state(), expected, "Gemini state: " + label); }
}

async function geminiModelSelectMustCloseItsMenu() {
  const c = geminiCase((item) => [item("3.1 Pro"), item("3.6 Flash")]);
  await c.adapter._selectModel(/3\.1\s*pro\b/i);
  assert.ok(c.clicked.includes(c.items[0]), "Gemini 必须能从模式菜单选中目标模型");
  assert.equal(c.S.escCount, 1, "选中模型后必须自己 escMenus 收尾，不能指望后面的 _setThinking 替它关");
}

// 直达开关是有状态控件：已是目标态就不许再点（再点等于关掉 Extended thinking）
async function geminiThinkingToggleMustBeIdempotent() {
  for (const [active, shouldClick] of [[false, true], [true, false]]) {
    const c = geminiCase((item) => [item("Extended thinking", active)]);
    await c.adapter._setThinking(/^(extended|扩展)/i, true);
    assert.equal(c.clicked.includes(c.items[0]), shouldClick, "Extended thinking 开关幂等，active=" + active);
    assert.equal(c.S.escCount, 1, "开关动作同样要 escMenus 收尾，active=" + active);
  }
}

// Claude 新版发送键拒绝一切合成点击（真机 2026-08）：点了没生效必须退回 Enter，否则整条群发发不出去
async function sendMustFallBackToEnterWhenClickIgnored() {
  let composerText = "", clicks = 0;
  const composer = {
    tagName: "DIV", focus() {},
    get textContent() { return composerText; },
    set textContent(value) { composerText = value; },
    dispatchEvent(event) { if (event.type === "keydown" && event.key === "Enter") composerText = ""; return true; },
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 }),
  };
  const sendButton = { disabled: false, click() { clicks++; }, // 站点忽略合成点击
    getBoundingClientRect: () => ({ left: 420, right: 452, top: 505, bottom: 537, width: 32, height: 32 }) };
  // 侧栏里标题含「发送」二字的历史项按钮：同样匹配选择器、DOM 顺序在前、位置远离输入框（真机 2026-08-14
  // Claude：querySelector 取文档顺序第一个 → 真发送键从没被点过，带图时确认窗口空转满 90s）
  let sidebarClicks = 0;
  const sidebarDecoy = { disabled: false, click() { sidebarClicks++; },
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const context = {
    window: {}, location: { hostname: "claude.ai" }, innerHeight: 800, innerWidth: 900,
    document: {
      body: { dispatchEvent() {}, appendChild() {} }, dispatchEvent() {}, createElement: () => ({}),
      querySelectorAll: (selector) => selector === 'textarea, [contenteditable="true"]' ? [composer]
        : selector.includes("send") ? [sidebarDecoy, sendButton] : [],
      querySelector: (selector) => selector.includes("send") ? sidebarDecoy : null,
      execCommand: (command, _ui, value) => { if (command === "insertText") composerText = value; return true; },
    },
    chrome: { runtime: { onMessage: { addListener() {} } } }, t: (key) => key,
    Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, CustomEvent: FakeEvent,
    matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, Date, getSelection: () => { throw new Error("no selection"); },
  };
  vm.runInNewContext(source("content/core.js"), context);
  const result = await context.window.__AMS.submitPrompt("hello", 0);
  assert.equal(result.ok, true, "发送键点不动时必须退回 Enter 并确认提交成功");
  assert.ok(clicks >= 1, "回退前仍应先尝试原生发送键");
  assert.equal(sidebarClicks, 0, "绝不能点侧栏那个同样匹配、但远离输入框的假发送键");
}

let failed = 0;
(async () => {
  const tests = [chatGptNewTurnMustBeCollected, twentyPixelComposerMustBeFound,
    claudeModelInMoreMenuMustBeSelected, chatGptEffortMustComeFromEffortSubmenu,
    chatGptMustNotClickModelWhenTiersMissing, chatGptEntryCheckMustSurviveLabelDrift,
    sendMustFallBackToEnterWhenClickIgnored,
    geminiStateMustFollowModeLabel, geminiModelSelectMustCloseItsMenu, geminiThinkingToggleMustBeIdempotent];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ 国际站新版对话结构与二级档位菜单兼容");
})();
