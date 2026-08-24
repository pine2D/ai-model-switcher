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

i18nMustExposeDesktopNamespace();
coreMustResolveTranslationAcrossModuleBoundary();
adapterMustResolveTranslation("content/adapters-intl.js", "claude.ai", "diag_modelEntry");
adapterMustResolveTranslation("content/adapters-cn.js", "deepseek.com", "diag_deepThink");
adapterMustResolveTranslation("content/adapters-cn2.js", "kimi.com", "diag_modelEntry");
diagMustResolveTranslationAcrossModuleBoundary();
console.log("desktop shared runtime tests passed");
