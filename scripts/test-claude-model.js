#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let label = "";
const S = {
  adapters: {},
  waitFor: async (fn) => fn(),
  findByText: () => null,
  openMenu() {},
  clickEl() {},
  sleep: async () => {},
  escMenus() {},
};
const context = {
  window: { __AMS: S },
  document: {
    querySelector: (selector) => selector === '[data-testid="model-selector-dropdown"]'
      ? { getAttribute: (name) => name === "aria-label" ? label : null }
      : null,
    querySelectorAll: () => [],
  },
  t: (key) => key,
  console,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content/adapters-intl.js"), "utf8"), context);

const state = S.adapters["claude.ai"].state.bind(S.adapters["claude.ai"]);
for (const [value, expected] of [
  ["Model: Opus 5 High", "think"],
  ["Model: Opus 5 Extra", "think"],
  ["Model: Opus 5 Max", "think"],
  ["Model: Opus 5 Low", "fast"],
  ["Model: Opus 5", "fast"],
  ["Model: Opus 5 Medium", null],
  ["Model: Sonnet 5", "fast"],
]) {
  label = value;
  assert.equal(state(), expected, value);
}
console.log("✓ Claude Opus 5 档位状态识别正确");
