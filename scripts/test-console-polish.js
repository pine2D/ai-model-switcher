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

  assert.ok(group && !group.includes("<svg"), "范围入口不应继续显示下拉箭头");
  assert.match(css, /#group\{[^}]*justify-content:center/, "范围数量应在按钮内居中");
  assert.ok(!html.includes("发送 ▸") && !compose.includes("发送到全部 ▸") && !i18n.includes("▸"),
    "主控制台、Prompt Workspace 与三语文案不应保留发送箭头");
  assert.doesNotMatch(popup, /#app\{[^}]*border-radius/, "popup 根容器不应模拟浏览器外框圆角");
  assert.match(css, /#scope-groups button\{[^}]*text-overflow:ellipsis/, "超长自定义分组名应截断");
  assert.match(scope, /button\.title = group\.name/, "截断的分组名应保留完整悬停提示");
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

async function testInitialScopePosition() {
  let created;
  let positioned;
  const context = vm.createContext({
    scopeWinId: null,
    consoleWorkArea: async () => ({ left: 0, top: 0, width: 1000, height: 300 }),
    getConsoleWinId: async () => 4,
    updateIfPopup: async () => false,
    chrome: {
      runtime: { getURL: (value) => value, lastError: null },
      storage: { local: { get: (_key, done) => done({}), set: async () => {} } },
      windows: {
        get: async () => ({ type: "popup", left: 20, top: 140, height: 96 }),
        create: async (options) => { created = options; return { id: 9 }; },
        update: async (_id, options) => { positioned = options; },
      },
    },
  });
  vm.runInContext(source("bg/panels.js"), context);
  await vm.runInContext("_openScope({ left: 50 })", context);
  assert.equal(created.top, 236, "范围窗顶部应固定在 console 底边");
  assert.equal(created.height, 64, "初始高度应限制在 console 下方剩余空间");
  assert.equal(created.url, "console/scope.html?top=236", "范围窗页面应接收固定顶部");
  assert.equal(positioned && positioned.top, 236, "创建后应再次定位，兼容忽略 create 坐标的窗口管理器");
}

(async () => {
  testVisualSemantics();
  testScopeHeightLimit();
  await testInitialScopePosition();
  console.log("[console-polish] 控件语义与范围窗尺寸通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
