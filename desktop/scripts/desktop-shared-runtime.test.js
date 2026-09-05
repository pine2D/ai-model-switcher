#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, PRELOAD, SITE_RUNTIME, preloadRequires } = require("./lib/desktop-anchors");

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

// i18n.js 不再碰 chrome.* 与任何存储：语言只由外壳经 setLang 单向注入（接受 zh_CN/zh_TW，也接受 locale.ts 的 zhCN/zhTW）。
function i18nMustExposeDesktopNamespace() {
  const context = baseContext();
  runAsBundledModule(`${SITE_RUNTIME}/i18n.js`, context);
  const i18n = context.__AMS_I18N__;
  assert.equal(typeof i18n?.t, "function", "i18n 必须向隔离的 desktop preload 模块暴露翻译函数");
  assert.equal(typeof i18n?.setLang, "function", "i18n 必须暴露 setLang 供外壳注入语言");
  assert.equal(i18n.t("cs_siteAdapter"), "Site adapter", "未注入语言前一律 en");
  i18n.setLang("zh_TW");
  assert.equal(i18n.t("diag_composer"), "輸入框");
  i18n.setLang("zhCN");
  assert.equal(i18n.t("diag_composer"), "输入框", "必须接受 locale.ts 的 zhCN 写法");
  i18n.setLang("fr");
  assert.equal(i18n.t("diag_composer"), "Composer", "未知语言落 en");
  assert.equal(i18n.t("no_such_key"), "no_such_key", "缺词条时返回 key 本身，别抛");
  assert.doesNotMatch(source(`${SITE_RUNTIME}/i18n.js`), /chrome\.|localStorage|applyI18n|_resolveAuto/, "i18n.js 不得再读 chrome.* / localStorage，也不得自己解析 locale");
}

// 词条覆盖双向对账：site-runtime 里每个 t("x") 的 key 必须在 i18n.js 存在且三语齐全；反过来 i18n.js 里
// 派生清单与显式补充清单都没有的 key = 死词条，必须红（否则瘦身之后又会长出新的死词条）。
// 收紧的派生正则：前缀必须是非标识符字符（挡住 createElement("div") 与 act("think")），键允许大小写与数字（diag_* 是驼峰）。
const TERNARY_KEYS = ["cs_switchedThink", "cs_switchedFast"]; // core.js runMode：toast(t(mode === "think" ? … : …))，正则抠不到
function i18nKeysMustMatchSiteRuntimeUsage() {
  const used = new Set(TERNARY_KEYS);
  for (const file of preloadRequires()) {
    if (file.endsWith("/i18n.js")) continue;
    for (const m of source(file).matchAll(/(^|[^A-Za-z0-9_$.])t\("([A-Za-z0-9_]+)"\)/g)) used.add(m[2]);
  }
  assert.ok(used.size >= 15, `派生清单只抽到 ${used.size} 条，正则或 require 列表坏了`);
  const rows = new Map();
  for (const m of source(`${SITE_RUNTIME}/i18n.js`).matchAll(/^\s+([A-Za-z0-9_]+):\s*\{([^}]*)\},?\s*$/gm)) rows.set(m[1], m[2]);
  for (const key of used) {
    assert.ok(rows.has(key), `site-runtime 用到 t("${key}")，但 i18n.js 没有这条词条——Alt+H 检查名会裸露 key`);
    for (const lang of ["en", "zh_CN", "zh_TW"]) assert.match(rows.get(key), new RegExp(`\\b${lang}:`), `i18n.js 的 ${key} 缺 ${lang}`);
  }
  for (const key of rows.keys()) assert.ok(used.has(key), `i18n.js 的 ${key} 没有任何 t("${key}") 调用点 → 死词条，删掉或把调用点写进 TERNARY_KEYS`);
}

// chrome.runtime.onMessage 监听器注册点有且只有一个（core.js）：preload 的 dispatch 是遍历分发，多一个监听器
// 就会有两方争抢同一条命令；少一个则九站收不到任何命令。放在离线测试里数，绝不在 preload 模块作用域硬断言。
function siteRuntimeMustRegisterExactlyOneMessageListener() {
  let count = 0;
  for (const file of preloadRequires()) count += (source(file).match(/onMessage\.addListener\(/g) ?? []).length;
  assert.equal(count, 1, "site-runtime 里 chrome.runtime.onMessage.addListener 必须恰好出现一次");
  assert.doesNotMatch(source("desktop/src/preload/site.ts"), /listeners\[0\]/, "preload 不得只取第一个监听器");
}

function coreMustResolveTranslationAcrossModuleBoundary() {
  let listener = null;
  const context = baseContext({
    __AMS_I18N__: Object.freeze({ t: (key) => `desktop:${key}` }),
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  runAsBundledModule(`${SITE_RUNTIME}/core.js`, context);
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
  runAsBundledModule(`${SITE_RUNTIME}/diag.js`, context);
  assert.equal(S.adapters["example.com"].diagnose()[0].name, "desktop:diag_composer");
}

// 磁盘上 site-runtime 的每一个 *.js 都必须被 preload require（没有豁免：扩展专用的 pill.js 已随扩展删除）。
// preload 注入的完整顺序链：i18n 先于一切；core 先于 send/upload/md（它们读 window.__AMS）；
// 四卷适配器先于 generation/diag（后两者包装 __AMS.adapters）。新开一卷适配器要在这里登记位置。
const PRELOAD_CHAIN = Object.freeze(["i18n", "core", "send", "upload", "md", "adapters-intl", "adapters-intl2",
  "adapters-cn", "adapters-cn2", "generation", "diag"].map((name) => `${SITE_RUNTIME}/${name}.js`));

// 自洽锚点：preload 的 require 列表 ↔ 磁盘上的 site-runtime/*.js 双向覆盖 + 完整顺序链。
// 扩展已删除，这一条就是注入清单与顺序的真源。
function preloadRequiresMustCoverContentDirBothWaysInFixedOrder() {
  const preloadFiles = preloadRequires();
  for (const file of preloadFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${PRELOAD} require 了不存在的文件 ${file}`);
  }
  const onDisk = fs.readdirSync(path.join(ROOT, SITE_RUNTIME)).filter((name) => name.endsWith(".js")).map((name) => `${SITE_RUNTIME}/${name}`);
  const missingFromPreload = onDisk.filter((file) => !preloadFiles.includes(file));
  assert.deepEqual(missingFromPreload, [],
    `${SITE_RUNTIME}/ 里这些文件不在 ${PRELOAD} 的 require 列表里：${missingFromPreload.join(", ")}`);
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
  vm.runInNewContext(source(`${SITE_RUNTIME}/send.js`), context);
  assert.equal(typeof context.window.__AMS.sendBtn, "function",
    "site-runtime/send.js 必须把 sendBtn 挂到 __AMS 上（漏登记时九站按钮路径静默退化成纯 Enter）");
  assert.equal(context.window.__AMS.sendBtn(composer), button, "sendBtn 必须选出挨着输入框的发送键");
}

i18nMustExposeDesktopNamespace();
i18nKeysMustMatchSiteRuntimeUsage();
siteRuntimeMustRegisterExactlyOneMessageListener();
coreMustResolveTranslationAcrossModuleBoundary();
adapterMustResolveTranslation(`${SITE_RUNTIME}/adapters-intl.js`, "claude.ai", "diag_modelEntry");
adapterMustResolveTranslation(`${SITE_RUNTIME}/adapters-intl2.js`, "chatgpt.com", "diag_intelEntry");
adapterMustResolveTranslation(`${SITE_RUNTIME}/adapters-cn.js`, "deepseek.com", "diag_deepThink");
adapterMustResolveTranslation(`${SITE_RUNTIME}/adapters-cn2.js`, "kimi.com", "diag_modelEntry");
diagMustResolveTranslationAcrossModuleBoundary();
preloadRequiresMustCoverContentDirBothWaysInFixedOrder();
sendBtnMustBeExposedByTheSharedRuntime();
console.log("desktop shared runtime tests passed");
