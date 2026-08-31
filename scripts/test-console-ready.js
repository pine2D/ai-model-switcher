#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const consoleUrl = "chrome-extension://polyask/console/console.html";
async function waitFor(check) {
  for (let tries = 0; tries < 20; tries++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("listener_not_registered");
}

function events() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
    get size() { return listeners.size; },
  };
}

function harness({ existing = false, missing = false, completeOnGet = false, onGet = {}, createDelay = 0 } = {}) {
  const updated = events(), removed = events();
  const windows = new Map(existing ? [[7, { id: 7, type: "popup" }]] : []);
  const tabs = new Map(existing ? [[41, { id: 41, windowId: 7, url: consoleUrl, status: "complete" }]] : []);
  const createdWindowId = 8, consoleTabId = 42;
  let storedWindowId = existing ? 7 : 7;
  const chrome = {
    runtime: { lastError: null, getURL: (file) => `chrome-extension://polyask/${file}` },
    storage: {
      local: {
        get: (_key, done) => done({ amsConsoleWin: storedWindowId }),
        set: async (value) => { if (value.amsConsoleWin != null) storedWindowId = value.amsConsoleWin; },
      },
      session: { get: (_key, done) => done({}), set: (_value, done) => done() },
    },
    system: { display: { getInfo: async () => [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1280, height: 800 } }] } },
    windows: {
      get: async (id) => {
        const window = windows.get(id);
        if (!window) throw new Error("missing_window");
        return window;
      },
      update: async (id, props) => Object.assign(await chrome.windows.get(id), props),
      create: async () => {
        if (createDelay) await new Promise((resolve) => setTimeout(resolve, createDelay));
        const window = { id: createdWindowId, type: "popup" };
        windows.set(window.id, window);
        if (!missing) tabs.set(consoleTabId, { id: consoleTabId, windowId: window.id, pendingUrl: consoleUrl, status: "loading" });
        return window;
      },
    },
    tabs: {
      query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.windowId === windowId),
      get: async (id) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("missing_tab");
        return completeOnGet ? { ...tab, status: "complete", ...onGet } : tab;
      },
      onUpdated: updated,
      onRemoved: removed,
    },
  };
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, consoleWinId: null, composeWinId: null, archiveWinId: null });
  vm.runInContext(source("bg/windows.js"), context);
  return {
    call: (expression) => vm.runInContext(expression, context), updated, removed, createdWindowId, consoleTabId,
    get created() { return windows.has(createdWindowId); },
    setConsoleTab: (props) => Object.assign(tabs.get(consoleTabId), props),
  };
}

async function testConsoleReadiness() {
  const complete = harness({ existing: true });
  assert.equal(await complete.call("ensureConsoleReady('', 20)"), 7, "complete 的既有控制台应立即返回");

  const waitingHarness = harness();
  let settled = false;
  const waiting = waitingHarness.call("ensureConsoleReady('', 50)").then((value) => { settled = true; return value; });
  await waitFor(() => waitingHarness.updated.size === 1);
  waitingHarness.updated.emit(999, { status: "complete" });
  assert.equal(settled, false, "无关标签页不得解除等待");
  waitingHarness.updated.emit(waitingHarness.consoleTabId, { status: "complete" });
  waitingHarness.updated.emit(waitingHarness.consoleTabId, { status: "complete" });
  assert.equal(await waiting, waitingHarness.createdWindowId);
  assert.equal(waitingHarness.updated.size, 0); assert.equal(waitingHarness.removed.size, 0);

  const raced = harness({ completeOnGet: true });
  assert.equal(await raced.call("ensureConsoleReady('', 20)"), raced.createdWindowId, "监听注册后的复查必须捕获完成竞态");
  assert.equal(raced.updated.size, 0); assert.equal(raced.removed.size, 0);

  const navigated = harness();
  const leftConsole = navigated.call("ensureConsoleReady('', 50)");
  await waitFor(() => navigated.updated.size === 1);
  navigated.setConsoleTab({ url: "chrome-extension://polyask/console/compose.html", pendingUrl: undefined, status: "complete" });
  navigated.updated.emit(navigated.consoleTabId, { status: "complete" });
  await assert.rejects(leftConsole, /console_missing/, "同一标签离开控制台 URL 后不得误报 ready");
  assert.equal(navigated.updated.size, 0); assert.equal(navigated.removed.size, 0);

  const rereadNavigated = harness({ completeOnGet: true, onGet: { url: "chrome-extension://polyask/console/compose.html", pendingUrl: undefined } });
  await assert.rejects(rereadNavigated.call("ensureConsoleReady('', 20)"), /console_missing/, "监听后的复查也必须验证精确控制台 URL");
  assert.equal(rereadNavigated.updated.size, 0); assert.equal(rereadNavigated.removed.size, 0);

  const timeout = harness();
  await assert.rejects(timeout.call("ensureConsoleReady('', 5)"), /console_timeout/);
  assert.equal(timeout.updated.size, 0); assert.equal(timeout.removed.size, 0, "失败也必须清理监听器");

  const slowOpen = harness({ createDelay: 30 });
  const slowResult = slowOpen.call("ensureConsoleReady('', 20)").then(() => null, (error) => error);
  const slowError = await slowResult;
  assert.equal(slowOpen.created, false, "超时必须先于慢开窗完成");
  assert.match(slowError.message, /console_timeout/);
  await waitFor(() => slowOpen.created);
  assert.equal(slowOpen.updated.size, 0, "超时后的慢开窗不得注册更新监听器");
  assert.equal(slowOpen.removed.size, 0, "慢开窗完成后不得泄漏关闭监听器");

  const closedHarness = harness();
  const closed = closedHarness.call("ensureConsoleReady('', 50)");
  await waitFor(() => closedHarness.removed.size === 1);
  closedHarness.removed.emit(closedHarness.consoleTabId);
  await assert.rejects(closed, /console_closed/);
  assert.equal(closedHarness.updated.size, 0); assert.equal(closedHarness.removed.size, 0);

  const missing = harness({ missing: true });
  await assert.rejects(missing.call("ensureConsoleReady('', 20)"), /console_missing/);
  assert.equal(missing.updated.size, 0); assert.equal(missing.removed.size, 0, "缺少标签页也不得遗留监听器");
}

function testBackgroundReadinessContract() {
  const background = source("background.js");
  assert.ok(background.includes('"bg/windows.js"'), "background 必须导入定义 readiness helper 的窗口模块");
  const branch = background.match(/if \(msg\.action === "openConsole"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(branch.includes("ensureConsoleReady(msg.host)"), "openConsole 消息必须等待控制台就绪");
  assert.ok(branch.includes("sendResponse"), "openConsole 消息必须异步响应");
  assert.ok(branch.includes("return true"), "openConsole 消息必须保持响应通道");
}

// ---- console/console.js + console/status.js 群发状态机回归（F009/F012/F019/F092/F107/F115/F116/F119）----
class El {
  constructor() { this.disabled = false; this.textContent = ""; this.title = ""; this.style = {}; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.children = [];
    const names = new Set(); this.classList = { add: (...v) => v.forEach((x) => names.add(x)), remove: (...v) => v.forEach((x) => names.delete(x)), contains: (x) => names.has(x), toggle: (x, on) => on ? names.add(x) : names.delete(x) }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] || null; }
  focus() {} querySelectorAll() { return []; } scrollBy() {} setPointerCapture() {} getBoundingClientRect() { return {}; }
  replaceChildren() { this.children = []; } appendChild(c) { this.children.push(c); } append(...c) { this.children.push(...c); }
}
function imageContext(overrides) {
  return vm.createContext(Object.assign({
    document: { getElementById: (id) => ({ image: new El(), "image-input": new El(), prompt: new El() }[id]) },
    FileReader: class { readAsDataURL() { this.result = "data:x"; this.onload(); } },
    createImageBitmap: async () => ({ close() {} }), flashNote() {}, t: (key, ...a) => a.length ? key + ":" + a.join(",") : key, console,
  }, overrides));
}
function consoleHarness(hosts) {
  const chips = Object.fromEntries(hosts.map((h) => { const c = new El(); c.dataset = { host: h, label: h.toUpperCase() }; return [h, c]; }));
  const ids = ["sites", "tier", "prompt", "sites-l", "sites-r", "bar", "group", "tile", "send", "collect", "archive", "newsession", "closeall", "compose", "retry", "failsum", "live"];
  const elements = Object.fromEntries(ids.map((id) => [id, new El()]));
  const receivers = [], docListeners = {}, sent = [], timers = [];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener: (fn) => receivers.push(fn) }, sendMessage: (message, done) => sent.push({ message, done }) },
    storage: { local: { get: (_k, done) => done({}), set() {} }, session: { get: (_k, done) => done({}), remove: (_k, done) => done?.() }, onChanged: { addListener() {} } },
  };
  const context = {
    chrome, document: {
      documentElement: {}, activeElement: null, getElementById: (id) => elements[id] || chips[id],
      querySelector: (sel) => { const m = /data-host="([^"]+)"/.exec(sel); return m ? chips[m[1]] : null; },
      querySelectorAll: (sel) => sel === ".chip" ? Object.values(chips) : sel === ".chip.fail" ? Object.values(chips).filter((c) => c.classList.contains("fail")) : [],
      addEventListener: (type, fn) => (docListeners[type] ||= []).push(fn), createElement: () => new El(), createTextNode: () => new El(),
    },
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} },
    SITES: hosts.map((h) => ({ host: h, label: h.toUpperCase() })),
    resolveSiteSelection: (saved) => ({ ...saved }), t: (key, ...args) => args.length ? key + ":" + args.join(",") : key,
    applyI18n() {}, syncTierButtons() {}, syncGroupSelect() {}, history: [], histCursor: -1, histDraft: "",
    pendingImages: [], pushHistory() {}, imagePayloads: async () => [], setPendingImages() {},
    RunMeta: { resolve: async (text) => ({ task: text, source: null }), clearPending: async () => {} },
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    Date, Map, console,
  };
  vm.runInNewContext(source("console/console.js"), context);
  vm.runInNewContext(source("console/status.js"), context);
  hosts.forEach((h) => vm.runInNewContext(`selected[${JSON.stringify(h)}] = true`, context));
  return {
    context, chips, elements, sent, timers,
    click: (id, e) => context.document.getElementById(id).listeners.click[0](e || { currentTarget: elements[id] }),
    broadcast: (msg) => receivers.forEach((fn) => fn(Object.assign({ from: "AMS_BG" }, msg))),
    fireDoc: (type) => (docListeners[type] || []).forEach((fn) => fn()),
  };
}
function tileHandlingRegressions() {
  // F012：已在 send 态的芯片不得被 tile 改写或抢短兜底（同步预布防与异步响应两处都要跳过）
  let h = consoleHarness(["a"]);
  h.broadcast({ type: "sendStart", hosts: ["a"], run: { runId: "r1", text: "Q", hosts: ["a"] }, hasImage: false });
  const titleBefore = h.chips.a.title;
  h.click("tile");
  h.sent.find((s) => s.message.action === "openTile").done({ results: [{ host: "a", windowId: 1, reused: true }] });
  assert.ok(h.chips.a.classList.contains("send"), "tile 不得把处于 send 态的芯片改写为其它状态（F012）");
  assert.equal(h.chips.a.title, titleBefore, "tile 不得覆盖仍在发送中的芯片提示（F012）");
  // F116：tile 完成后必须刷新悬空的失败汇总/重试可用性，不能留下点了 0 条的重试按钮
  h = consoleHarness(["a", "b"]);
  h.broadcast({ type: "sendStart", hosts: ["a", "b"], run: { runId: "r2", text: "Q", hosts: ["a", "b"] }, hasImage: false });
  h.broadcast({ type: "siteResult", result: { host: "a", ok: true } });
  h.broadcast({ type: "siteResult", result: { host: "b", ok: false, code: "timeout" } });
  h.click("tile");
  h.sent.find((s) => s.message.action === "openTile").done({ results: [{ host: "a", windowId: 1, reused: true }, { host: "b", windowId: 2, reused: true }] });
  assert.equal(h.elements.failsum.style.display, "none", "tile 清空 fail 态后必须同步收起悬空的失败汇总（F116）");
  assert.equal(h.elements.retry.disabled, true, "tile 清空 fail 态后重试必须同步禁用（F116）");
}
async function sendArmsIndependentDotTimeout() {
  const h = consoleHarness(["a"]);
  h.elements.prompt.value = "Question"; h.timers.length = 0;
  await h.click("send", null); // sendAll 响应/sendStart 广播都不到达，只靠点击时独立武装的兜底
  const armed = h.timers.filter((t) => t.ms === 60000 && !t.cleared);
  assert.ok(armed.length >= 1, "点击发送必须独立武装兜底，不依赖 sendStart 广播到达（F115）");
  armed.forEach((t) => t.fn());
  assert.ok(h.chips.a.classList.contains("fail"), "sendStart 广播丢失时，独立兜底到点必须把芯片翻为失败（F115）");
}
function i18nChangeRelabelsChipsFromStoredCode() {
  const h = consoleHarness(["a"]);
  h.broadcast({ type: "sendStart", hosts: ["a"], run: { runId: "r1", text: "Q", hosts: ["a"] }, hasImage: false });
  h.broadcast({ type: "siteResult", result: { host: "a", ok: false, code: "timeout" } });
  assert.equal(h.chips.a.title, "A · con_errTimeout");
  h.context.t = (key, ...args) => (args.length ? key + ":" + args.join(",") : key) + "!zh"; // 模拟语言切换后 t() 换了译文
  h.fireDoc("i18n:changed");
  assert.equal(h.chips.a.title, "A · con_errTimeout!zh", "语言切换后必须重算错误码文案，不留旧语言译文（F107）");
}
function liveAnnouncementsCoverNonTerminalActions() {
  const h = consoleHarness(["a", "b"]);
  h.broadcast({ type: "sendStart", hosts: ["a", "b"], run: { runId: "r1", text: "Q", hosts: ["a", "b"] }, hasImage: false });
  assert.equal(h.elements.live.textContent, "con_liveSendStart:2", "群发开场必须播报站点数（F119）");
  h.timers.length = 0;
  h.broadcast({ type: "siteResult", result: { host: "a", ok: true } });
  const progressTimer = h.timers.find((t) => t.ms === 400);
  assert.ok(progressTimer, "未完成时的逐站结果应节流排一次进度播报（F119）");
  h.broadcast({ type: "siteResult", result: { host: "b", ok: true } });
  const afterFinish = h.elements.live.textContent;
  assert.equal(afterFinish, "con_allDone:2");
  progressTimer.fn(); // 模拟节流定时器事后才触发
  assert.equal(h.elements.live.textContent, afterFinish, "滞后触发的节流进度播报不得覆盖完成汇总（F119）");
  h.click("newsession"); h.sent.find((s) => s.message.action === "newSession").done();
  assert.equal(h.elements.live.textContent, "con_liveNewSession:2", "新会话完成必须播报（F119）");
  h.click("closeall");
  assert.equal(h.elements.live.textContent, "con_liveClosedAll", "关闭全部必须播报（F119）");
}
function budgetsHaveTwentyPercentMargin() {
  const consoleSrc = source("console/console.js"), statusSrc = source("console/status.js");
  assert.match(consoleSrc, /images\.length\s*\?\s*95000\s*\+\s*15000/, "console.js 带图预算须整体≥108000（F019）");
  assert.match(statusSrc, /msg\.hasImage\s*\?\s*95000\s*\+\s*15000/, "status.js 带图预算须整体≥108000（F019）");
  assert.match(consoleSrc, /inflightImage\s*\?\s*110000\s*:\s*30000/, "带图群发在途时忙碌态兜底应取更长预算（F009）");
  assert.ok(95000 + 15000 >= 90000 * 1.2 && 60000 >= 44000 * 1.2, "带图/纯文本预算都必须达到 ≥20% 余量");
  assert.ok(!consoleSrc.includes("~22s"), "F009：过期的 ~22s 注释必须更新为实际预算（44s/90s）");
}
// F092：console/images.js 把魔数 + createImageBitmap 校验前移到选图时刻，别等开窗后六站各报一次 image_invalid
class FakeFile {
  constructor(bytes, type) { this._bytes = bytes; this.type = type; this.size = bytes.length; this.name = "x"; }
  slice(start, end) { const part = this._bytes.slice(start, end); return { arrayBuffer: async () => Uint8Array.from(part).buffer }; }
}
async function chooseImagesDeepValidation() {
  let bitmapCalls = 0;
  const notes = [], context = imageContext({ createImageBitmap: async () => { bitmapCalls++; return { close() {} }; }, flashNote: (v) => notes.push(v) });
  vm.runInContext(source("console/images.js") + ";globalThis.__t={chooseImages,get:()=>pendingImages};", context);
  const spoofed = new FakeFile([82, 73, 70, 70, 0, 0, 0, 0], "image/png"); // RIFF... 不是 PNG 魔数（伪装成 png 的 webp）
  assert.equal(context.__t.chooseImages([spoofed]), true, "同步返回值不受异步深度校验影响（不破坏既有调用点契约）");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.__t.get().length, 0, "魔数不符必须在异步校验后清空选择（F092）");
  assert.ok(notes.some((n) => String(n).startsWith("con_imageType")), "必须提示图片类型不受支持（F092）");
  const realPng = new FakeFile([137, 80, 78, 71, 13, 10, 26, 10, 1, 2], "image/png");
  assert.equal(context.__t.chooseImages([realPng]), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.__t.get().length, 1, "真实 PNG 通过校验并保留选择（F092）");
  assert.ok(bitmapCalls >= 1, "仍须走 createImageBitmap 解码校验（F092）");
  const bare = imageContext({});
  vm.runInContext(source("console/images.js") + ";globalThis.__t={chooseImages,get:()=>pendingImages};", bare);
  assert.equal(bare.__t.chooseImages([{ name: "1.png", size: 10, type: "image/png" }]), true); // 无 .slice：无法读字节的受限环境
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bare.__t.get().length, 1, "读不到字节时不得误判为坏图，放行给 content/upload.js 兜底（F092）");
}

(async () => {
  await testConsoleReadiness();
  testBackgroundReadinessContract();
  console.log("[console-ready] 控制台就绪等待通过");
  tileHandlingRegressions();
  await sendArmsIndependentDotTimeout();
  i18nChangeRelabelsChipsFromStoredCode();
  liveAnnouncementsCoverNonTerminalActions();
  budgetsHaveTwentyPercentMargin();
  await chooseImagesDeepValidation();
  console.log("[console-ready] C2 群发状态机与图片深度校验回归通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
