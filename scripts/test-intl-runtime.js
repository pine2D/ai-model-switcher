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

let failed = 0;
for (const test of [chatGptNewTurnMustBeCollected, twentyPixelComposerMustBeFound]) {
  try { test(); }
  catch (error) { failed++; console.error(error.stack || error); }
}
if (failed) process.exitCode = 1;
else console.log("✓ 国际站新版对话结构兼容");
