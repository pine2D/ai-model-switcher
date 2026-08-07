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

test("Kimi 使用工具菜单生成的 file input，并能确认最后一条用户消息", async () => {
  let input = null, attached = null;
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
    setInputFiles(found, files, el, deadline) { attached = { found, files, el, deadline }; return Promise.resolve(true); },
    dropFiles() { return Promise.resolve(false); },
  });
  vm.runInNewContext(source("content/adapters-cn2.js"), context);
  const kimi = context.window.__AMS.adapters["kimi.com"], files = [{ name: "probe.png" }], composer = {};
  assert.equal(await kimi.attach(files, composer, 123), true);
  assert.equal(attached.found, input);
  assert.equal(kimi.submitted("新问题 第二行"), true);
  assert.equal(kimi.submitted("别的问题"), false);
});

test("千问新模式按钮可读，think 与 fast 使用当前可用模型", async () => {
  const trigger = { textContent: "Qwen3.8-Max", children: [], getAttribute: () => null };
  let label = "快速", menuOpen = false;
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
  const context = helpers(document);
  vm.runInNewContext(source("content/adapters-cn.js"), context);
  const qwen = context.window.__AMS.adapters["qianwen.com"];
  assert.equal(qwen.state(), "fast");
  trigger.textContent = "Qwen3.7-千问";
  await qwen._setThink(true);
  assert.equal(qwen.state(), "think");

  const models = [];
  qwen._selectModel = async (re) => { models.push(re); };
  qwen._setThink = async () => {};
  await qwen.think(); await qwen.fast();
  assert.equal(models[0].test("Qwen3.7-千问"), true);
  assert.equal(models[0].test("Qwen3.7-Max"), false);
  assert.equal(models[1].test("Qwen3.8-Max"), true);
});
