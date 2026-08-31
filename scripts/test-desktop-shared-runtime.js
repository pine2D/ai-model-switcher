#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
const EXTENSION_ONLY_CONTENT_SCRIPTS = new Set(["content/pill.js"]);
// generation.js：桌面专用只读生成态探针，被 desktop/src/preload/site.ts 的 readGeneration()
// 独占消费，不进扩展 manifest（其读取逻辑走 __AMS.adapters[key].generation()，扩展侧没有消费方）。
const DESKTOP_ONLY_PRELOAD_SCRIPTS = new Set(["content/generation.js"]);

function manifestAndDesktopPreloadShareContentScriptsExceptKnownExemptions() {
  const manifest = JSON.parse(source("manifest.json"));
  const manifestFiles = manifest.content_scripts[0].js;
  const preloadSource = source("desktop/src/preload/site.ts");
  const requireRe = /require\("\.\.\/\.\.\/\.\.\/(.+?)"\)/g;
  const preloadFiles = [...preloadSource.matchAll(requireRe)].map((match) => match[1]);

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
}

i18nMustExposeDesktopNamespace();
coreMustResolveTranslationAcrossModuleBoundary();
adapterMustResolveTranslation("content/adapters-intl.js", "claude.ai", "diag_modelEntry");
adapterMustResolveTranslation("content/adapters-intl2.js", "chatgpt.com", "diag_intelEntry");
adapterMustResolveTranslation("content/adapters-cn.js", "deepseek.com", "diag_deepThink");
adapterMustResolveTranslation("content/adapters-cn2.js", "kimi.com", "diag_modelEntry");
diagMustResolveTranslationAcrossModuleBoundary();
manifestAndDesktopPreloadShareContentScriptsExceptKnownExemptions();
console.log("desktop shared runtime tests passed");
