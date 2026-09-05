#!/usr/bin/env node
"use strict";

// site-runtime/adapters-intl2.js（ChatGPT）的离线回归。2026-08-31 改版把档位从「Effort 子菜单里的
// menuitemradio 列表」换成「Power 项上的一根 5 格滑块」，键盘驱动；这里把出事那天的 DOM 做成假对象。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8");

// 真机 2026-08-31 的档名与位次（0..4）。0–3 档的档名只出现在 describedby 的朗读文本里，
// 不在任何可选中的节点上——这正是「不许拿标签判档、只认 X of N」的由来。
const TIERS = ["Instant", "Medium", "High", "Extra High", "Pro"];

function chatGptCase(options) {
  const opts = options || {};
  const clicked = [], keys = [];
  const state = { open: false, value: opts.value == null ? 2 : opts.value };
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });

  const desc = { id: "_r_desc_", get textContent() { return TIERS[state.value] + ", " + (state.value + 1) + " of 5."; } };
  const slider = Object.assign({ tagName: "SPAN" }, {
    getAttribute: (name) => name === "aria-valuenow" ? String(state.value)
      : name === "aria-valuemin" ? "0" : name === "aria-valuemax" ? "4" : name === "role" ? "slider" : null,
  });
  const power = {
    getAttribute: (name) => name === "aria-label" ? "Power" : name === "aria-describedby" ? "_r_desc_" : null,
    querySelector: (selector) => selector === '[role="slider"]' ? slider
      : selector === "[data-model-reasoning-effort-slider]" ? {} : null,
    focus() {},
    dispatchEvent(event) {
      if (event.type !== "keydown") return true;
      keys.push(event.key);
      if (event.key === "ArrowRight") state.value = Math.min(4, state.value + 1); // 端点饱和，不越界
      if (event.key === "ArrowLeft") state.value = Math.max(0, state.value - 1);
      return true; // End / Home 真机无效：这里同样刻意不实现，写了就红
    },
  };
  const radio = (text, checked) => Object.assign({ textContent: text, click() { clicked.push(text); } },
    attr({ "aria-checked": String(checked) }));
  const models = opts.models || [radio("GPT-5.6 Sol", true), radio("GPT-5.5", false)];
  const selectModel = Object.assign({ textContent: "Pro", querySelector: () => null,
    click() { clicked.push("select-model"); } }, attr({ "aria-label": "Select model" }));
  // 菜单开着时 pill 显示控件名而不是档名——旧 _anchor 的文本前置校验就是栽在这里
  const pill = { className: "__composer-pill",
    get textContent() { return state.open ? "Thinking effort" : (opts.pill || TIERS[state.value]); },
    set textContent(value) { opts.pill = value; },
    getAttribute: (name) => name === "aria-haspopup" ? "menu" : null };

  const menuItems = opts.dropPower ? [selectModel] : [selectModel, power];
  const document = {
    getElementById: (id) => (id === "_r_desc_" ? desc : null),
    querySelector: (selector) => {
      if (selector.includes("__composer-pill")) return pill;
      if (selector.includes("composer-intelligence-picker-content")) return state.open ? {} : null;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitem"]') return state.open ? menuItems : [];
      if (selector === '[role="menuitemradio"]') return state.open ? models : [];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, () => { state.open = true; });
  class FakeKeyboardEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  vm.runInNewContext(source("adapters-intl2.js"),
    { window: { __AMS: S }, t: (key) => key, document, console, KeyboardEvent: FakeKeyboardEvent });
  return { adapter: S.adapters["chatgpt.com"], S, clicked, keys, state, models, pill };
}

// escMenus 必须是计数器而非空桩——「每个菜单动作自己收尾」是硬约束，空桩让违反者永远绿。
function fakeRuntime(document, clicked, onOpen) {
  const findByText = (selector, re, root) =>
    [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null;
  const runtime = {
    adapters: {}, findByText, sleep: async () => {}, escCount: 0,
    escMenus() { runtime.escCount++; document.__closed = true; },
    waitFor: async (fn, timeout = 3500, step = 120) => {
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu: (el) => onOpen(el),
    clickEl: (el) => { clicked.push(el); return true; },
  };
  return runtime;
}

// think 走滑块最右端、fast 走最左端；两端都不许点到模型 radio
async function sliderMustBeDrivenToBothEdges() {
  for (const [top, goal, key] of [[true, 4, "ArrowRight"], [false, 0, "ArrowLeft"]]) {
    const c = chatGptCase({ value: 2 });
    await c.adapter._pickEdge(top);
    assert.equal(c.state.value, goal, "档位必须推到端点：" + key);
    assert.ok(c.keys.every((k) => k === key), "只能用左右方向键：End/Home 真机无效（实测值纹丝不动）");
    assert.ok(!c.clicked.some((x) => c.models.includes(x)), "切档绝不能点到模型 radio：" + key);
    assert.equal(c.S.escCount, 1, "选档后必须 escMenus 收尾（菜单会罩住输入框）：" + key);
  }
}

// 已在端点时一次键都不该按（有状态控件先读后点）
async function sliderMustBeIdempotentAtEdge() {
  const c = chatGptCase({ value: 4 });
  await c.adapter._pickEdge(true);
  assert.equal(c.keys.length, 0, "已是最高档不该再按方向键");
  assert.equal(c.S.escCount, 1, "幂等路径同样要收尾");
}

// 滑块整个不见了必须抛错，不许静默成功（runMode 会据此弹假成功 toast）
async function missingSliderMustThrow() {
  const c = chatGptCase({ dropPower: true });
  await assert.rejects(async () => c.adapter._pickEdge(true));
  assert.equal(c.keys.length, 0, "找不到滑块时不得乱按键");
}

// 菜单开着时 pill 文本是控件名「Thinking effort」：这是非终态，state() 必须返回 null 而不是猜档
function openMenuPillMustNotBeReadAsTier() {
  const c = chatGptCase({ value: 4 });
  assert.equal(c.adapter.state(), "think", "菜单关着时 pill=Pro → think");
  c.state.open = true;
  assert.equal(c.adapter.state(), null, "菜单开着时 pill=Thinking effort，不是档位，只能判 null");
  assert.equal(c.adapter.diagnose()[0].ok, true, "入口按钮还在，入口项不该跟着变红");
}

// _anchor 是纯选择子：档位标签集漂移（出现我们不认识的档名）只该让「已识别档位」红，入口项保持绿
function entryCheckMustSurviveLabelDrift() {
  const c = chatGptCase({ value: 4 });
  c.pill.textContent = "Ludicrous";
  const checks = c.adapter.diagnose();
  assert.equal(checks[0].ok, true, "按钮还在，Intelligence 入口项不该跟着标签集一起红");
  assert.equal(checks[1].ok, false, "档位读不出必须由「已识别档位」这一项单独报出");
}

// 模型已是目标就不点（点了会连带把菜单收掉，随后的 _pickEdge 得重开）；不是目标才点
async function modelSelectionMustBeIdempotent() {
  const same = chatGptCase({});
  await same.adapter._selectModel(/^GPT-5\.6\s*Sol\b/i);
  assert.deepEqual(same.clicked, [], "已是 GPT-5.6 Sol 时不该点任何东西");
  const other = chatGptCase({});
  await other.adapter._selectModel(/^GPT-5\.5\b/i);
  assert.ok(other.clicked.includes("GPT-5.5"), "模型不对时必须点中目标 radio");
}

function newTurnMustBeCollected() {
  const markdown = { marker: "answer" };
  const turns = [{ querySelector: () => null }, { querySelector: (s) => s === ".markdown" ? markdown : null }];
  const S = { adapters: {}, waitFor: async (fn) => fn(), findByText: () => null,
    openMenu() {}, clickEl() {}, sleep: async () => {}, escMenus() {} };
  const context = { window: { __AMS: S }, t: (key) => key, console,
    document: { querySelector: () => null,
      querySelectorAll: (s) => s === '[data-turn="assistant"]' ? turns : [] } };
  vm.runInNewContext(source("adapters-intl2.js"), context);
  assert.equal(S.adapters["chatgpt.com"].answer(), markdown, "ChatGPT 新版 data-turn 回答必须可被汇总复制");
}

let failed = 0;
(async () => {
  const tests = [sliderMustBeDrivenToBothEdges, sliderMustBeIdempotentAtEdge, missingSliderMustThrow,
    openMenuPillMustNotBeReadAsTier, entryCheckMustSurviveLabelDrift, modelSelectionMustBeIdempotent,
    newTurnMustBeCollected];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ ChatGPT 滑块档位与常驻模型 radio 兼容");
})();
