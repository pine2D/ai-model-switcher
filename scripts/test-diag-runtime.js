#!/usr/bin/env node
"use strict";
// content/diag.js 的包装语义 + sendSel 与 submit 选择子的同步守卫。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { PRELOAD, preloadRequires } = require("./lib/desktop-anchors");

const source = (file) => fs.readFileSync(file, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value)); // vm 产物跨 realm，strict deepEqual 会连原型一起比
function context(document, adapters, findComposerResult, state = null) {
  const S = { adapters, findComposer: () => findComposerResult, getState: () => state };
  return { document, t: (key) => key, window: { __AMS: S } };
}

test("diag.js 前置通用检查并保留原 diagnose（含 this 绑定）", () => {
  const adapter = {
    _flag: true,
    sendSel: "#send",
    diagnose: function () { return [{ name: "orig", ok: this._flag }]; },
  };
  const document = { querySelector: (sel) => (sel === "#send" ? {} : null) };
  const ctx = context(document, { "x.com": adapter }, { el: true });
  vm.runInNewContext(source("content/diag.js"), ctx);
  const checks = adapter.diagnose();
  assert.deepEqual(plain(checks.map((c) => c.name)), ["diag_composer", "diag_sendKey", "orig"]);
  assert.deepEqual(plain(checks.map((c) => c.ok)), [true, true, true]);
});

test("composer 缺失 / sendSel 未命中 → 对应检查为 fail；无 sendSel 不产生发送键检查", () => {
  const withSend = { sendSel: ".gone", diagnose: () => [] };
  const noSend = { diagnose: () => [{ name: "orig", ok: false }] };
  const document = { querySelector: () => null };
  const ctx = context(document, { "a.com": withSend, "b.com": noSend }, null);
  vm.runInNewContext(source("content/diag.js"), ctx);
  assert.deepEqual(plain(withSend.diagnose()), [
    { name: "diag_composer", ok: false, kind: "reach" },
    { name: "diag_sendKey", ok: false, kind: "control" },
  ]);
  assert.deepEqual(plain(noSend.diagnose().map((c) => c.name)), ["diag_composer", "orig"]);
});

test("无 diagnose 的适配器：通用检查 + 档位可读兜底（core 回退分支已被包装遮蔽，兜底不能丢）", () => {
  const bare = {};
  const ctx = context({ querySelector: () => null }, { "c.com": bare }, { el: true }, "think");
  vm.runInNewContext(source("content/diag.js"), ctx);
  assert.deepEqual(plain(bare.diagnose()), [
    { name: "diag_composer", ok: true, kind: "reach" },
    { name: "diag_tierReadable", ok: true, kind: "tier" },
  ]);
});

test("原 diagnose 抛异常时通用检查仍在，追加一条诊断异常项", () => {
  const bad = { diagnose: () => { throw new Error("boom"); } };
  const ctx = context({ querySelector: () => null }, { "d.com": bad }, { el: true });
  vm.runInNewContext(source("content/diag.js"), ctx);
  assert.deepEqual(plain(bad.diagnose()), [
    { name: "diag_composer", ok: true, kind: "reach" },
    { name: "cs_diagError", ok: false, kind: "probe" },
  ]);
});

test("包装幂等：重复执行 diag.js 不叠加通用检查", () => {
  const adapter = { diagnose: () => [{ name: "orig", ok: true }] };
  const ctx = context({ querySelector: () => null }, { "e.com": adapter }, { el: true });
  vm.runInNewContext(source("content/diag.js"), ctx);
  vm.runInNewContext(source("content/diag.js"), ctx);
  assert.deepEqual(plain(adapter.diagnose().map((c) => c.name)), ["diag_composer", "orig"]);
});

test("preload 注入顺序：diag.js 在全部 adapters 分卷之后", () => {
  const js = preloadRequires();
  const di = js.findIndex((f) => /\/diag\.js$/.test(f));
  const adapterAt = js.map((f, i) => (/\/adapters-.*\.js$/.test(f) ? i : -1)).filter((i) => i >= 0);
  assert.ok(di >= 0, `${PRELOAD} 缺 diag.js（九站将静默失去通用检查）`);
  assert.ok(adapterAt.length >= 3 && di > Math.max(...adapterAt), "diag.js 必须排在全部适配器分卷之后（含新增分卷）");
});

// TODO(Step 9)：manifest 随扩展一起删，这条届时整段删除；此刻并存只为对拍新锚点。
test("manifest 注入顺序：diag.js 在全部 adapters 分卷之后", () => {
  const js = JSON.parse(source("manifest.json")).content_scripts[0].js;
  const di = js.indexOf("content/diag.js");
  const adapterAt = js.map((f, i) => (/^content\/adapters-.*\.js$/.test(f) ? i : -1)).filter((i) => i >= 0);
  assert.ok(di >= 0, "manifest 缺 content/diag.js（九站将静默失去通用检查）");
  assert.ok(adapterAt.length >= 3 && di > Math.max(...adapterAt), "diag.js 必须排在全部适配器分卷之后（含新增分卷）");
});

test("集成：真实 DeepSeek 适配器包装后通用检查在前、原检查在后", () => {
  const toggle = {
    textContent: "DeepThink",
    getAttribute: (name) => (name === "aria-pressed" ? "true" : null),
  };
  const document = {
    querySelector: (sel) => (sel.includes("ds-button--primary") ? {} : null),
    querySelectorAll: (sel) => (sel === ".ds-toggle-button" ? [toggle] : []),
  };
  const ctx = context(document, {}, { el: true });
  ctx.window.__AMS.waitFor = async (fn) => fn() || null;
  ctx.window.__AMS.findByText = () => null;
  ctx.window.__AMS.openMenu = () => {};
  ctx.window.__AMS.clickEl = () => {};
  ctx.window.__AMS.sleep = () => Promise.resolve();
  ctx.window.__AMS.escMenus = () => {};
  vm.runInNewContext(source("content/adapters-cn.js"), ctx);
  vm.runInNewContext(source("content/diag.js"), ctx);
  const checks = ctx.window.__AMS.adapters["deepseek.com"].diagnose();
  assert.deepEqual(plain(checks.map((c) => c.name)), ["diag_composer", "diag_sendKey", "diag_deepThink", "diag_tierReadable"]);
  assert.ok(checks.every((c) => c.ok));
});

// 九站每条检查都必须带合法 kind：desktop 的健康判定按 kind 决定「拦路 / 只是提示」，
// 漏标一处该检查会被归成 control 继续报 error——方向安全但等于没修，只有这条断言看得见。
test("九站 diagnose 的每条检查都带合法 kind，且恰有一条 reach", () => {
  const KINDS = new Set(["reach", "control", "tier", "probe"]);
  const document = {
    querySelector: () => ({ getAttribute: () => "", textContent: "", className: "" }),
    querySelectorAll: () => [],
  };
  const ctx = context(document, {}, { el: true });
  Object.assign(ctx.window.__AMS, {
    waitFor: async () => null, findByText: () => null, openMenu() {}, clickEl() {},
    sleep: () => Promise.resolve(), escMenus() {},
  });
  for (const file of ["content/adapters-intl.js", "content/adapters-intl2.js",
    "content/adapters-cn.js", "content/adapters-cn2.js"]) vm.runInNewContext(source(file), ctx);
  vm.runInNewContext(source("content/diag.js"), ctx);

  const hosts = Object.keys(ctx.window.__AMS.adapters);
  assert.equal(hosts.length, 9, "九站适配器未全部注册，本断言的覆盖面已失效");
  for (const host of hosts) {
    const checks = plain(ctx.window.__AMS.adapters[host].diagnose());
    assert.ok(checks.length, `${host} 的 diagnose 返回空`);
    for (const check of checks) {
      assert.ok(KINDS.has(check.kind), `${host} 的检查「${check.name}」缺少合法 kind（拿到 ${check.kind}）`);
    }
    assert.equal(checks.filter((c) => c.kind === "reach").length, 1,
      `${host} 必须恰有一条 reach 检查（diag.js 的前置不变量）`);
  }
});

test("sendSel 与 submit 的选择子字面量同步（漂移守卫）", () => {
  // 声明处与 submit 内各出现一次 → 同一文件内该字面量至少出现 2 次；
  // 有人只改 submit 的选择子而忘改 sendSel 时，旧字面量只剩 1 次，此测试变红。
  // 豆包有意无 sendSel：其发送键空输入框时不在 DOM（非常驻，真机 2026-08-18），列进巡检会恒红
  const files = { "content/adapters-cn.js": ["deepseek.com"], "content/adapters-cn2.js": ["kimi.com", "yuanbao.tencent.com"] };
  for (const [file, keys] of Object.entries(files)) {
    const text = source(file);
    const ctx = context({ querySelector: () => null, querySelectorAll: () => [] }, {}, null);
    Object.assign(ctx.window.__AMS, { waitFor: async () => null, findByText: () => null, openMenu() {}, clickEl() {}, sleep: () => Promise.resolve(), escMenus() {} });
    vm.runInNewContext(text, ctx);
    for (const key of keys) {
      const sel = ctx.window.__AMS.adapters[key].sendSel;
      assert.ok(sel, `${key} 缺少 sendSel`);
      const needle = sel.replace(/^#/, ""); // id 型选择子按裸 id 对账（兼容 getElementById 写法）
      const count = text.split(needle).length - 1;
      assert.ok(count >= 2, `${file} 中 ${key} 的 sendSel「${sel}」只出现 ${count} 次，submit 与 sendSel 疑似脱钩`);
    }
  }
});
