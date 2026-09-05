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

// pill.js：扩展专用三态悬浮控件，依赖 chrome.storage.onChanged 实时生效（content/pill.js:1），
// 不进桌面 preload——docs/desktop-m0.md 已将其列为既有排除项。
// 语义：磁盘上存在、但刻意不进 preload 的 content 文件必须显式登记在这里，否则下面的双向覆盖会红。
const EXTENSION_ONLY_CONTENT_SCRIPTS = new Set(["content/pill.js"]);
// generation.js：桌面专用只读生成态探针，被 desktop/src/preload/site.ts 的 readGeneration()
// 独占消费，不进扩展 manifest（其读取逻辑走 __AMS.adapters[key].generation()，扩展侧没有消费方）。
const DESKTOP_ONLY_PRELOAD_SCRIPTS = new Set(["content/generation.js"]);
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
// 扩展退役后 manifest.json 不复存在，这一条才是注入清单与顺序的真源。
function preloadRequiresMustCoverContentDirBothWaysInFixedOrder() {
  const preloadFiles = preloadRequires();
  for (const file of preloadFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${PRELOAD} require 了不存在的文件 ${file}`);
  }
  const onDisk = fs.readdirSync(path.join(ROOT, "content")).filter((name) => name.endsWith(".js")).map((name) => `content/${name}`);
  const missingFromPreload = onDisk.filter((file) => !preloadFiles.includes(file) && !EXTENSION_ONLY_CONTENT_SCRIPTS.has(file));
  assert.deepEqual(missingFromPreload, [],
    `content/ 里这些文件既不在 ${PRELOAD} 的 require 列表里、也没登记为扩展专用：${missingFromPreload.join(", ")}`);
  assert.deepEqual(preloadFiles, [...PRELOAD_CHAIN],
    `${PRELOAD} 的 require 顺序必须与 PRELOAD_CHAIN 完整一致（新增/搬家/重排都要同步这张表）`);
}

// TODO(Step 9)：manifest 随扩展一起删，这条 manifest↔preload 对拍届时整段删除；此刻并存只为证明新锚点抽对了。
function manifestAndDesktopPreloadShareContentScriptsExceptKnownExemptions() {
  const manifest = JSON.parse(source("manifest.json"));
  const manifestFiles = manifest.content_scripts[0].js;
  const preloadFiles = preloadRequires();

  assert.ok(manifestFiles.length > 5, "manifest content_scripts[0].js 读取失败或结构变了");
  assert.ok(preloadFiles.length > 5, "desktop preload require 列表读取失败或结构变了");

  const manifestSet = new Set(manifestFiles.filter((file) => !EXTENSION_ONLY_CONTENT_SCRIPTS.has(file)));
  const preloadSet = new Set(preloadFiles.filter((file) => !DESKTOP_ONLY_PRELOAD_SCRIPTS.has(file)));

  assert.deepEqual(
    [...manifestSet].sort(),
    [...preloadSet].sort(),
    "manifest content_scripts 与 desktop preload/site.ts 的 require 列表（除 pill.js / generation.js 两条已知豁免外）必须一致——" +
    "core.js 拆分或新增适配器文件时若只改一边，这里会红"
  );
  // diag.js 必须排在全部 adapters-*.js 之后：该顺序约束已由 scripts/test-diag-runtime.js 单独守着，此处只比较集合。
  // send.js 必须排在 core.js 之后（它读 window.__AMS），两端都要——集合相等挡不住顺序错。
  for (const [label, files] of [["manifest", manifestFiles], ["desktop preload", preloadFiles]]) {
    const core = files.indexOf("content/core.js");
    const send = files.indexOf("content/send.js");
    assert.ok(core >= 0 && send > core,
      label + " 里 content/send.js 必须排在 content/core.js 之后，否则它读不到 window.__AMS 直接静默退出");
  }
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
manifestAndDesktopPreloadShareContentScriptsExceptKnownExemptions();
sendBtnMustBeExposedByTheSharedRuntime();
console.log("desktop shared runtime tests passed");
