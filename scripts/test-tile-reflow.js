#!/usr/bin/env node
"use strict";
// sendAll 隐式开窗的布局语义回归（用户实报 bug）：
// ① 增选站点后再发送：既有窗口必须按新布局重排（旧行为 prune=false 只给新窗落格 → 新旧两套布局错位重叠）；
// ② 取消勾选后再发送：owned 窗口关闭、复用窗口解除登记；
// ③ 勾选未变（无缺窗）的追问：不触发任何重排——保护用户手调布局（原设计要护住的场景）。
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

function runtime(initialWins) {
  const created = [], updated = [], removed = [];
  let wins = { ...initialWins }, savedWins = null, nextId = 100;
  const scope = vm.createContext({
    // 窗口层桩：登记表内的 id 视为存活 popup
    getWindows: async () => ({ ...wins }),
    setWindows: async (map) => { wins = { ...map }; savedWins = { ...map }; },
    popupWindowForHost: async (host, snapshot) => (snapshot && snapshot[host] ? snapshot[host].id : null),
    removeIfPopup: async (id) => { removed.push(id); },
    consoleWorkArea: async () => ({ left: 0, top: 0, width: 1200, height: 896 }),
    consoleReserveHeight: async () => 96,
    consoleIsMinimized: async () => false,
    raiseConsole: async () => {}, getAutoRaise: async () => false,
    focusAll: async () => {}, minimizeAllManaged: async () => {},
    tabsForHost: async () => [],
    chrome: {
      windows: {
        create: async (props) => { const w = { id: nextId++ }; created.push({ ...props }); return w; },
        update: async (id, props) => { updated.push({ id, ...props }); },
      },
      storage: { session: { set: async () => {}, remove: async () => {} } },
      runtime: { sendMessage: (m, cb) => { if (cb) cb(); }, lastError: null },
    },
    crypto: { randomUUID: () => "run-0000" },
    Date, URL, Symbol, Promise, setTimeout, clearTimeout, Math, JSON, String, Array, Object, Number,
  });
  vm.runInContext(fs.readFileSync("bg/broadcast.js", "utf8") + ";this.sendAll=sendAll;this.openTile=openTile;", scope);
  scope.submitWhenReady = async (s) => ({ host: s.host, ok: true }); // 桩掉真实提交（vm 全局绑定，调用时解析）
  return { scope, created, updated, removed, getSaved: () => savedWins };
}

const site = (host) => ({ host, url: "https://" + host + "/" });
const boundsOf = (row) => [row.left, row.top, row.width, row.height];

(async () => {
  // ① 增选：claude+chatgpt 已开（旧 2 列布局），加选 doubao 后发送 → 三列重排，旧窗也要就位
  const grow = runtime({ "claude.ai": { id: 1, owned: true }, "chatgpt.com": { id: 2, owned: true } });
  await grow.scope.sendAll([site("claude.ai"), site("chatgpt.com"), site("www.doubao.com")], "q", null, true);
  const cell = Math.floor(1200 / 3);
  const moved = (id) => grow.updated.find((u) => u.id === id && u.width != null);
  assert.ok(moved(1) && moved(2), "增选后发送：既有窗口必须被重排（收到带 bounds 的 update）");
  assert.deepEqual(boundsOf(moved(1)), [0, 96, cell, 800]);
  assert.deepEqual(boundsOf(moved(2)), [cell, 96, cell, 800]);
  assert.equal(grow.created.length, 1, "只为缺窗站新建窗口");
  assert.deepEqual(boundsOf(grow.created[0]), [cell * 2, 96, cell, 800], "新窗落在三列布局第三格");

  // ② 取消勾选：chatgpt 取消、加选 doubao/deepseek → owned 的 chatgpt 关闭并解除登记
  const swap = runtime({ "claude.ai": { id: 1, owned: true }, "chatgpt.com": { id: 2, owned: true } });
  await swap.scope.sendAll([site("claude.ai"), site("www.doubao.com"), site("chat.deepseek.com")], "q", null, true);
  assert.ok(swap.removed.includes(2), "取消勾选的 owned 窗口应被关闭");
  assert.ok(swap.getSaved() && !("chatgpt.com" in swap.getSaved()), "取消勾选的站应从登记表移除");
  assert.equal(swap.created.length, 2, "两个新增站各开一窗");

  // ②b 复用（owned=false）的用户窗口：取消勾选只解除登记，绝不关闭
  const keep = runtime({ "claude.ai": { id: 1, owned: true }, "chatgpt.com": { id: 2, owned: false } });
  await keep.scope.sendAll([site("claude.ai"), site("www.doubao.com")], "q", null, true);
  assert.ok(!keep.removed.includes(2), "复用的用户窗口不得因取消勾选被关闭");
  assert.ok(keep.getSaved() && !("chatgpt.com" in keep.getSaved()), "复用窗口仍应解除登记");

  // ③ 勾选未变（无缺窗）的追问：不得触发任何重排/关窗——手调布局保护
  const still = runtime({ "claude.ai": { id: 1, owned: true }, "chatgpt.com": { id: 2, owned: true } });
  await still.scope.sendAll([site("claude.ai"), site("chatgpt.com")], "q", null, true);
  assert.equal(still.updated.filter((u) => u.width != null).length, 0, "无缺窗的追问不得重排既有窗口");
  assert.equal(still.removed.length, 0);
  assert.equal(still.created.length, 0);

  // ③b 勾选子集（有多余已开窗但无缺窗）：同样不动任何窗——「追问少数站不得动别人正摆着答案的窗」
  const subset = runtime({ "claude.ai": { id: 1, owned: true }, "chatgpt.com": { id: 2, owned: true }, "gemini.google.com": { id: 3, owned: true } });
  await subset.scope.sendAll([site("claude.ai")], "q", null, true);
  assert.equal(subset.updated.filter((u) => u.width != null).length, 0);
  assert.equal(subset.removed.length, 0);

  console.log("tile-reflow tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
