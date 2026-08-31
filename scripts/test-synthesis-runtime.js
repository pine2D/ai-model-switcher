#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

// hooks 拿到 bump() 回调，可在指定钩子里让 currentSendEpoch() 跳变，模拟"函数已经开始跑、
// 用户又取消了"（对照 background.js 的 cancelPendingSends()）。neverMatches 强制 isNewSessionUrl
// 恒为 false，用来测试"还在轮询等新会话、尚未匹配时被取消"这条真实场景最常见的分支。
function runtime({ opened, neverMatches = false, onTabsGet, onWindowCreate, onMatch } = {}) {
  const site = { host: "claude.ai", url: "https://claude.ai/new" };
  let epochValue = 0, getCallCount = 0;
  const bump = () => { epochValue++; };
  const tabUpdates = [], winCreates = [], winUpdates = [], winsSets = [], submits = [];
  let tab = { id: 20, windowId: 2, url: opened ? site.url : "https://claude.ai/chat/old", status: "complete" };
  const scope = vm.createContext({
    getWindows: async () => (opened ? {} : { [site.host]: { id: 2, owned: true } }),
    setWindows: async (map) => { winsSets.push(map); },
    popupWindowForHost: async (host, wins) => (wins[host] ? wins[host].id : null),
    consoleWorkArea: async () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    consoleReserveHeight: async () => 96,
    consoleIsMinimized: async () => false,
    raiseConsole: async () => {},
    tabsForHost: async () => [tab], currentSendEpoch: () => epochValue,
    submitWhenReady: async (...args) => { submits.push(args); return { host: site.host, ok: true }; },
    isNewSessionUrl: (left, right) => {
      const match = !neverMatches && new URL(left).pathname === new URL(right).pathname;
      if (match && onMatch) onMatch(bump);
      return match;
    },
    chrome: {
      tabs: {
        update: async (id, patch) => { tabUpdates.push({ id, patch }); tab = { ...tab, ...patch, status: "complete" }; return tab; },
        get: async () => { getCallCount++; if (onTabsGet) onTabsGet(getCallCount, bump); return tab; },
      },
      windows: {
        create: async (props) => { winCreates.push(props); if (onWindowCreate) onWindowCreate(bump); return { id: 5 }; },
        update: async (id, props) => { winUpdates.push({ id, props }); },
      },
    },
    Date, URL, setTimeout,
  });
  vm.runInContext(fs.readFileSync("bg/synthesis.js", "utf8") + ";this.send=sendOneNewSession;this.valid=validSynthesisRequest", scope);
  return { send: scope.send, valid: scope.valid, site, tabUpdates, winCreates, winUpdates, winsSets, submits };
}

(async () => {
  // 复用既有受管 popup：仍要导航到新会话 URL；几何不受影响、不新建窗口。
  const existing = runtime({ opened: false }), result = await existing.send(existing.site, "payload", "think");
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(existing.tabUpdates)), [{ id: 20, patch: { url: "https://claude.ai/new", active: true } }], "既有受管 popup 必须先导航到新会话");
  assert.equal(existing.winCreates.length, 0, "复用路径不得新建窗口");
  assert.equal(existing.submits[0][0].host, "claude.ai"); assert.equal(existing.submits[0].at(-1), false, "辅助综合不得覆盖群发状态点");

  // F014：新建窗口必须是独立的居中中等尺寸，不得复用平铺网格算出的整块区域（n=1 时平铺会算出满屏）。
  const created = runtime({ opened: true }); await created.send(created.site, "payload", null);
  assert.equal(created.tabUpdates.length, 0, "刚创建的新会话 popup 不得重复导航");
  assert.equal(created.winCreates.length, 1);
  const bounds = created.winCreates[0];
  assert.equal(bounds.type, "popup");
  assert.ok(bounds.width < 1200 && bounds.height < 704, "新窗口不得吃满整块平铺区（F014 回归）");
  assert.equal(created.winsSets.length, 1, "新窗口必须登记进 amsWindows，closeAll/联动才能收编它");

  // F230：validSynthesisRequest 必须是真正的九站白名单，不能只做自洽性检查。
  assert.equal(existing.valid({ site: existing.site, text: "payload", tier: "think" }), true);
  assert.equal(existing.valid({ site: { host: "evil.example", url: "https://evil.example/" }, text: "payload" }), false, "自洽但不在白名单的站点必须被拒");
  assert.equal(existing.valid({ site: { host: "claude.ai", url: "https://claude.ai/other" }, text: "payload" }), false, "白名单站点但 url 不匹配同样要拒");
  assert.equal(existing.valid({ site: existing.site, text: " ", tier: null }), false);
  assert.equal(existing.valid({ site: existing.site, text: "payload", tier: "unknown" }), false);

  // F017/F034：epoch 入口即取，openTile 之后、waitForNewSession 循环内、submitWhenReady 之前都要核对。
  const cancelOnOpen = runtime({ opened: true, onWindowCreate: (bump) => bump() });
  const r1 = await cancelOnOpen.send(cancelOnOpen.site, "payload", null);
  assert.deepEqual(JSON.parse(JSON.stringify(r1)), { host: "claude.ai", ok: false, code: "cancelled" }, "开窗期间取消必须报 cancelled");
  assert.equal(cancelOnOpen.submits.length, 0, "开窗期间取消不得继续提交");

  const cancelDuringWait = runtime({ opened: false, neverMatches: true, onTabsGet: (n, bump) => { if (n === 1) bump(); } });
  const r2 = await cancelDuringWait.send(cancelDuringWait.site, "payload", null);
  assert.equal(r2.code, "cancelled", "等待新会话期间取消必须报 cancelled，不是 timeout（不得空转到 22s 截止线）");
  assert.equal(cancelDuringWait.submits.length, 0);

  const cancelBeforeSubmit = runtime({ opened: true, onMatch: (bump) => bump() });
  const r3 = await cancelBeforeSubmit.send(cancelBeforeSubmit.site, "payload", null);
  assert.deepEqual(JSON.parse(JSON.stringify(r3)), { host: "claude.ai", ok: false, code: "cancelled" }, "已确认到新会话入口、提交前的取消也不得放行");
  assert.equal(cancelBeforeSubmit.submits.length, 0, "取消后绝不可再把载荷打进站点输入框");

  assert.equal(fs.readFileSync("bg/synthesis.js", "utf8").includes("tabs.query"), false, "辅助综合不得查询或收编日常标签页");
  console.log("synthesis-runtime tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
