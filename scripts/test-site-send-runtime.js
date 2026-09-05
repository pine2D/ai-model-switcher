#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(file, "utf8");
function helpers(document, extra = {}) {
  const sleep = () => Promise.resolve();
  const waitFor = async (fn) => fn() || null;
  const findByText = (selector, re) => [...document.querySelectorAll(selector)]
    .find((node) => re.test((node.textContent || "").trim())) || null;
  const S = { waitFor, findByText, openMenu() {}, clickEl(el) { el.click(); }, sleep, escMenus() {}, adapters: {}, ...extra };
  return { document, t: (key) => key, window: { __AMS: S }, MouseEvent: class { constructor(type) { this.type = type; } }, console };
}

// F016：注入硬校验原本只包在 contenteditable 分支里，textarea/input 的 native setter 被受控组件回滚时
// 框仍为空，confirmSubmitted 的「空框 = 已发送」立刻判真 → 一个字没发出去却报绿点（用户无从察觉）。
function coreWithTextarea(rollback) {
  let now = 1000;
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  class Textarea {
    constructor() { this.tagName = "TEXTAREA"; this._value = ""; }
    get value() { return this._value; }
    set value(v) { this._value = rollback ? "" : v; } // 受控编辑器把写入吃掉
    getBoundingClientRect() { return { left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 }; }
    focus() {} dispatchEvent() {}
  }
  const composer = new Textarea();
  const document = {
    body: { dispatchEvent() {}, appendChild() {} }, dispatchEvent() {}, createElement: () => ({}),
    querySelectorAll: (selector) => (selector.startsWith("textarea") ? [composer] : []), querySelector: () => null,
  };
  const context = {
    window: {}, document, location: { hostname: "example.com" }, innerHeight: 800, innerWidth: 900,
    chrome: { runtime: { onMessage: { addListener() {} } } }, t: (key) => key, console,
    HTMLTextAreaElement: Textarea, HTMLInputElement: class {},
    Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, CustomEvent: FakeEvent,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }), matchMedia: () => ({ matches: true }),
    setTimeout: (fn, ms) => { now += ms || 0; queueMicrotask(fn); return 1; }, clearTimeout() {}, Date: { now: () => now },
  };
  vm.runInNewContext(source("content/core.js"), context);
  return { submit: (text) => context.window.__AMS.submitPrompt(text, 0, null), composer };
}

test("textarea 注入被站点回滚时报 inject_failed，绝不当作已发送", async () => {
  const rolled = coreWithTextarea(true);
  const result = await rolled.submit("这是本次群发的问题"); // 跨 realm 对象：逐字段断言，别用 deepEqual
  assert.equal(result.ok, false); assert.equal(result.code, "inject_failed");
  assert.equal(rolled.composer.value, "", "回滚后框仍为空——这正是假成功的入口");
  const plain = coreWithTextarea(false); // 对照：注入成功时不得被这道校验误杀
  assert.equal((await plain.submit("这是本次群发的问题")).code, "submit_unconfirmed");
});

test("DeepSeek 图片档切到 Vision，且无正文时不返回用户消息", async () => {
  let selected = "Instant", deepThink = false;
  const radios = ["Instant", "Expert", "Vision"].map((text) => ({
    textContent: text, click() { selected = text; }, getAttribute(name) { return name === "aria-checked" ? String(selected === text) : null; },
  }));
  const toggle = { textContent: "DeepThink", classList: { contains: () => false },
    click() { deepThink = !deepThink; }, getAttribute(name) { return name === "aria-pressed" ? String(deepThink) : null; } };
  const userMessage = { querySelectorAll: () => [], textContent: "用户问题" };
  const document = { querySelectorAll(selector) {
    if (selector === '[role="radio"]') return radios;
    if (selector === ".ds-toggle-button") return [toggle];
    if (selector === ".ds-message") return [userMessage];
    return [];
  } };
  const context = helpers(document);
  vm.runInNewContext(source("content/adapters-cn.js"), context);
  const deepseek = context.window.__AMS.adapters["deepseek.com"];
  await deepseek.fastImage();
  assert.equal(selected, "Vision");
  assert.equal(deepseek.answer(), null);
});

test("DeepSeek DeepThink 开关点击被吞时抛错，不静默成功", async () => {
  let pressed = false;
  const toggle = { textContent: "DeepThink", getAttribute: (n) => (n === "aria-pressed" ? String(pressed) : null) };
  const document = { querySelectorAll: (s) => (s === ".ds-toggle-button" ? [toggle] : []) };
  const context = helpers(document, { clickEl() {} }); // 站点吞掉点击，aria-pressed 不变
  vm.runInNewContext(source("content/adapters-cn.js"), context);
  await assert.rejects(() => context.window.__AMS.adapters["deepseek.com"]._setDeepThink(true), /DeepThink 未生效/);
});

test("豆包识别带品牌和版本前缀的模式文案", async () => {
  let selected = "豆包 快速", menuOpen = false;
  const modeButton = {
    textContent: selected,
    children: [],
    getBoundingClientRect: () => ({ x: 700, y: 800, width: 100, height: 32 }),
  };
  const expert = { textContent: "豆包 2.1 Turbo 专家", click() { selected = "豆包 2.1 Turbo"; modeButton.textContent = selected; } };
  const document = { querySelectorAll(selector) {
    if (selector === "button") return [modeButton];
    if (selector === '[role="menuitem"]') return menuOpen ? [expert] : [];
    return [];
  } };
  const context = helpers(document, { openMenu() { menuOpen = true; } });
  vm.runInNewContext(source("content/adapters-cn.js"), context);
  const doubao = context.window.__AMS.adapters["doubao.com"];
  assert.equal(doubao.state(), "fast");
  await doubao.think();
  assert.equal(doubao.state(), "think");
});

test("Kimi 走工具菜单取 file input 时收尾 escMenus 且等待夹取 deadline，并能确认最后一条用户消息", async () => {
  let input = null, attached = null, escCount = 0, waited = null;
  const toolkit = { click() { input = { className: "hidden-input" }; } };
  const oldUser = { querySelector: () => ({ textContent: "旧问题" }) };
  const lastUser = { querySelector: () => ({ textContent: "  新问题\n第二行  " }) };
  const document = {
    querySelector(selector) {
      if (selector === ".toolkit-trigger-btn") return toolkit;
      if (selector === 'input.hidden-input[type="file"]') return input;
      return null;
    },
    querySelectorAll(selector) { return selector === ".chat-content-item-user" ? [oldUser, lastUser] : []; },
  };
  const context = helpers(document, {
    waitFor: async (fn, ms) => { waited = ms; return fn(); },
    escMenus() { escCount++; },
    setInputFiles(found, files, el, deadline) { attached = { found, files, el, deadline }; return Promise.resolve(true); },
    dropFiles() { return Promise.resolve(false); },
  });
  vm.runInNewContext(source("content/adapters-cn2.js"), context);
  const kimi = context.window.__AMS.adapters["kimi.com"], files = [{ name: "probe.png" }], composer = {};
  const deadline = Date.now() + 900; // < 1500，等待必须被夹到剩余预算
  assert.equal(await kimi.attach(files, composer, deadline), true);
  assert.equal(attached.found, input);
  assert.equal(escCount, 1, "走 toolkit 分支必须收尾 escMenus，否则罩住输入框");
  assert.ok(waited > 0 && waited <= 900, "等待必须夹取到 deadline 剩余预算，不是硬编码 1500");
  assert.equal(kimi.submitted("新问题 第二行"), true);
  assert.equal(kimi.submitted("别的问题"), false);
});

test("Kimi 模型名与菜单项文案含零宽字符时，判档和真实 _select 比对都不失效", async () => {
  const zwsp = String.fromCharCode(0x200b); // 避免在源码里字面写 ​ 转义序列
  let clickedItem = false;
  const entry = { classList: { contains: () => false }, click() {},
    querySelector: (s) => (s === ".name" ? { textContent: "K3" + zwsp } : s === ".current-effort" ? { textContent: "Max" } : null) };
  const modelItem = { querySelector: (s) => (s === ".name" ? { textContent: "K3" + zwsp } : null), click() { clickedItem = true; } };
  const document = { querySelector: (s) => (s === ".current-model" ? entry : null),
    querySelectorAll: (s) => (s === ".model-item" ? [modelItem] : []) };
  const context = helpers(document);
  vm.runInNewContext(source("content/adapters-cn2.js"), context);
  const kimi = context.window.__AMS.adapters["kimi.com"];
  assert.equal(kimi.state(), "think", "模型名带零宽字符不该让判档失效");
  await kimi._select("K3"); // 真实调用，不 stub：菜单项 .name 也带零宽字符
  assert.equal(clickedItem, true, "菜单项文案带零宽字符时精确等值比对仍要命中并点击");
});

test("元宝新模式菜单映射 Instant 与 Thinking，并使用语义发送键", async () => {
  let selected = "Instant", menuOpen = false, sent = false;
  const trigger = {
    textContent: selected,
    click() { menuOpen = true; },
    getAttribute(name) { return name === "aria-label" ? "Switch model" : null; },
  };
  const item = (text) => ({
    textContent: text,
    getAttribute(name) { return name === "aria-checked" ? String(selected === text) : null; },
    click() { selected = text; trigger.textContent = text; menuOpen = false; },
  });
  const items = [item("Instant"), item("Thinking"), item("Expert")];
  const send = { className: "SendButton_sendButton", getAttribute: () => null, click() { sent = true; } };
  const document = {
    querySelector(selector) {
      if (selector === 'button[aria-label="Switch model"], button[aria-label="切换模型"]') return trigger;
      if (selector === '[aria-label="Send"], [aria-label="发送"]') return send;
      return null;
    },
    querySelectorAll(selector) { return selector === '[role="menuitemradio"]' && menuOpen ? items : []; },
  };
  const context = helpers(document, { openMenu: (el) => el.click(), dropFiles: () => Promise.resolve(true) });
  vm.runInNewContext(source("content/adapters-cn2.js"), context);
  const yuanbao = context.window.__AMS.adapters["yuanbao.tencent.com"];
  assert.equal(yuanbao.state(), "fast");
  await yuanbao.think();
  assert.equal(yuanbao.state(), "think");
  yuanbao.submit();
  assert.equal(sent, true);
});

// 切档链路（core.js 的 runModeNow / switchTier）：把 escMenus 的 Escape、toast 文案与适配器调用记在同一条
// 序列上，就能断言「谁在谁之后发生」。composer 只为让 submitPrompt 消息入口走完全程。
function coreWithAdapter(adapter) {
  const seq = [], toasts = [], debug = [];
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const composer = { tagName: "DIV", textContent: "", focus() {}, dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, right: 400, top: 100, bottom: 140, width: 400, height: 40 }) };
  const context = {
    window: {}, location: { hostname: "example.com" }, innerHeight: 800, innerWidth: 900,
    console: { debug: (...args) => debug.push(args.join(" ")) },
    document: {
      body: { dispatchEvent: (event) => { seq.push(event.key === "Escape" ? "esc" : event.type); return true; },
        appendChild: (node) => toasts.push(node.textContent) },
      dispatchEvent() {}, createElement: () => ({ setAttribute() {}, style: {} }), // 无 animate：toast 自带 try/catch，追加后即止，不留 2.4s 退场定时器
      querySelectorAll: (selector) => (selector.startsWith("textarea") ? [composer] : []), querySelector: () => null,
    },
    chrome: { runtime: { onMessage: { addListener(fn) { context.listener = fn; } } } }, t: (key) => key,
    Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, CustomEvent: FakeEvent,
    matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, Date,
    getSelection: () => { throw new Error("no selection"); },
  };
  vm.runInNewContext(source("content/core.js"), context);
  context.window.__AMS.adapters["example.com"] = adapter;
  return { S: context.window.__AMS, seq, toasts, debug, send: (message) => new Promise((resolve) =>
    context.listener(Object.assign({ source: "AMS", cmd: "submitPrompt" }, message), null, resolve)) };
}

test("切档失败不在站点视图内弹横幅，原因降级进控制台，并在最后一次失败后收尾菜单", async () => {
  const c = coreWithAdapter({ state: () => null,
    think: async () => { c.seq.push("adapter"); throw new Error("Gemini: 模型菜单未展开"); } });
  await c.S.runMode("think");
  // toast 已收口为 no-op（用户可见反馈由 Desktop 外壳负责）：站点视图内不得再追加任何提示节点；
  // 适配器抛的硬编码简体只降级进控制台，不进用户可见文案
  assert.deepEqual(c.toasts, []);
  assert.ok(c.debug.some((line) => line.includes("Gemini: 模型菜单未展开")), "原因不能丢，降级到控制台/诊断");
  assert.ok(c.seq.lastIndexOf("esc") > c.seq.lastIndexOf("adapter"),
    "最后一次切档失败后必须 escMenus 收尾——残留菜单会罩住输入框，让紧随其后的注入点空");
});

test("切档超时后不提交，交给用户 retry", async () => {
  const c = coreWithAdapter({ state: () => "fast", // 永远读不到 think：切档卡在半途
    think: async () => { await new Promise((resolve) => setTimeout(resolve, 400)); } });
  const reply = await c.send({ text: "问题", tier: "think", deadline: Date.now() + 300 });
  assert.equal(reply.code, "timeout"); // 预算耗尽即止，绝不重发（提交不确定 ≠ 可以重发）
});

test("千问新模式按钮可读，think 与 fast 使用当前可用模型，切档成功后收尾 escMenus", async () => {
  const trigger = { textContent: "Qwen3.8-Max", children: [], getAttribute: () => null };
  let label = "快速", menuOpen = false, escCount = 0;
  const modeButton = {
    className: "", textContent: label, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 80, height: 32 }),
    getAttribute(name) { return name === "aria-haspopup" ? "menu" : name === "aria-label" ? label : null; },
    dispatchEvent(event) { if (event.type === "pointerdown") menuOpen = true; },
  };
  const item = (text) => ({ textContent: text, getBoundingClientRect: () => ({ width: 180, height: 40 }), click() { label = text; modeButton.textContent = text; menuOpen = false; } });
  const fastItem = item("快速"), thinkItem = item("思考研究");
  const document = { querySelectorAll(selector) {
    if (selector === '[aria-haspopup="dialog"]') return [trigger];
    if (selector === "div,button,span") return [trigger];
    if (selector === "button" || selector === 'button[aria-haspopup="menu"]') return [modeButton];
    if (selector === '[role="menuitemcheckbox"]') return menuOpen ? [fastItem, thinkItem] : [];
    return [];
  } };
  const context = helpers(document, { escMenus() { escCount++; } });
  vm.runInNewContext(source("content/adapters-cn.js"), context);
  const qwen = context.window.__AMS.adapters["qianwen.com"];
  assert.equal(qwen.state(), "fast");
  trigger.textContent = "Qwen3.7-千问";
  await qwen._setThink(true);
  assert.equal(qwen.state(), "think");
  assert.ok(escCount >= 1, "_setThink 成功路径必须收尾 escMenus，否则菜单会罩住输入框");

  const models = [];
  qwen._selectModel = async (re) => { models.push(re); };
  qwen._setThink = async () => {};
  await qwen.think(); await qwen.fast();
  assert.equal(models[0].test("Qwen3.7-千问"), true);
  assert.equal(models[0].test("Qwen3.7-Max"), false);
  assert.equal(models[1].test("Qwen3.8-Max"), true);
});

test("千问 _setThink 选项缺失或点击被吞时仍收尾 escMenus，且抛错不静默成功", async () => {
  function run(scenario) {
    let label = "快速", menuOpen = false, escCount = 0;
    const btn = {
      getBoundingClientRect: () => ({ width: 80, height: 32 }),
      getAttribute(n) { return n === "aria-haspopup" ? "menu" : n === "aria-label" ? label : null; },
      get textContent() { return label; },
      dispatchEvent(e) { if (e.type === "pointerdown") menuOpen = true; },
    };
    const opt = { getBoundingClientRect: () => ({ width: 180, height: 40 }), textContent: "思考研究",
      click() { menuOpen = false; if (scenario !== "swallowed") label = "思考研究"; } };
    const document = { querySelectorAll(s) {
      if (s === "button" || s === 'button[aria-haspopup="menu"]') return [btn];
      if (s === '[role="menuitemcheckbox"]') return menuOpen && scenario !== "missing" ? [opt] : [];
      return [];
    } };
    const context = helpers(document, { escMenus() { escCount++; } });
    vm.runInNewContext(source("content/adapters-cn.js"), context);
    return { qwen: context.window.__AMS.adapters["qianwen.com"], esc: () => escCount };
  }
  const missing = run("missing");
  await assert.rejects(() => missing.qwen._setThink(true), /模式选项未找到/);
  assert.ok(missing.esc() >= 1, "选项未找到也必须收尾 escMenus");
  const swallowed = run("swallowed");
  await assert.rejects(() => swallowed.qwen._setThink(true), /思考开关未生效/);
  assert.ok(swallowed.esc() >= 1, "复读失败也必须收尾 escMenus");
});
