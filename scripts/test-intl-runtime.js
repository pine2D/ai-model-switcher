#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

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
  // 真机 2026-08-31：Escape / backdrop 都关不掉 Gemini 的 mode picker（escMenus 故意不改 open），
  // 只有再点一次触发器才收 —— 假对象照抄这个语义，否则 _close 的兜底分支永远测不到。
  S.clickEl = (el) => { clicked.push(el); if (el === button) open = false; return true; };
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["gemini.google.com"], S, clicked, items, state, button, isOpen: () => open };
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

// 快档模型正则必须版本无关：站点 2026-08-31 把 3.6 Flash 换成 3.7 Flash，写死版本号当天整站抛
// 「未找到模型」。同时 Flash-Lite 是更弱的另一档，绝不能被当成快档选中。
async function geminiFastMustMatchAnyFlashButNotLite() {
  for (const flash of ["3.7 Flash All-around helpNew", "4.0 Flash", "3.9 flash"]) {
    const c = geminiCase((item) => [item("3.5 Flash-Lite Fastest answers"), item(flash), item("3.1 Pro Advanced reasoning")]);
    await c.adapter.fast();
    assert.ok(c.clicked.includes(c.items[1]), "任意版本号的 Flash 都要能选中：" + flash);
    assert.ok(!c.clicked.includes(c.items[0]), "Flash-Lite 不是快档，绝不能被选中：" + flash);
  }
  const lite = geminiCase((item) => [item("3.5 Flash Lite"), item("3.1 Pro")]); // 空格写法同样要挡住
  await assert.rejects(async () => lite.adapter.fast(), "只剩 Flash Lite 时宁可报错也不许错选");
}

// escMenus 对 Gemini 无效：收尾必须自己兜底点触发器，否则菜单一直罩着输入框
async function geminiMenuMustBeClosedByRetriggerWhenEscFails() {
  const c = geminiCase((item) => [item("3.1 Pro"), item("3.7 Flash")]);
  await c.adapter._selectModel(/3\.1\s*pro\b/i);
  assert.equal(c.isOpen(), false, "选完模型后菜单必须真的关掉（Escape 关不掉，要回点触发器）");
  assert.ok(c.clicked.includes(c.button), "兜底动作就是再点一次模型按钮");
}

// —— Claude effort 子菜单（2026-08-31：effort-menu-trigger / effort-option-* 两个 testid 全没了）——
function claudeEffortCase(options) {
  const opts = options || {};
  const clicked = [];
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });
  const state = { label: "Model: Fable 5 · Medium" };
  const menu = (lb) => ({ getAttribute: (name) => (name === "aria-labelledby" ? lb : null) });
  const modelMenu = menu("model-lb"), effortMenu = menu("eff-1");
  const radio = (text, home, checked) => ({ textContent: text, closest: () => home,
    getAttribute: (name) => (name === "aria-checked" ? String(!!checked) : null) });
  // 「Max Preview」是刻意放的诱饵模型：文本命中档位标签集，但不属于 effort 子菜单容器。
  // 只按文本过滤就会把它当最高档点下去 —— 双重语义校验的第二层就是防它。
  const models = [radio("Fable 5", modelMenu), radio("Max Preview", modelMenu), radio("Sonnet 5", modelMenu, true)];
  const tiers = (opts.tiers || ["Low", "MediumDefault", "High", "Extra", "Max"])
    .map((name) => radio(name, effortMenu));
  const trigger = Object.assign({ textContent: "EffortMedium", id: "eff-1" }, attr({ "aria-haspopup": "menu" }));
  let expanded = !!opts.expanded;
  const document = {
    querySelector: (selector) => selector === '[data-testid="model-selector-dropdown"]'
      ? { getAttribute: (name) => (name === "aria-label" ? state.label : null) }
      : (selector === '[role="menuitemradio"]' ? models[0] : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitemradio"]') return expanded ? models.concat(tiers) : models;
      if (selector === '[role="menuitem"][aria-haspopup="menu"]') return opts.dropEntry ? [] : [trigger];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, (el) => { if (el === trigger) expanded = true; });
  S.clickEl = (el) => { clicked.push(el); state.label = "Model: Fable 5 · " + (el.textContent || ""); return true; };
  vm.runInNewContext(source("content/adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["claude.ai"], S, clicked, tiers, models, state };
}

// think 取已知序列里在场的最高档；站点减档时自动退到次高档，而不是写死 High
async function claudeEffortMustTakeHighestKnownTier() {
  for (const [tiers, wanted] of [[null, "Max"], [["Low", "MediumDefault", "High", "Extra"], "Extra"], [["Low", "High"], "High"]]) {
    const c = claudeEffortCase({ tiers: tiers });
    await c.adapter._setEffort();
    const picked = c.clicked.filter((el) => c.tiers.includes(el)).map((el) => el.textContent);
    assert.deepEqual(picked, [wanted], "必须取在场最高档：" + JSON.stringify(tiers));
    assert.equal(c.adapter.state(), "think", "切完必须能被 state() 判成 think");
    assert.equal(c.S.escCount, 1, "选档后必须 escMenus 收尾");
  }
}

// 档位项与模型项同为 menuitemradio：容器不对的「Max Preview」绝不能被当成最高档点下去
async function claudeEffortMustIgnoreModelRadios() {
  const c = claudeEffortCase({ tiers: [] }); // 子菜单展开了但一个档位都没有
  await assert.rejects(async () => c.adapter._setEffort());
  assert.ok(!c.clicked.some((el) => c.models.includes(el)), "绝不能点到模型 radio（含诱饵 Max Preview）");
}

// 入口整个不见了必须抛 —— 2026-08-31 起撤销「无 effort 入口静默 return」那条例外
async function claudeMissingEffortMustThrow() {
  const c = claudeEffortCase({ dropEntry: true });
  await assert.rejects(async () => c.adapter._setEffort());
  assert.equal(c.clicked.length, 0, "找不到 effort 入口时不得点击任何项");
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
  // Claude：querySelector 取文档顺序第一个 → 真发送键从没被点过，带图时确认窗口空转满 90s）。
  // 尺寸取真机形态（24x24、纵向落在带内、横向差着几百像素）——旧桩写成 0x0，被 width>0 挡掉，是假绿。
  let sidebarClicks = 0;
  const sidebarDecoy = { disabled: false, click() { sidebarClicks++; },
    getBoundingClientRect: () => ({ left: 12, right: 36, top: 360, bottom: 384, width: 24, height: 24 }) };
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
  vm.runInNewContext(source("content/send.js"), context);
  const result = await context.window.__AMS.submitPrompt("hello", 0);
  assert.equal(result.ok, true, "发送键点不动时必须退回 Enter 并确认提交成功");
  assert.ok(clicks >= 1, "回退前仍应先尝试原生发送键");
  assert.equal(sidebarClicks, 0, "绝不能点侧栏那个同样匹配、但远离输入框的假发送键");
}

let failed = 0;
(async () => {
  const tests = [twentyPixelComposerMustBeFound, claudeModelInMoreMenuMustBeSelected,
    claudeEffortMustTakeHighestKnownTier, claudeEffortMustIgnoreModelRadios, claudeMissingEffortMustThrow,
    sendMustFallBackToEnterWhenClickIgnored, geminiStateMustFollowModeLabel,
    geminiModelSelectMustCloseItsMenu, geminiThinkingToggleMustBeIdempotent,
    geminiFastMustMatchAnyFlashButNotLite, geminiMenuMustBeClosedByRetriggerWhenEscFails];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ Claude effort 语义校验、Gemini 版本无关快档与菜单收尾兼容");
})();
