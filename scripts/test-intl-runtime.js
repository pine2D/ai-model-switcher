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
  const composer = {
    tagName: "DIV", textContent: "", focus() {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 500, bottom: 520, width: 400, height: 20 }),
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
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitemradio"]') return view === "effort" ? efforts : (view === "model" ? models : []);
      if (selector === '[role="menuitem"][aria-haspopup="menu"]') return triggers;
      if (selector.includes("__composer-pill")) return [pill];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, (el) => { if (el === pill) expanded = true; });
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["chatgpt.com"], clicked, efforts, models };
}

async function chatGptEffortMustComeFromEffortSubmenu() {
  for (const label of ["EffortHigh", "档位High"]) { // 英文入口 + 未知译法（回退：排除带模型名的入口）
    const c = chatGptTierCase(label, false);
    await c.adapter._pickEdge(true);
    assert.ok(c.clicked.includes(c.efforts[4]), "ChatGPT 最高档必须取自 Effort 子菜单（Pro）：" + label);
    assert.ok(!c.clicked.some((el) => c.models.includes(el)), "档位切换绝不能点到 Model 子菜单的模型项：" + label);
  }
}

async function chatGptMustNotClickModelWhenTiersMissing() {
  const c = chatGptTierCase("", true); // 只剩 Model 入口：宁可报错，也不能把末位模型 o3 当最高档
  await assert.rejects(async () => c.adapter._pickEdge(true));
  assert.equal(c.clicked.length, 0, "找不到档位列表时不得点击任何 radio");
}

// helper 语义贴近生产：findByText 走真实选择器、openMenu/clickEl 记录副作用
function fakeRuntime(document, clicked, onOpen) {
  const findByText = (selector, re, root) =>
    [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null;
  return {
    adapters: {}, findByText, sleep: async () => {}, escMenus() {},
    waitFor: async (fn, _timeout) => { for (let i = 0; i < 3; i++) { const v = fn(); if (v) return v; } return null; },
    openMenu: (el) => onOpen(el),
    clickEl: (el) => { clicked.push(el); return true; },
  };
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
  const sendButton = { disabled: false, click() { clicks++; } }; // 站点忽略合成点击
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const context = {
    window: {}, location: { hostname: "claude.ai" }, innerHeight: 800, innerWidth: 900,
    document: {
      body: { dispatchEvent() {}, appendChild() {} }, dispatchEvent() {}, createElement: () => ({}),
      querySelectorAll: (selector) => selector === 'textarea, [contenteditable="true"]' ? [composer] : [],
      querySelector: (selector) => selector.includes("send") ? sendButton : null,
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
}

let failed = 0;
(async () => {
  const tests = [chatGptNewTurnMustBeCollected, twentyPixelComposerMustBeFound,
    claudeModelInMoreMenuMustBeSelected, chatGptEffortMustComeFromEffortSubmenu,
    chatGptMustNotClickModelWhenTiersMissing, sendMustFallBackToEnterWhenClickIgnored];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ 国际站新版对话结构与二级档位菜单兼容");
})();
