#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

function consoleContract() {
  const html = read("console/console.html");
  const ui = read("console/console.js");
  const status = read("console/status.js");
  const background = read("background.js");
  const broadcast = read("bg/broadcast.js");
  assert.ok(fs.existsSync(path.join(ROOT, "console/images.js")), "多图状态应拆到 console/images.js");
  assert.match(html, /id="image-input"[^>]*\bmultiple\b/);
  assert.match(html, /images\.js[\s\S]*console\.js/);
  assert.match(ui, /action:\s*"sendAll"[^}]*\bimages\b/);
  assert.match(ui, /lastSend\.images/);
  assert.match(status, /lastSend\.images/);
  assert.match(background, /msg\.images\s*\|\|\s*\[\]/);
  assert.match(broadcast, /images\s*=\s*\[\]/);
  assert.match(broadcast, /hasImage:\s*images\.length\s*>\s*0/);
  assert.match(broadcast, /cmd:\s*"submitPrompt"[^}]*images/s);
}

async function consoleImageState() {
  const listeners = {};
  const imageButton = {
    dataset: {}, title: "",
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, fn) { listeners["image:" + type] = fn; },
  };
  const imageInput = {
    value: "", files: [],
    addEventListener(type, fn) { listeners["input:" + type] = fn; },
    click() {},
  };
  const prompt = { addEventListener(type, fn) { listeners["prompt:" + type] = fn; } };
  const notes = [];
  class Reader {
    readAsDataURL(file) { this.result = "data:" + file.name; this.onload(); }
  }
  const context = vm.createContext({
    document: { getElementById: (id) => ({ image: imageButton, "image-input": imageInput, prompt }[id]) },
    FileReader: Reader,
    flashNote: (value) => notes.push(value),
    t: (key, ...args) => key + ":" + args.join("|"),
    console,
  });
  vm.runInContext(read("console/images.js") +
    ";globalThis.__test={chooseImages,imagePayloads,get:()=>pendingImages};", context);
  const file = (name, size = 1024) => ({ name, size, type: "image/png" });
  assert.equal(context.__test.chooseImages([file("1.png"), file("2.png"), file("3.png"), file("4.png")]), true);
  assert.equal(context.__test.get().length, 4);
  assert.equal((await context.__test.imagePayloads(context.__test.get())).length, 4);
  assert.equal(context.__test.chooseImages([1, 2, 3, 4, 5].map((n) => file(n + ".png"))), false);
  assert.equal(context.__test.get().length, 4, "无效新批次不得清掉原选择");
  assert.equal(context.__test.chooseImages([file("large.png", 10 * 1024 * 1024), file("extra.png")]), false);
  listeners["image:click"]();
  assert.equal(context.__test.get().length, 0);
  assert.ok(notes.length >= 3);
}

async function batchUploadContract() {
  let now = 1000, shown = false, changes = 0;
  class FakeFile {
    constructor(parts, name, options) {
      this.bytes = Buffer.from(parts[0]); this.name = name;
      this.type = options.type; this.size = this.bytes.length;
    }
  }
  class FakeTransfer {
    constructor() {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    }
  }
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const rect = { left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 };
  const preview = (name, index) => ({
    tagName: "IMG", className: "", textContent: "", src: "blob:" + index,
    getAttribute: (attr) => attr === "alt" ? name : "",
    getBoundingClientRect: () => ({ left: 120 + index * 50, right: 160 + index * 50,
      top: 440, bottom: 480, width: 40, height: 40 }),
  });
  const names = ["1.png", "2.png", "3.png", "4.png"];
  const document = {
    querySelectorAll: (selector) => {
      if (selector.includes("progressbar") || selector.includes('[role="alert"]')) return [];
      return shown && selector.includes("img") ? names.map(preview) : [];
    },
  };
  const S = { sleep: async (ms) => { now += ms; } };
  const context = {
    window: { __AMS: S }, document, File: FakeFile, DataTransfer: FakeTransfer,
    Event: FakeEvent, DragEvent: FakeEvent, Uint8Array,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    createImageBitmap: async () => ({ close() {} }),
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", backgroundImage: "none" }),
    Date: { now: () => now },
  };
  vm.runInNewContext(read("content/upload.js"), context);
  assert.equal(typeof S.uploadImages, "function");
  const bytes = Buffer.from(PNG64, "base64");
  const payload = (name) => ({
    name, type: "image/png", size: bytes.length, dataUrl: "data:image/png;base64," + PNG64,
  });
  let attached;
  const result = await S.uploadImages(names.map(payload), {
    attach: async (files) => { attached = files; return true; },
  }, { getBoundingClientRect: () => rect }, now + 2000);
  assert.equal(result.ok, true);
  assert.equal(attached.length, 4);
  let uploadDeadline;
  await S.uploadImages(names.map(payload), {
    attach: async (_files, _composer, deadline) => { uploadDeadline = deadline; return true; },
  }, {}, now + 90000);
  assert.equal(uploadDeadline, now + 90000, "批量附件应使用整次图片发送截止时间");
  const input = {
    files: [],
    dispatchEvent: (event) => { if (event.type === "change") { shown = true; changes++; } },
  };
  assert.equal(await S.setInputFiles(input, attached, { getBoundingClientRect: () => rect }, now + 2000), true);
  assert.equal(input.files.length, 4);
  assert.equal(changes, 1);
  assert.equal((await S.uploadImages([...names, "5.png"].map(payload), {}, {}, now + 1000)).code, "image_invalid");
  const limited = { sleep: async (ms) => { now += ms; } };
  vm.runInNewContext(read("content/upload.js").replace("10 * 1024 * 1024", "100"), {
    window: { __AMS: limited }, document, File: FakeFile, DataTransfer: FakeTransfer,
    Event: FakeEvent, DragEvent: FakeEvent, Uint8Array,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    createImageBitmap: async () => ({ close() {} }),
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", backgroundImage: "none" }),
    Date: { now: () => now },
  });
  assert.equal((await limited.uploadImages(names.slice(0, 2).map(payload), {}, {}, now + 1000)).code, "image_invalid");
}

function tierHarness(initialState) {
  let now = 1000, listener, state = initialState;
  const calls = [];
  class Textarea {
    constructor() { this.tagName = "TEXTAREA"; this._value = ""; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getBoundingClientRect() { return { left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 }; }
    focus() {}
    dispatchEvent() {}
  }
  const composer = new Textarea();
  const document = {
    body: { dispatchEvent() {}, appendChild() {} },
    querySelectorAll: (selector) => selector.startsWith("textarea") ? [composer] : [],
    querySelector: () => null, dispatchEvent() {}, createElement: () => ({}),
  };
  const context = {
    window: {}, document, location: { hostname: "chat.deepseek.com" }, innerHeight: 800, innerWidth: 900,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }, t: (key) => key,
    HTMLTextAreaElement: Textarea, HTMLInputElement: class {},
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    InputEvent: class {}, KeyboardEvent: class {}, MouseEvent: class {}, CustomEvent: class {},
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }), matchMedia: () => ({ matches: true }),
    setTimeout: (fn, ms) => { now += ms || 0; queueMicrotask(fn); return 1; }, clearTimeout() {},
    Date: { now: () => now },
  };
  vm.runInNewContext(read("content/core.js"), context);
  const S = context.window.__AMS;
  S.uploadImages = async () => ({ ok: true });
  S.adapters["deepseek.com"] = {
    state: () => state,
    think: async () => { calls.push("think"); state = "think"; },
    fast: async () => { calls.push("fast"); state = "fast"; },
    thinkImage: async () => { calls.push("thinkImage"); state = "think"; },
    fastImage: async () => { calls.push("fastImage"); state = "fast"; },
    submit: () => { composer.value = ""; },
  };
  return {
    calls,
    send: (tier) => new Promise((resolve) => {
      const async = listener({
        source: "AMS", cmd: "submitPrompt", text: "probe", tier,
        deadline: now + 5000, images: [{ dataUrl: "x" }],
      }, null, resolve);
      assert.equal(async, true);
    }),
  };
}

async function deepSeekImageTiers() {
  let h = tierHarness("fast");
  assert.equal((await h.send("think")).ok, true);
  assert.deepEqual(h.calls, ["thinkImage"]);
  h = tierHarness("think");
  assert.equal((await h.send("fast")).ok, true);
  assert.deepEqual(h.calls, ["fastImage"]);
  h = tierHarness("think");
  assert.equal((await h.send(null)).ok, true);
  assert.deepEqual(h.calls, ["thinkImage"]);
}

async function imageBroadcastDeadline() {
  const tabMessages = [];
  const chrome = {
    runtime: { lastError: null, sendMessage: (_message, callback) => callback && callback() },
    storage: { session: { set: async () => {} } },
    tabs: {
      sendMessage: async (_id, message) => {
        tabMessages.push(message);
        return message.cmd === "getState" ? { state: null } : { ok: false, code: "attachment_failed" };
      },
    },
  };
  const context = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}), popupWindowForHost: async () => 1,
    tabsForHost: async () => [{ id: 9 }], consoleIsMinimized: async () => false,
    getAutoRaise: async () => false, raiseConsole: async () => {},
    minimizeAllManaged: async () => {}, focusAll: async () => {},
  });
  vm.runInContext(read("bg/broadcast.js"), context);
  const started = Date.now();
  await vm.runInContext(
    'sendAll([{host:"chat.deepseek.com"}], "probe", "think", false, currentSendEpoch(), [{}])', context
  );
  const submit = tabMessages.find((message) => message.cmd === "submitPrompt");
  assert.ok(submit.deadline - started >= 80000, "图片广播总截止线应接近 90 秒");
  assert.match(read("console/status.js"), /msg\.hasImage\s*\?\s*95000/);
  assert.match(read("console/console.js"), /images\.length\s*\?\s*95000/);
}

(async () => {
  consoleContract();
  console.log("✓ Console 与后台使用多图数组契约");
  await consoleImageState();
  console.log("✓ Console 最多选择四张且总计不超过 10 MiB");
  await batchUploadContract();
  console.log("✓ Content 一次重建并附加最多四张图片");
  await deepSeekImageTiers();
  console.log("✓ DeepSeek 图片档位映射为 Vision + DeepThink 开关");
  await imageBroadcastDeadline();
  console.log("✓ 图片广播使用独立的 90 秒处理窗口");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
