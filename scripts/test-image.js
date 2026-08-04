#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==";
const JPEG64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAB//Z";
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
class FakeFile {
  constructor(parts, name, options) {
    this.bytes = Buffer.from(parts[0]);
    this.name = name;
    this.type = options.type;
    this.size = this.bytes.length;
  }
}
class FakeDataTransfer {
  constructor() {
    this.files = [];
    this.items = { add: (file) => this.files.push(file) };
  }
}
class FakeEvent {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
}
function loadUpload(options = {}) {
  const file = path.join(ROOT, "content/upload.js");
  assert.ok(fs.existsSync(file), "content/upload.js 应提供图片上传能力");
  const clock = options.clock || { now: 1000 };
  const S = { sleep: async (ms) => { clock.now += ms; if (options.onSleep) options.onSleep(clock.now); } };
  const context = {
    window: { __AMS: S },
    File: FakeFile,
    Uint8Array,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    createImageBitmap: options.createImageBitmap || (async () => ({ close() {} })),
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    DragEvent: FakeEvent,
    Date: { now: () => clock.now },
    document: options.document || { querySelectorAll: () => [] },
    getComputedStyle: options.getComputedStyle || (() => ({
      display: "block", visibility: "visible", opacity: "1", backgroundImage: "none",
    })),
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
  assert.equal(typeof S.uploadImages, "function");
  assert.equal(typeof S.setInputFiles, "function");
  assert.equal(typeof S.dropFiles, "function");
  return { S, clock };
}
function pngPayload(overrides = {}) {
  return Object.assign({
    name: "polyask-test.png",
    type: "image/png",
    size: Buffer.from(PNG64, "base64").length,
    dataUrl: "data:image/png;base64," + PNG64,
  }, overrides);
}
test("合法 PNG/JPEG 重建 File 后交给 adapter", async () => {
  let decoded = 0;
  const { S, clock } = loadUpload({ createImageBitmap: async () => { decoded++; return { close() {} }; } });
  let received;
  let result = await S.uploadImages([pngPayload()], {
    attach: async (files) => { received = files[0]; return true; },
  }, {}, clock.now + 1000);
  assert.equal(result.ok, true);
  assert.equal(received.name, "polyask-test.png");
  assert.equal(received.type, "image/png");
  assert.equal(received.size, Buffer.from(PNG64, "base64").length);
  const jpg = Buffer.from(JPEG64, "base64");
  result = await S.uploadImages([{
    name: "../polyask-test.jpg",
    type: "image/jpeg",
    size: jpg.length,
    dataUrl: "data:image/jpeg;base64," + jpg.toString("base64"),
  }], { attach: async (files) => { received = files[0]; return true; } }, {}, clock.now + 1000);
  assert.equal(result.ok, true);
  assert.equal(received.name, "polyask-test.jpg");
  assert.equal(received.type, "image/jpeg");
  assert.equal(decoded, 2);
});
test("非法 MIME、大小和文件签名被拒绝", async () => {
  const { S, clock } = loadUpload();
  const deadline = clock.now + 1000;
  let result = await S.uploadImages([pngPayload({ type: "image/jpeg" })], {}, {}, deadline);
  assert.equal(result.code, "image_invalid");
  result = await S.uploadImages([pngPayload({
    size: 3,
    dataUrl: "data:image/png;base64," + Buffer.from("bad").toString("base64"),
  })], {}, {}, deadline);
  assert.equal(result.code, "image_invalid");
  result = await S.uploadImages([pngPayload({ size: 0 })], {}, {}, deadline);
  assert.equal(result.code, "image_invalid");
  result = await S.uploadImages([pngPayload({ size: 10 * 1024 * 1024 + 1 })], {}, {}, deadline);
  assert.equal(result.code, "image_invalid");
  const brokenJpeg = Buffer.from([255, 216, 255, 217]);
  result = await loadUpload({ createImageBitmap: async () => { throw new Error("decode"); } }).S.uploadImages([{
    name: "broken.jpg", type: "image/jpeg", size: brokenJpeg.length,
    dataUrl: "data:image/jpeg;base64," + brokenJpeg.toString("base64"),
  }], { attach: async () => true }, {}, deadline);
  assert.equal(result.code, "image_invalid");
});
test("adapter 缺失、失败、异常和超时使用稳定错误码", async () => {
  const { S, clock } = loadUpload();
  let result = await S.uploadImages([pngPayload()], {}, {}, clock.now + 1000);
  assert.equal(result.code, "attachment_unsupported");
  result = await S.uploadImages([pngPayload()], { attach: async () => false }, {}, clock.now + 1000);
  assert.equal(result.code, "attachment_failed");
  result = await S.uploadImages([pngPayload()], { attach: async () => "attachment_action_required" }, {}, clock.now + 1000); assert.equal(result.code, "attachment_action_required");
  result = await S.uploadImages([pngPayload()], {
    attach: async () => { throw new Error("probe"); },
  }, {}, clock.now + 1000);
  assert.equal(result.code, "attachment_failed");
  result = await S.uploadImages([pngPayload()], { attach: async () => true }, {}, clock.now - 1);
  assert.equal(result.code, "attachment_timeout");
});
function previewEnvironment(showPreview, showBusy = () => false) {
  const rect = { left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 };
  const preview = {
    tagName: "IMG", className: "attachment-preview", textContent: "", src: "blob:polyask",
    getAttribute: (name) => name === "src" ? "blob:polyask" : name === "alt" ? "probe.png" : "",
    getBoundingClientRect: () => ({ left: 120, right: 220, top: 400, bottom: 480, width: 100, height: 80 }),
  };
  const busy = Object.assign({}, preview, { tagName: "DIV", className: "ds-loading", src: "" });
  return {
    composer: { getBoundingClientRect: () => rect },
    document: {
      querySelectorAll: (selector) => showBusy() && /class\*="loading"/.test(selector) ? [busy] :
        showPreview() && /img|role=img|attach|preview/.test(selector) ? [preview] : [],
    },
  };
}
test("file input 事件后等待稳定附件预览", async () => {
  let shown = false, busy = false;
  const env = previewEnvironment(() => shown, () => busy);
  const { S, clock } = loadUpload({ document: env.document, onSleep: (now) => { if (now >= 1600) busy = false; } });
  const events = [];
  const input = { files: [], dispatchEvent: (event) => { events.push(event.type); if (event.type === "change") { shown = true; busy = true; } } };
  const ok = await S.setInputFiles(input, [{ name: "probe.png" }], env.composer, clock.now + 2000);
  assert.equal(ok, true);
  assert.deepEqual(events, ["input", "change"]); assert.ok(clock.now >= 2000);
  assert.equal(input.files.length, 1);
});
test("drop 事件链后等待稳定附件预览", async () => {
  let shown = false;
  const env = previewEnvironment(() => shown);
  const { S, clock } = loadUpload({ document: env.document });
  const events = [];
  const target = { dispatchEvent: (event) => { events.push(event.type); if (event.type === "drop") shown = true; } };
  const ok = await S.dropFiles(target, [{ name: "probe.png" }], env.composer, clock.now + 1000);
  assert.equal(ok, true);
  assert.deepEqual(events, ["dragenter", "dragover", "drop"]);
});
test("文件名匹配的新预览不受页面常驻 loading 误判", async () => {
  let shown = false;
  const env = previewEnvironment(() => shown, () => true);
  const { S, clock } = loadUpload({ document: env.document });
  const input = { files: [], dispatchEvent: (event) => { if (event.type === "change") shown = true; } };
  const ok = await S.setInputFiles(input, [{ name: "probe.png" }], env.composer, clock.now + 1000);
  assert.equal(ok, true);
});
test("upload content script 在 core 之后、adapter 之前加载", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  const upload = scripts.indexOf("content/upload.js");
  assert.ok(upload > scripts.indexOf("content/core.js"));
  assert.ok(upload < scripts.indexOf("content/adapters-intl.js"));
});
function loadAdapters() {
  const calls = [];
  const input = { kind: "input" }, drop = { kind: "drop" };
  const S = {
    adapters: {},
    waitFor: async (fn) => fn(),
    findByText: () => null,
    openMenu: () => {},
    clickEl: () => {},
    sleep: async () => {},
    escMenus: () => {},
    setInputFiles: (target, files, composer, deadline) => {
      calls.push({ kind: "input", target, files, composer, deadline }); return true;
    },
    dropFiles: (target, files, composer, deadline) => {
      calls.push({ kind: "drop", target, files, composer, deadline }); return true;
    },
  };
  const context = vm.createContext({
    window: { __AMS: S },
    document: {
      querySelector: (selector) =>
        /xap-uploader-dropzone/.test(selector) ? drop :
        /file-upload|upload-photos|type="file"|hidden-input|img-input/.test(selector) ? input : null,
      querySelectorAll: () => [],
    },
    t: (key) => key,
    console,
  });
  for (const file of ["content/adapters-intl.js", "content/adapters-cn.js", "content/adapters-cn2.js"])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context);
  return { S, calls, input, drop };
}
test("九站 attach 只选择入口并复用共享上传 helper", async () => {
  const { S, calls, input, drop } = loadAdapters();
  const expected = {
    "claude.ai": "input", "chatgpt.com": "input", "deepseek.com": "input", "doubao.com": "input",
    "kimi.com": "drop", "yuanbao.tencent.com": "drop",
  };
  for (const host of ["gemini.google.com", "qianwen.com", "chatglm.cn"])
    assert.equal(S.adapters[host].attach, undefined, host + " 应明确报 unsupported");
  const files = [{ name: "probe.png" }], composer = { kind: "composer" }, deadline = 9000;
  for (const [host, kind] of Object.entries(expected)) {
    assert.equal(typeof S.adapters[host].attach, "function", host + " 应实现 attach");
    calls.length = 0;
    assert.equal(await S.adapters[host].attach(files, composer, deadline), true);
    assert.equal(calls[0].kind, kind, host + " 应使用正确上传入口");
    assert.equal(calls[0].target, kind === "input" ? input : host === "gemini.google.com" ? drop : composer);
    assert.equal(calls[0].files, files);
    assert.equal(calls[0].composer, composer);
    assert.equal(calls[0].deadline, deadline);
  }
});
test("图片只进入 tab 消息，sendStart 仅广播 hasImage", async () => {
  const broadcasts = [], tabMessages = [];
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: (message, callback) => { broadcasts.push(message); if (callback) callback(); },
    }, storage: { session: { set: async () => {} } },
    tabs: {
      sendMessage: async (_id, message) => {
        tabMessages.push(message);
        return message.cmd === "getState" ? { state: null } : { ok: false, code: "attachment_failed" };
      },
    },
  };
  const images = [{ name: "probe.png", type: "image/png", size: 8, dataUrl: "data:image/png;base64,probe" }];
  const context = vm.createContext({
    chrome, images, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}),
    popupWindowForHost: async () => 1,
    tabsForHost: async () => [{ id: 9 }],
    consoleIsMinimized: async () => false,
    getAutoRaise: async () => false,
    raiseConsole: async () => {},
    minimizeAllManaged: async () => {},
    focusAll: async () => {},
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "bg/broadcast.js"), "utf8"), context);
  const results = await vm.runInContext(
    'sendAll([{host:"chatgpt.com"}], "probe", null, false, currentSendEpoch(), images)', context
  );
  const start = broadcasts.find((message) => message.type === "sendStart");
  const submit = tabMessages.find((message) => message.cmd === "submitPrompt");
  assert.equal(start.hasImage, true);
  assert.equal(Object.hasOwn(start, "images"), false);
  assert.equal(submit.images, images);
  assert.equal(results[0].code, "attachment_failed");
  assert.equal(tabMessages.filter((message) => message.cmd === "submitPrompt").length, 1);
});
test("Console 提供内存图片入口、携图重试和错误码", () => {
  const html = fs.readFileSync(path.join(ROOT, "console/console.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "console/console.js"), "utf8"), images = fs.readFileSync(path.join(ROOT, "console/images.js"), "utf8");
  const status = fs.readFileSync(path.join(ROOT, "console/status.js"), "utf8");
  assert.match(html, /id="image"[\s\S]*aria-pressed="false"/);
  assert.match(html, /id="image-input"[^>]*accept="image\/png,image\/jpeg"/);
  assert.match(images, /new FileReader\(\)/); assert.match(images, /clipboardData\.files/); assert.match(ui, /images:\s*lastSend\.images/);
  assert.match(status, /!lastSend\.hasImage\s*\|\|\s*lastSend\.images/);
  for (const code of ["image_invalid", "attachment_unsupported", "attachment_failed", "attachment_timeout", "attachment_action_required"]) assert.ok(status.includes(code));
});
test("站点范围按固定顺序提供由 SITES 派生的内置分类", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, "console/sites.js"), "utf8") + ";globalThis.sites=SITES", context);
  const imageHosts = context.sites.filter((site) => site.image).map((site) => site.host);
  assert.deepEqual(Array.from(imageHosts), ["claude.ai", "chatgpt.com", "chat.deepseek.com", "www.doubao.com", "www.kimi.com", "yuanbao.tencent.com"]);
  const html = fs.readFileSync(path.join(ROOT, "console/scope.html"), "utf8");
  const scope = fs.readFileSync(path.join(ROOT, "console/scope.js"), "utf8");
  assert.deepEqual(Array.from(context.sites.filter((site) => site.intl).map((site) => site.host)), ["claude.ai", "chatgpt.com", "gemini.google.com"]);
  assert.match(html, /scope-all[^]*scope-none[^]*scope-image[^]*scope-intl[^]*scope-domestic[^]*scope-groups/);
  assert.match(scope, /IMAGE_HOSTS[^]*site\.image[^]*INTL_HOSTS[^]*site\.intl[^]*DOMESTIC_HOSTS[^]*!site\.intl/);
  assert.match(scope, /scope-image[^]*IMAGE_HOSTS[^]*scope-intl[^]*INTL_HOSTS[^]*scope-domestic[^]*DOMESTIC_HOSTS/);
});
(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log("✓", item.name);
    } catch (error) {
      failed++;
      console.error("✗", item.name);
      console.error(error && error.stack || error);
    }
  }
  if (failed) process.exitCode = 1;
  else console.log("[image] 图片载荷与上传边界通过");
})();
