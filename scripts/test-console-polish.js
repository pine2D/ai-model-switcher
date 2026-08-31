#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function testVisualSemantics() {
  const html = source("console/console.html");
  const compose = source("console/compose.html");
  const css = source("console/console.css");
  const scope = source("console/scope.js");
  const popup = source("popup/popup.css");
  const i18n = source("i18n.js");
  const group = html.match(/<button id="group"[\s\S]*?<\/button>/)?.[0] || "";

  assert.ok(!html.includes('class="brand"') && !html.includes("data-brand-icon"), "控制台不应保留 PolyAsk 标识");
  assert.doesNotMatch(css, /\.brand(?:\s|\{|\.)/, "控制台不应保留仅供品牌标识使用的样式");
  assert.ok(group && !group.includes("<svg"), "范围入口不应继续显示下拉箭头");
  assert.match(css, /#group\{[^}]*justify-content:center/, "范围数量应在按钮内居中");
  assert.ok(!html.includes("发送 ▸") && !compose.includes("发送到全部 ▸") && !i18n.includes("▸"),
    "主控制台、Prompt Workspace 与三语文案不应保留发送箭头");
  assert.doesNotMatch(popup, /#app\{[^}]*border-radius/, "popup 根容器不应模拟浏览器外框圆角");
  const popupHtml = source("popup/popup.html");
  const popupJs = source("popup/popup.js");
  for (const id of ["autoraise", "lang", "dm"]) {
    assert.ok(!popupHtml.includes(`id="${id}"`), `popup 不应保留全局设置 ${id}`);
  }
  assert.ok(!popupHtml.includes('name="theme"'), "popup 不应保留主题控件");
  for (const id of ["shortcut-help", "diag", "open-settings"]) {
    const button = popupHtml.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))?.[0] || "";
    assert.match(button, /class="[^"]*tool[^"]*"/);
    assert.match(button, /data-i18n-title=/);
    assert.match(button, /data-i18n-aria=/);
    assert.ok(!/<span[^>]*data-i18n=/.test(button), `${id} 必须为纯图标按钮`);
  }
  assert.ok(!popupJs.includes('setupSelect("lang"') && !popupJs.includes('setupSelect("dm"'));
  assert.ok(popupJs.includes('getElementById("open-settings")'));
  assert.match(css, /#scope-groups button\{[^}]*text-overflow:ellipsis/, "超长自定义分组名应截断");
  assert.match(scope, /button\.title = group\.name/, "截断的分组名应保留完整悬停提示");
  assert.match(html, /<span id="live"[^>]*aria-live="polite"/, "console.html 必须保留唯一的无障碍进度播报节点 #live");
}

function testScopeHeightLimit() {
  const scope = source("console/scope.js");
  const start = scope.indexOf("// SCOPE_SIZE_START");
  const end = scope.indexOf("// SCOPE_SIZE_END") + "// SCOPE_SIZE_END".length;
  assert.ok(start >= 0 && end > start, "应找到范围窗高度计算逻辑");
  const context = vm.createContext({});
  vm.runInContext(scope.slice(start, end), context);
  assert.equal(context.fittedScopeHeight(260, 30, 114, 132, 1440), 290, "内容可见时应贴合内容");
  assert.equal(context.fittedScopeHeight(2000, 30, 114, 132, 1440), 1308,
    "高度上限应按窗口管理器报告的实际顶部计算");
  assert.match(scope, /chrome\.windows\.update\(current\.id, \{ top, height \}/,
    "范围窗自适应应在缩放时重申固定顶部");
}

function testScopeTopHonoredOnce() {
  const scope = source("console/scope.js");
  const start = scope.indexOf("// SCOPE_TOP_START");
  const end = scope.indexOf("// SCOPE_TOP_END") + "// SCOPE_TOP_END".length;
  assert.ok(start >= 0 && end > start, "应找到范围窗顶部落位判定逻辑");
  const context = vm.createContext({});
  vm.runInContext(scope.slice(start, end), context);
  assert.equal(context.resolveScopeTop(false, 236, 800), 236, "首次落位应贴合创建时请求的顶部");
  assert.equal(context.resolveScopeTop(true, 236, 800), 800, "落位一次后应改用窗口当前实际顶部，不得把拖动过的窗口拉回旧值");
  assert.equal(context.resolveScopeTop(false, NaN, 800), 800, "没有 ?top= 请求值时应直接使用实际顶部");
}

function testScopeSiteIncrementalSync() {
  const scope = source("console/scope.js");
  const start = scope.indexOf("// SCOPE_SITE_SYNC_START");
  const end = scope.indexOf("// SCOPE_SITE_SYNC_END") + "// SCOPE_SITE_SYNC_END".length;
  assert.ok(start >= 0 && end > start, "应找到单站行同步纯逻辑");
  const context = vm.createContext({});
  vm.runInContext(scope.slice(start, end), context);
  const selected = { "claude.ai": true, "chatgpt.com": false };
  const checks = { "claude.ai": { state: "ok", text: "OK" } };
  const asPlain = (value) => JSON.parse(JSON.stringify(value)); // 结果来自 vm 上下文，跨 realm 对象需先拍平才能用 deepEqual 比对
  assert.deepEqual(asPlain(context.siteRowState("claude.ai", selected, checks)),
    { checked: true, state: "ok", statusText: "", ariaLabel: "OK", title: "OK" }, "已巡检且勾选的站点应带状态与提示");
  assert.deepEqual(asPlain(context.siteRowState("chatgpt.com", selected, checks)),
    { checked: false, state: null, statusText: "", ariaLabel: null, title: "" }, "未巡检站点不得残留旧的巡检状态");
  assert.equal(context.siteRowState("claude.ai", selected, { "claude.ai": { state: "checking", text: "…" } }).statusText, "…", "巡检中应显示省略号");
  const renderBody = scope.slice(scope.indexOf("function renderScope("), scope.indexOf("function showOnly("));
  assert.doesNotMatch(renderBody, /sites\.replaceChildren/, "逐次勾选/巡检不应重建整个九宫格，只应做增量同步（否则每次都丢一次键盘焦点）");
}

function testScopeGroupDeleteTargetsById() {
  // scope.js 的运行时事件绑定依赖大量浏览器全局（screen/requestAnimationFrame/getComputedStyle 等），
  // 不便整份 vm 执行——按本文件既有惯例，用源码级断言钉住关键结构，防止改回按下标定位（F114）
  const scope = source("console/scope.js");
  assert.match(scope, /pendingGroupDeleteId = groups\[index\]\.id/, "分组删除确认应在展开时绑定目标分组 id");
  assert.match(scope, /groups\.some\(\(group\) => group\.id === targetId\)/, "分组删除确认应按 id 定位目标，而非可能漂移的下标");
  assert.match(scope, /^function renderScope\(\) \{\n  pendingGroupDeleteId = null; showOnly\(elManage\);/m,
    "renderScope 顶部应统一撤销分组删除确认态，任何重渲染都不得让确认停留在旧目标上");
  assert.match(scope, /lastPersistedSelection = JSON\.stringify\(consoleState\.selected\)/, "自写抑制应记录本次写入的选择签名（F117）");
  assert.match(scope, /isOwnEcho/, "storage.onChanged 应识别并抑制自己写入触发的回环渲染（F117）");
}

// geo = bg/windows.js 的 consoleGeometry()：工作区与 console 上下边同一次解析（见该函数注释）
async function openScopeAt(geo) {
  let created;
  let positioned;
  const context = vm.createContext({
    scopeWinId: null,
    consoleGeometry: async () => geo,
    updateIfPopup: async () => false,
    chrome: {
      runtime: { getURL: (value) => value, lastError: null },
      storage: { local: { get: (_key, done) => done({}), set: async () => {} } },
      windows: {
        create: async (options) => { created = options; return { id: 9 }; },
        update: async (_id, options) => { positioned = options; },
      },
    },
  });
  vm.runInContext(source("bg/panels.js"), context);
  await vm.runInContext("_openScope({ left: 50 })", context);
  return { created, positioned };
}

async function testInitialScopePosition() {
  // ① console 在工作区上部：范围窗贴 console 底边向下展开，高度被下方余量限制
  const below = await openScopeAt({ wa: { left: 0, top: 0, width: 1000, height: 500 }, left: 20, top: 140, bottom: 236, reserve: 236, attached: true });
  assert.equal(below.created.top, 236, "范围窗顶部应固定在 console 底边");
  assert.equal(below.created.height, 264, "初始高度应限制在 console 下方剩余空间");
  assert.equal(below.created.left, 70, "范围窗左边应对齐 console 内的锚点");
  assert.equal(below.created.url, "console/scope.html?top=236", "范围窗页面应接收固定顶部");
  assert.equal(below.positioned && below.positioned.top, 236, "创建后应再次定位，兼容忽略 create 坐标的窗口管理器");

  // ② F010：console 停在工作区下缘（96px 细条最自然的停靠位之一）——下方一点余量都没有。旧代码把高度
  // 夹成 1px，站点复选框/分组/巡检入口全看不见、点窗外即自关。现在应翻到 console 上方并底对齐。
  const wa = { left: 0, top: 0, width: 1000, height: 1040 };
  const docked = await openScopeAt({ wa, left: 0, top: 944, bottom: 1040, reserve: 1040, attached: true });
  assert.equal(docked.created.height, 390, "console 贴底时范围窗不得被夹成 1px，应翻到上方取足高度");
  assert.equal(docked.created.top, 554, "翻到 console 上方时应底对齐 console 顶边");
  assert.ok(docked.created.top >= wa.top && docked.created.top + docked.created.height <= wa.top + wa.height,
    "范围窗必须整体落在工作区内");
  assert.equal(docked.created.url, "console/scope.html?top=554", "翻转后的顶部同样要传给页面");
}

// console 上/下可用带的纯逻辑（openTile 与范围窗共用同一套余量判定：F010/F011）
function testConsoleBand() {
  const context = vm.createContext({});
  vm.runInContext(source("bg/panels.js"), context);
  const band = (wa, geo, minH) => JSON.parse(JSON.stringify(
    vm.runInContext(`consoleBand(${JSON.stringify(wa)}, ${JSON.stringify(geo)}, ${minH})`, context)));
  const wa = { left: 0, top: 0, width: 1200, height: 1040 };
  assert.deepEqual(band(wa, { top: 0, bottom: 96 }, 240), { top: 96, height: 944, above: false }, "下方余量充足时用 console 下方");
  assert.deepEqual(band(wa, { top: 944, bottom: 1040 }, 240), { top: 0, height: 944, above: true }, "下方放不下时翻到 console 上方");
  assert.deepEqual(band(wa, { top: 800, bottom: 896 }, 240), { top: 0, height: 800, above: true }, "下方只剩 144 < 240 也要翻上去");
  const squeezed = band({ left: 0, top: 0, width: 800, height: 300 }, { top: 30, bottom: 200 }, 240);
  assert.ok(squeezed.top === 0 && squeezed.height <= 300, "上下都不够时退回工作区顶部，绝不越出工作区");
}

// ---- F023：epoch 取消早退（新会话打断群发）时 sendAll 全批 ok===false，且从未收到过 sendStart ----
class PolishEl {
  constructor() { this.disabled = false; this.textContent = ""; this.title = ""; this.style = {}; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.children = [];
    const names = new Set(); this.classList = { add: (...v) => v.forEach((x) => names.add(x)), remove: (...v) => v.forEach((x) => names.delete(x)), contains: (x) => names.has(x), toggle: (x, on) => on ? names.add(x) : names.delete(x) }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] || null; }
  focus() {} querySelectorAll() { return []; } scrollBy() {} setPointerCapture() {} getBoundingClientRect() { return {}; }
  replaceChildren() { this.children = []; } appendChild(c) { this.children.push(c); } append(...c) { this.children.push(...c); }
}
function cancelledEpochHarness(hosts) {
  const chips = Object.fromEntries(hosts.map((h) => { const c = new PolishEl(); c.dataset = { host: h, label: h.toUpperCase() }; return [h, c]; }));
  const ids = ["sites", "tier", "prompt", "sites-l", "sites-r", "bar", "group", "tile", "send", "collect", "archive", "newsession", "closeall", "compose", "retry", "failsum", "live"];
  const elements = Object.fromEntries(ids.map((id) => [id, new PolishEl()]));
  const sent = [], timers = [];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage: (message, done) => sent.push({ message, done }) },
    storage: { local: { get: (_k, done) => done({}), set() {} }, session: { get: (_k, done) => done({}), remove: (_k, done) => done?.() }, onChanged: { addListener() {} } },
  };
  const context = {
    chrome, document: {
      documentElement: {}, activeElement: null, getElementById: (id) => elements[id] || chips[id],
      querySelector: (sel) => { const m = /data-host="([^"]+)"/.exec(sel); return m ? chips[m[1]] : null; },
      querySelectorAll: (sel) => sel === ".chip" ? Object.values(chips) : sel === ".chip.fail" ? Object.values(chips).filter((c) => c.classList.contains("fail")) : [],
      addEventListener() {}, createElement: () => new PolishEl(), createTextNode: () => new PolishEl(),
    },
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} },
    SITES: hosts.map((h) => ({ host: h, label: h.toUpperCase() })),
    resolveSiteSelection: (saved) => ({ ...saved }), t: (key, ...args) => args.length ? key + ":" + args.join(",") : key,
    applyI18n() {}, syncTierButtons() {}, syncGroupSelect() {}, history: [], histCursor: -1, histDraft: "",
    pendingImages: [], pushHistory() {}, imagePayloads: async () => [], setPendingImages() {},
    RunMeta: { resolve: async (text) => ({ task: text, source: null }), clearPending: async () => {} },
    setTimeout: (fn, ms) => (timers.push({ id: timers.length + 1, fn, ms }), timers.length),
    clearTimeout: (id) => { const timer = timers.find((x) => x.id === id); if (timer) timer.cleared = true; },
    Date, Map, console,
  };
  vm.runInNewContext(source("console/console.js"), context);
  vm.runInNewContext(source("console/status.js"), context);
  hosts.forEach((h) => vm.runInNewContext(`selected[${JSON.stringify(h)}] = true`, context));
  return { chips, elements, sent, click: (id) => context.document.getElementById(id).listeners.click[0]({ currentTarget: elements[id] }) };
}
async function cancelledSendAllStillReportsFailure() {
  const h = cancelledEpochHarness(["a", "b"]);
  h.elements.prompt.value = "Question";
  await h.click("send"); // 未发生任何 sendStart 广播：模拟点发送瞬间就被新会话打断 epoch 的早退
  const sendCall = h.sent.find((s) => s.message.action === "sendAll");
  assert.ok(sendCall, "应发出 sendAll 消息");
  sendCall.done({ results: [{ host: "a", ok: false, code: "cancelled" }, { host: "b", ok: false, code: "cancelled" }] });
  assert.ok(h.chips.a.classList.contains("fail") && h.chips.b.classList.contains("fail"), "取消结果仍应把芯片翻红");
  assert.notEqual(h.elements.failsum.style.display, "none", "progress.total 为 0 时也必须显示失败汇总，不能全程静默（F023）");
  assert.equal(h.elements.live.textContent, h.elements.failsum.textContent, "#live 必须播报与失败汇总一致的结论（F023）");
  assert.notEqual(h.elements.live.textContent, "", "#live 不得留空——新会话打断群发不再全程静默（F023）");
}

(async () => {
  testVisualSemantics();
  testScopeHeightLimit();
  testScopeTopHonoredOnce();
  testScopeSiteIncrementalSync();
  testScopeGroupDeleteTargetsById();
  testConsoleBand();
  await testInitialScopePosition();
  await cancelledSendAllStillReportsFailure();
  console.log("[console-polish] 控件语义与范围窗尺寸通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
