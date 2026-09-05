#!/usr/bin/env node
"use strict";

// site-runtime/adapters-cn2.js 的档位回归（智谱 / 元宝 / Kimi）。2026-08-31 真机改版：
// 智谱弹层多出「模型段 + 极致档」、元宝多出 Models 子菜单、Kimi 的 escMenus 收不掉根菜单。
// scripts/test-site-send-runtime.js 只管这一卷的发送/附件语义，档位放这里，两边不重叠。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = () => fs.readFileSync(path.join(__dirname, "../src/site-runtime/adapters-cn2.js"), "utf8");

function runtime(document, extra) {
  const S = {
    adapters: {}, sleep: async () => {}, escCount: 0, escMenus() { S.escCount++; },
    findByText: (selector, re, root) =>
      [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null,
    waitFor: async (fn, timeout = 3500, step = 120) => {
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu() {}, clickEl() { return true; },
  };
  // 覆盖必须发生在 vm 执行**之前**：适配器 IIFE 里 `const { openMenu, ... } = S` 会把引用解构走，
  // 事后改 S.openMenu 对它无效（会让断言变成假通过）。
  Object.assign(S, (extra && extra.hooks) || {});
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  vm.runInNewContext(source(), Object.assign(
    { window: { __AMS: S }, t: (key) => key, document, console, MouseEvent: FakeEvent }, extra || {}));
  return S;
}

// —— 智谱：弹层 = 模型段（GLM-5.3 / GLM-Flash）+ 档位段（快速 / 深度 / 极致）——
function glmCase(options) {
  const opts = options || {};
  const clicked = [];
  const state = { open: false, selected: opts.selected || "快速" };
  const item = (name, submenu) => ({
    className: "think-mode-item" + (submenu ? " has-submenu" : "") + (state.selected === name ? " selected" : ""),
    querySelector: (selector) => (selector === ".item-name" ? { textContent: name } : null),
    getBoundingClientRect: () => ({ width: state.open ? 200 : 0, height: state.open ? 38 : 0 }),
    click() { clicked.push(name); if (!submenu) state.selected = name; },
    dispatchEvent() { return true; },
  });
  const names = ["GLM-5.3", "GLM-Flash"].concat(opts.tiers || ["快速", "深度", "极致"]);
  const trigger = { className: "think-mode-trigger", textContent: "GLM-Flash" + state.selected,
    click() { clicked.push("trigger"); state.open = !state.open; }, dispatchEvent() { return true; } };
  const document = {
    querySelector: (selector) => selector === ".think-mode-trigger" ? trigger
      : (selector === ".think-mode-item.has-submenu" ? item("快速", true) : null),
    // className 每次重算，才能反映 click 之后的 selected 迁移
    querySelectorAll: (selector) => {
      if (selector === ".think-mode-item") return names.map((n) => item(n, false));
      if (selector === ".think-mode-item:not(.has-submenu)") return names.map((n) => item(n, false));
      return [];
    },
  };
  const S = runtime(document);
  return { adapter: S.adapters["chatglm.cn"], S, clicked, state, trigger };
}

async function glmThinkMustPreferTopTier() {
  const c = glmCase({});
  await c.adapter.think();
  assert.ok(c.clicked.includes("极致"), "think 必须指向最强档「极致」，不是「深度」");
  assert.equal(c.adapter.state(), "think", "极致必须被 state() 判成 think");
}

// 站点撤掉「极致」时降级点「深度」，而不是抛错——深度仍是可用的思考档
async function glmThinkMustFallBackToDeep() {
  const c = glmCase({ tiers: ["快速", "深度"] });
  await c.adapter.think();
  assert.ok(c.clicked.includes("深度"), "没有极致时必须降级点深度");
  assert.equal(c.adapter.state(), "think", "深度同样判 think");
}

function glmStateMustAcceptBothThinkTiers() {
  for (const [selected, expected] of [["极致", "think"], ["深度", "think"], ["快速", "fast"], ["标准", null]])
    assert.equal(glmCase({ selected: selected, tiers: ["快速", "深度", "极致", "标准"] }).adapter.state(),
      expected, "智谱 state: " + selected);
}

// escMenus 关不掉 el-tooltip 弹层：收尾必须回点触发器，否则弹层罩住输入框让注入点空
async function glmMenuMustBeClosedByRetrigger() {
  const c = glmCase({});
  await c.adapter.think();
  assert.equal(c.state.open, false, "切完档弹层必须真的关掉");
  assert.ok(c.S.escCount >= 1, "先走 escMenus，再兜底点触发器");
}

// —— 元宝：Models 子菜单（Hy4 preview / Hy3 / DeepSeek）与模式项同为 menuitemradio ——
function yuanbaoCase(mode, hooks) {
  const clicked = [];
  const state = { mode: mode || "Expert" };
  // 真机 2026-08-31：模型列表那层菜单带 aria-label="Model list"，模式那层没有 aria-label
  const modeMenu = { getAttribute: () => null }, modelMenu = { getAttribute: (n) => (n === "aria-label" ? "Model list" : null) };
  const radio = (text, home) => ({ textContent: text, closest: () => home,
    click() { clicked.push(text); state.mode = text.split(/(?=[A-Z][a-z])/)[0]; } });
  const modes = ["InstantInstant answers for everyday tasks", "ThinkingDeep reasoning for tricky problems",
    "ExpertUse Tools and run tasks"].map((t) => radio(t, modeMenu));
  // 「深度思考版」是刻意放的诱饵模型：文本命中模式标签集，靠容器（Model list）才能排掉它。
  // DeepSeek 那项的描述里也带「deep thinking」字样，Hy4 带「Expert mode only」。
  const models = ["深度思考版Hy4 的思考特调", "Hy4 previewHandle complex tasks - Expert mode only",
    "Hy3Recommended for daily use", "DeepSeekSuitable for deep thinking"].map((t) => radio(t, modelMenu));
  const button = { textContent: "", getAttribute: (name) => (name === "aria-label" ? "Switch model" : null) };
  Object.defineProperty(button, "textContent", { get: () => state.mode });
  const document = {
    querySelector: (selector) => (selector.includes("Switch model") ? button : null),
    querySelectorAll: (selector) => (selector === '[role="menuitemradio"]' ? models.concat(modes) : []),
  };
  const S = runtime(document, hooks ? { hooks } : undefined);
  return { adapter: S.adapters["yuanbao.tencent.com"], S, clicked, state };
}

// 模型项排在模式项前面（真机里 Models 子菜单一展开就是这个顺序）：没有语义校验就会点成模型
async function yuanbaoModeMustNotMatchModelRadios() {
  const c = yuanbaoCase("Instant");
  await c.adapter.think();
  assert.deepEqual(c.clicked, ["ThinkingDeep reasoning for tricky problems"], "只能点模式项，绝不能点模型项");
  assert.equal(c.adapter.state(), "think");
}

// openMenu 是切换语义：菜单已开时再点就把它关掉。真机 2026-09-01 实测，关闭动画期间
// menuitemradio 仍在 DOM，于是 waitFor 照样找得到项、click 却点在正在消失的节点上 →
// 落空 → 抛「目标模式未生效」。修复前这是元宝切档失败的形态。
async function yuanbaoMustNotToggleAnAlreadyOpenMenu() {
  let opens = 0;
  const c = yuanbaoCase("Expert", { openMenu: () => { opens += 1; } });  // 桩里菜单恒可见 = 已经开着
  await c.adapter.think();

  assert.equal(opens, 0, "菜单已展开时不得再点触发器——那一点会把它关掉");
  assert.deepEqual(c.clicked, ["ThinkingDeep reasoning for tricky problems"]);
  assert.equal(c.adapter.state(), "think");
}

// 合成点击偶发被吞（真机见过一次展不开）。Claude 的 _open 与 Gemini 的 _openModelMenu 都会重开一次，
// 元宝此前一次不成就抛「目标模式未找到」。
async function yuanbaoMustRetryOpeningTheModeMenu() {
  let opens = 0, visible = false;
  const c = yuanbaoCase("Expert", { openMenu: () => { opens += 1; if (opens >= 2) visible = true; } });
  const adapter = c.adapter;
  adapter._modeItems = () => (visible ? [{ textContent: "ThinkingDeep reasoning" }] : []);
  let thrown = null;
  try { await adapter._openModes({}); } catch (error) { thrown = error; }

  assert.equal(thrown, null, "第一次没展开必须重开一次，而不是直接抛");
  assert.equal(opens, 2, "恰好重试一次");
}

// —— Kimi：escMenus 只收得掉 effort 子菜单，根菜单要回点入口 ——
async function kimiRootMenuMustBeClosedByRetrigger() {
  const clicked = [];
  const state = { active: true };
  const entry = {
    classList: { contains: (name) => name === "active" && state.active },
    click() { clicked.push("entry"); state.active = !state.active; },
    querySelector: (selector) => (selector === ".name" ? { textContent: "K3" }
      : (selector === ".current-effort" ? { textContent: "Max" } : null)),
  };
  const document = {
    querySelector: (selector) => (selector === ".current-model" ? entry : null),
    querySelectorAll: () => [],
  };
  const S = runtime(document);
  await S.adapters["kimi.com"]._close();
  assert.equal(state.active, false, "escMenus 之后菜单还开着时，必须回点入口把根菜单关掉");
  assert.ok(S.escCount >= 1, "回点入口之前仍要先走 escMenus（它能收掉 effort 子菜单）");
  state.active = false; S.escCount = 0; clicked.length = 0;
  await S.adapters["kimi.com"]._close();
  assert.deepEqual(clicked, [], "菜单本就关着时不许再点入口（点了等于重新打开）");
}

let failed = 0;
(async () => {
  const tests = [glmThinkMustPreferTopTier, glmThinkMustFallBackToDeep, glmStateMustAcceptBothThinkTiers,
    glmMenuMustBeClosedByRetrigger, yuanbaoModeMustNotMatchModelRadios,
    yuanbaoMustNotToggleAnAlreadyOpenMenu, yuanbaoMustRetryOpeningTheModeMenu,
    kimiRootMenuMustBeClosedByRetrigger];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ 智谱极致档、元宝模式语义校验、Kimi 根菜单收尾兼容");
})();
