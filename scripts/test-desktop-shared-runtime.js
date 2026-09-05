#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PRELOAD, preloadRequires } = require("./lib/desktop-anchors");

const ROOT = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function runAsBundledModule(file, context) {
  vm.runInContext(`(function () {\n${source(file)}\n})()`, context, { filename: file });
}

function baseDocument() {
  return {
    body: { appendChild() {}, dispatchEvent() {} },
    documentElement: { lang: "" },
    createElement: () => ({}),
    dispatchEvent() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function baseContext(extra = {}) {
  class FakeEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
  }
  return vm.createContext({
    console,
    Date,
    setTimeout,
    clearTimeout,
    CustomEvent: FakeEvent,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    matchMedia: () => ({ matches: false }),
    innerHeight: 900,
    innerWidth: 1440,
    location: { hostname: "unknown.invalid", protocol: "https:" },
    document: baseDocument(),
    localStorage: {},
    window: {},
    ...extra,
  });
}

function chromeForI18n() {
  return {
    i18n: { getUILanguage: () => "zh-CN" },
    storage: {
      local: { get(defaults, callback) { callback(defaults); } },
      onChanged: { addListener() {} },
    },
  };
}

function runtime() {
  return {
    adapters: {},
    waitFor: async (fn) => fn(),
    findByText: () => null,
    openMenu() {},
    clickEl() {},
    sleep: async () => {},
    escMenus() {},
    getState: () => null,
    findComposer: () => null,
  };
}

function i18nMustExposeDesktopNamespace() {
  const context = baseContext({ chrome: chromeForI18n() });
  runAsBundledModule("i18n.js", context);
  assert.equal(typeof context.__AMS_I18N__?.t, "function",
    "i18n 必须向隔离的 desktop preload 模块暴露翻译函数");
  assert.equal(context.__AMS_I18N__.t("cs_siteAdapter"), "站点适配器");
}

function coreMustResolveTranslationAcrossModuleBoundary() {
  let listener = null;
  const context = baseContext({
    __AMS_I18N__: Object.freeze({ t: (key) => `desktop:${key}` }),
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  runAsBundledModule("content/core.js", context);
  assert.equal(typeof listener, "function");
  assert.equal(context.window.__AMS.diagnose()[0].name, "desktop:cs_siteAdapter");
}

function adapterMustResolveTranslation(file, host, expectedKey) {
  const S = runtime();
  const context = baseContext({
    __AMS_I18N__: Object.freeze({ t: (key) => `desktop:${key}` }),
    window: { __AMS: S },
  });
  runAsBundledModule(file, context);
  const checks = S.adapters[host].diagnose();
  assert.equal(checks[0].name, `desktop:${expectedKey}`, `${file} 必须使用 desktop i18n 命名空间`);
}

function diagMustResolveTranslationAcrossModuleBoundary() {
  const S = runtime();
  S.adapters["example.com"] = { state: () => null };
  const context = baseContext({
    __AMS_I18N__: Object.freeze({ t: (key) => `desktop:${key}` }),
    window: { __AMS: S },
  });
  runAsBundledModule("content/diag.js", context);
  assert.equal(S.adapters["example.com"].diagnose()[0].name, "desktop:diag_composer");
}

// 磁盘上每一个 content/*.js 都必须被 preload require（没有豁免：扩展专用的 pill.js 已随扩展删除）。
// preload 注入的完整顺序链：i18n 先于一切；core 先于 send/upload/md（它们读 window.__AMS）；
// 四卷适配器先于 generation/diag（后两者包装 __AMS.adapters）。新开一卷适配器要在这里登记位置。
const PRELOAD_CHAIN = Object.freeze([
  "i18n.js",
  "content/core.js",
  "content/send.js",
  "content/upload.js",
  "content/md.js",
  "content/adapters-intl.js",
  "content/adapters-intl2.js",
  "content/adapters-cn.js",
  "content/adapters-cn2.js",
  "content/generation.js",
  "content/diag.js",
]);

// 自洽锚点：preload 的 require 列表 ↔ 磁盘上的 content/*.js 双向覆盖 + 完整顺序链。
// 扩展已删除，这一条就是注入清单与顺序的真源。
function preloadRequiresMustCoverContentDirBothWaysInFixedOrder() {
  const preloadFiles = preloadRequires();
  for (const file of preloadFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${PRELOAD} require 了不存在的文件 ${file}`);
  }
  const onDisk = fs.readdirSync(path.join(ROOT, "content")).filter((name) => name.endsWith(".js")).map((name) => `content/${name}`);
  const missingFromPreload = onDisk.filter((file) => !preloadFiles.includes(file));
  assert.deepEqual(missingFromPreload, [],
    `content/ 里这些文件不在 ${PRELOAD} 的 require 列表里：${missingFromPreload.join(", ")}`);
  assert.deepEqual(preloadFiles, [...PRELOAD_CHAIN],
    `${PRELOAD} 的 require 顺序必须与 PRELOAD_CHAIN 完整一致（新增/搬家/重排都要同步这张表）`);
}

// 漏登记 send.js 的后果是静默的：九站按钮路径全部退化成纯 Enter 兜底，没有任何报错。
// 这条断言按两端真实加载顺序跑一遍，确认 sendBtn 真的挂上了并且能选出发送键。
function sendBtnMustBeExposedByTheSharedRuntime() {
  const composerRect = { left: 100, right: 700, top: 418, bottom: 440, width: 600, height: 22 };
  const composer = { getBoundingClientRect: () => composerRect, parentElement: null };
  const button = { disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 660, right: 692, top: 475, bottom: 507, width: 32, height: 32 }) };
  const context = {
    window: { __AMS: { findComposer: () => composer } },
    document: { querySelectorAll: () => [button] },
    getComputedStyle: () => ({ overflowX: "visible", overflowY: "visible" }),
  };
  vm.runInNewContext(source("content/send.js"), context);
  assert.equal(typeof context.window.__AMS.sendBtn, "function",
    "content/send.js 必须把 sendBtn 挂到 __AMS 上（漏登记时九站按钮路径静默退化成纯 Enter）");
  assert.equal(context.window.__AMS.sendBtn(composer), button, "sendBtn 必须选出挨着输入框的发送键");
}

i18nMustExposeDesktopNamespace();
coreMustResolveTranslationAcrossModuleBoundary();
adapterMustResolveTranslation("content/adapters-intl.js", "claude.ai", "diag_modelEntry");
adapterMustResolveTranslation("content/adapters-intl2.js", "chatgpt.com", "diag_intelEntry");
adapterMustResolveTranslation("content/adapters-cn.js", "deepseek.com", "diag_deepThink");
adapterMustResolveTranslation("content/adapters-cn2.js", "kimi.com", "diag_modelEntry");
diagMustResolveTranslationAcrossModuleBoundary();
preloadRequiresMustCoverContentDirBothWaysInFixedOrder();
sendBtnMustBeExposedByTheSharedRuntime();
console.log("desktop shared runtime tests passed");
