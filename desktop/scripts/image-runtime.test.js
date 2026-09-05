#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "../src/site-runtime");

class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
class FakeFile { constructor(parts, name, options) { this.bytes = Buffer.from(parts[0]); this.name = name; this.type = options.type; } }
class FakeTransfer {
  constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
}
const rect = { left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 };

async function unrelatedDomMustNotConfirmUpload() {
  let shown = false, now = 1000;
  const unrelated = {
    tagName: "BUTTON", className: "", textContent: "", src: "",
    getAttribute: (name) => name === "aria-label" ? "Open menu" : "",
    getBoundingClientRect: () => ({ left: 120, right: 220, top: 450, bottom: 490, width: 100, height: 40 }),
  };
  const document = {
    querySelectorAll: (selector) =>
      shown && (selector.includes("[aria-label]") || selector.includes("[title]")) ? [unrelated] : [],
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
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "upload.js"), "utf8"), context);
  const ok = await S.dropFiles({ dispatchEvent: (event) => { if (event.type === "drop") shown = true; } },
    [{ name: "probe.png" }], { getBoundingClientRect: () => rect }, now + 700);
  assert.equal(ok, false, "无关 aria/title 节点不能被当作附件预览");
}

function loadCore() {
  let now = 1000, composer, timerHook = () => {};
  class Textarea {
    constructor() { this.tagName = "TEXTAREA"; this._value = ""; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getBoundingClientRect() { return rect; }
    focus() {}
    dispatchEvent() {}
  }
  composer = new Textarea();
  const document = {
    body: { dispatchEvent() {}, appendChild() {} },
    querySelectorAll: (selector) => selector.startsWith("textarea") && composer ? [composer] : [],
    querySelector: () => null, dispatchEvent() {}, createElement: () => ({}),
  };
  const context = {
    window: {}, document, location: { hostname: "example.com" }, innerHeight: 800, innerWidth: 900,
    chrome: { runtime: { onMessage: { addListener() {} } } }, t: (key) => key,
    HTMLTextAreaElement: Textarea, HTMLInputElement: class {},
    Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent, CustomEvent: FakeEvent,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }), matchMedia: () => ({ matches: true }),
    setTimeout: (fn, ms) => { now += ms || 0; timerHook(); queueMicrotask(fn); return 1; }, clearTimeout() {},
    Date: { now: () => now },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "core.js"), "utf8"), context);
  return {
    S: context.window.__AMS, current: () => composer,
    replace: (next) => { composer = next; }, onTimer: (fn) => { timerHook = fn; },
    Textarea, now: () => now,
  };
}

async function composerRemountMustNotUploadTwice() {
  const h = loadCore();
  let uploads = 0, rehangAt = 0;
  h.S.uploadImages = async () => { uploads++; h.replace(null); rehangAt = h.now() + 120; return { ok: true }; };
  const next = new h.Textarea();
  h.S.adapters["example.com"] = { submit: () => { next.value = ""; return true; } };
  h.onTimer(() => { if (rehangAt && h.now() >= rehangAt) h.replace(next); });
  const result = await h.S.submitPrompt("hello", h.now() + 4000, [{ dataUrl: "x" }]);
  assert.equal(result.ok, true);
  assert.equal(uploads, 1, "composer 重挂不得触发第二次附件上传");
}

async function failedAttachmentMustNotInjectText() {
  const h = loadCore();
  let submits = 0;
  h.S.uploadImages = async () => ({ ok: false, code: "attachment_failed" });
  h.S.adapters["example.com"] = { submit: () => { submits++; return true; } };
  const result = await h.S.submitPrompt("must-not-appear", h.now() + 1000, [{ dataUrl: "x" }]);
  assert.equal(result.code, "attachment_failed");
  assert.equal(h.current().value, "");
  assert.equal(submits, 0);
}

async function delayedImageSubmissionMustUseDeadline() {
  const h = loadCore();
  let clearAt = 0;
  h.S.uploadImages = async () => ({ ok: true });
  h.S.adapters["example.com"] = { submit: () => { clearAt = h.now() + 3400; return true; } };
  h.onTimer(() => { if (clearAt && h.now() >= clearAt) h.current().value = ""; });
  const result = await h.S.submitPrompt("slow-images", h.now() + 8000, [{ dataUrl: "x" }]);
  assert.equal(result.ok, true, "图片提交确认应使用剩余截止时间，避免已发送却误报失败");
}

async function geminiMustFailFastAsUnsupported() {
  const S = {
    adapters: {}, waitFor: async (fn) => fn(), findByText: () => null, openMenu() {},
    clickEl() {}, sleep: async () => {}, escMenus() {},
  };
  const context = {
    window: { __AMS: S }, t: (key) => key, console,
    document: { querySelector: () => null, querySelectorAll: () => [] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "adapters-intl.js"), "utf8"), context);
  assert.equal(S.adapters["gemini.google.com"].attach, undefined);
}

async function deepSeekMustWaitForSendButton() {
  let disabled = true, clicks = 0, waitMs = 0;
  const button = {
    classList: { contains: () => disabled },
    getAttribute: () => null,
    click: () => {
      assert.equal(disabled, false, "图片处理期间不得点击禁用的发送键");
      clicks++;
    },
  };
  const S = {
    adapters: {},
    waitFor: async (fn, timeout) => {
      waitMs = timeout;
      assert.equal(fn(), null, "发送键禁用时应继续等待");
      disabled = false;
      return fn();
    },
    findByText: () => null, openMenu() {}, clickEl() {}, sleep: async () => {}, escMenus() {},
  };
  const context = {
    window: { __AMS: S }, t: (key) => key, console, Date: { now: () => 1000 },
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector.includes("ds-button--primary") ? [button] : [],
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "adapters-cn.js"), "utf8"), context);
  const result = await S.adapters["deepseek.com"].submit(null, 21000);
  assert.notEqual(result, false);
  assert.equal(clicks, 1);
  assert.equal(waitMs, 20000, "多图处理应使用整次提交的剩余时间");
}

(async () => {
  await composerRemountMustNotUploadTwice();
  console.log("✓ composer 重挂后每站只上传一次");
  await failedAttachmentMustNotInjectText();
  console.log("✓ 附件失败时不注入或发送文字");
  await delayedImageSubmissionMustUseDeadline();
  console.log("✓ 图片提交确认沿用整次发送截止时间");
  await unrelatedDomMustNotConfirmUpload();
  console.log("✓ 无关 DOM 变化不会确认附件成功");
  await geminiMustFailFastAsUnsupported();
  console.log("✓ Gemini 不再等待无效的合成上传");
  await deepSeekMustWaitForSendButton();
  console.log("✓ DeepSeek 图片处理完成后才点击发送键");
  console.log("[image-runtime] 关键失败路径通过");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
