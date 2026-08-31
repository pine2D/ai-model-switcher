#!/usr/bin/env node
"use strict";
// sendAll 隐式开窗的布局语义回归（用户实报 bug）：
// ① 增选站点后再发送：既有窗口必须按新布局重排（旧行为 prune=false 只给新窗落格 → 新旧两套布局错位重叠）；
// ② 取消勾选后再发送：owned 窗口关闭、复用窗口解除登记；
// ③ 勾选未变（无缺窗）的追问：不触发任何重排——保护用户手调布局（原设计要护住的场景）；
// ④ console 贴工作区底边：平铺区必须整体落在工作区内（F011，旧代码只夹高度不夹顶边 → 九个窗建到屏幕外）；
// ⑤ 中途取消（epoch）：已建的窗必须先落盘再返回，且不再抢焦（F002）；
// ⑥ popup-only 铁律（F175/F176）：登记被污染成 type:"normal" 的日常窗时不被重排/关闭、自愈成 popup，
//    removeIfPopup/updateIfPopup 的类型校验直跑真实实现；被导航走的旧受管窗进孤儿表由 closeAll 回收（F001）。
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

const plain = (value) => JSON.parse(JSON.stringify(value)); // vm 跨 realm 对象要先拍平才能 deepEqual
const TOP_GEO = { wa: { left: 0, top: 0, width: 1200, height: 896 }, left: 0, top: 0, bottom: 96, reserve: 96, attached: true };

function runtime(initialWins, geo = TOP_GEO) {
  const created = [], updated = [], removed = [], hooks = {};
  let wins = { ...initialWins }, savedWins = null, nextId = 100;
  const scope = vm.createContext({
    // 窗口层桩：登记表内的 id 视为存活 popup
    getWindows: async () => ({ ...wins }),
    setWindows: async (map) => { wins = { ...map }; savedWins = { ...map }; },
    popupWindowForHost: async (host, snapshot) => (snapshot && snapshot[host] ? snapshot[host].id : null),
    removeIfPopup: async (id) => { removed.push(id); },
    consoleGeometry: async () => geo, // 工作区 + console 上下边一次解析（见 bg/windows.js）
    consoleIsMinimized: async () => false,
    raiseConsole: async () => {}, getAutoRaise: async () => false,
    focusAll: async () => {}, minimizeAllManaged: async () => {},
    tabsForHost: async () => [],
    chrome: {
      windows: {
        create: async (props) => { const w = { id: nextId++ }; created.push({ ...props }); hooks.onCreate && hooks.onCreate(); return w; },
        update: async (id, props) => { updated.push({ id, ...props }); },
      },
      storage: { session: { set: async () => {}, remove: async () => {} } },
      runtime: { sendMessage: (m, cb) => { if (cb) cb(); }, lastError: null },
    },
    crypto: { randomUUID: () => "run-0000" },
    Date, URL, Symbol, Promise, setTimeout, clearTimeout, Math, JSON, String, Array, Object, Number,
  });
  vm.runInContext(fs.readFileSync("bg/panels.js", "utf8"), scope); // consoleBand 与 openTile 共用余量判定
  vm.runInContext(fs.readFileSync("bg/broadcast.js", "utf8") +
    ";this.sendAll=sendAll;this.openTile=openTile;this.cancelPendingSends=cancelPendingSends;", scope);
  scope.submitWhenReady = async (s) => ({ host: s.host, ok: true }); // 桩掉真实提交（vm 全局绑定，调用时解析）
  return { scope, created, updated, removed, hooks, getSaved: () => savedWins };
}

// 真实窗口层：bg/windows.js 不打桩，chrome.windows.get 如实报 type，用于跑 popup-only 铁律
function realRuntime(initialWins, windowSpecs) {
  const created = [], updated = [], removed = [], navigated = [];
  let wins = { ...initialWins }, savedWins = null, nextId = 100;
  const live = new Map(Object.entries(windowSpecs).map(([id, spec]) => [Number(id), spec]));
  const chrome = {
    system: { display: { getInfo: async () => [{ isPrimary: true, workArea: TOP_GEO.wa }] } },
    storage: {
      local: { get: (_key, done) => done({}), set: async () => {} },
      session: {
        get: (_key, done) => done({ amsWindows: wins }),
        set: (value, done) => { wins = { ...value.amsWindows }; savedWins = { ...value.amsWindows }; done && done(); },
        remove: async () => {},
      },
    },
    windows: {
      get: async (id) => { const spec = live.get(id); if (!spec) throw new Error("missing_window"); return { id, type: spec.type, left: 0, top: 0, width: 400, height: 96 }; },
      create: async (props) => { const id = nextId++; created.push({ id, ...props }); live.set(id, { type: "popup", host: new URL(props.url).hostname }); return { id, type: "popup" }; },
      update: async (id, props) => { updated.push({ id, ...props }); },
      remove: async (id) => { removed.push(id); live.delete(id); },
    },
    tabs: {
      query: async ({ windowId }) => {
        const spec = live.get(windowId);
        return spec ? [{ id: windowId * 10, windowId, active: true, url: "https://" + spec.host + "/" }] : [];
      },
      update: async (id, props) => { navigated.push({ id, ...props }); },
    },
    runtime: { sendMessage: (m, cb) => { if (cb) cb(); }, lastError: null, getURL: (u) => "chrome-extension://polyask/" + u },
  };
  const scope = vm.createContext({ chrome, URL, console, Date, setTimeout, clearTimeout, Math, JSON, Promise, Object, Array, String, Number, Symbol, Map,
    consoleWinId: null, composeWinId: null, scopeWinId: null, archiveWinId: null });
  for (const file of ["bg/windows.js", "bg/panels.js", "bg/broadcast.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), scope);
  vm.runInContext("this.openTile=openTile;this.closeAll=closeAll;this.removeIfPopup=removeIfPopup;this.updateIfPopup=updateIfPopup;this.openCompose=openCompose;", scope);
  return { scope, created, updated, removed, navigated, getSaved: () => savedWins };
}

// submitWhenReady 专用：假时钟（Date.now 只由用例推进）+ 可编排的 tabs.sendMessage 应答
function sendRuntime(clock, tabs, answer) {
  const scope = vm.createContext({
    Date: { now: () => clock.t }, URL, Symbol, Promise, setTimeout, clearTimeout, Math, JSON, String, Array, Object, Number,
    getWindows: async () => ({}), tabsForHost: async () => { clock.t += 5; return tabs; }, // 每轮推进假时钟，保证任何实现都会到点收敛
    chrome: { runtime: { sendMessage: (m, cb) => { if (cb) cb(); }, lastError: null }, tabs: { sendMessage: async (_id, msg) => answer(msg) } },
  });
  vm.runInContext(fs.readFileSync("bg/broadcast.js", "utf8") + ";this.submitWhenReady=submitWhenReady;", scope);
  return scope;
}

// consoleGeometry 专用：真实 bg/windows.js + 伪造的显示器列表与 console 窗口
function geometryRuntime(displays, consoleWindow) {
  const chrome = {
    system: { display: { getInfo: async () => displays } },
    storage: { local: { get: (_key, done) => done({ amsConsoleWin: 4 }) } },
    windows: { get: async () => consoleWindow },
    runtime: { lastError: null },
  };
  const scope = vm.createContext({ chrome, console, Date, Math, JSON, Promise, Object, Array, String, Number, URL, Map,
    consoleWinId: null, composeWinId: null, archiveWinId: null });
  vm.runInContext(fs.readFileSync("bg/windows.js", "utf8") + ";this.consoleGeometry=consoleGeometry;", scope);
  return scope;
}

const site = (host) => ({ host, url: "https://" + host + "/" });
const boundsOf = (row) => [row.left, row.top, row.width, row.height];
const inside = (row, wa) => row.left >= wa.left && row.top >= wa.top &&
  row.left + row.width <= wa.left + wa.width && row.top + row.height <= wa.top + wa.height;

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

  // ②b 复用（owned=false）的用户窗口：取消勾选只解除登记，绝不关闭。
  // 注：生产代码当前没有写出 owned=false 的路径（F003），这条守的是「将来重新启用收编能力时别忘了它」。
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

  // ④ F011：console 停在工作区下缘（96px 细条最自然的停靠位之一）——reserve≈全高，旧代码算出的
  // areaTop 正好在工作区底边，九个窗全部建到屏幕之外。现在应整体翻到 console 上方，且格格落在工作区内。
  const wa = { left: 0, top: 0, width: 1200, height: 1040 };
  const docked = runtime({}, { wa, left: 0, top: 944, bottom: 1040, reserve: 1040, attached: true });
  const nine = ["claude.ai", "chatgpt.com", "gemini.google.com", "www.doubao.com", "chat.deepseek.com",
    "www.kimi.com", "yuanbao.tencent.com", "chatglm.cn", "www.tongyi.com"].map(site);
  await docked.scope.openTile(nine, true);
  assert.equal(docked.created.length, 9, "九站各开一窗");
  for (const row of docked.created) assert.ok(inside(row, wa), "console 贴底时平铺窗必须仍落在工作区内：" + JSON.stringify(row));
  assert.ok(docked.created.every((row) => row.top + row.height <= 944), "翻到上方时不得压住 console 细条");
  assert.ok(docked.created[0].height >= 240 / 3, "平铺区不得被压成不可用的窄带");

  // ⑤ F002：建到第 2 个窗时用户关掉 console（background.js 的 onRemoved 立刻 cancelPendingSends）
  const cancel = runtime({});
  let opened = 0;
  cancel.hooks.onCreate = () => { if (++opened === 2) cancel.scope.cancelPendingSends(); };
  await cancel.scope.openTile([site("a.com"), site("b.com"), site("c.com")], true);
  assert.equal(cancel.created.length, 2, "取消后不得继续开窗");
  const savedCancel = cancel.getSaved();
  assert.ok(savedCancel && savedCancel["a.com"] && savedCancel["b.com"], "已建的窗必须先落盘，否则 closeAll 够不到");
  assert.ok(!("c.com" in savedCancel), "未建的站不得留下登记");
  assert.equal(cancel.updated.filter((u) => u.focused === true).length, 0, "取消后不得再抢焦/抬窗");

  // ⑥a F175/F176：登记被污染成用户日常窗（跨浏览器重启后 id 重排即可发生）
  const polluted = realRuntime({ "claude.ai": { id: 9, owned: true } }, { 9: { type: "normal", host: "claude.ai" } });
  await polluted.scope.openTile([site("claude.ai")], true);
  assert.ok(!polluted.removed.includes(9), "登记撞上日常窗时绝不关闭它");
  assert.ok(!polluted.updated.some((u) => u.id === 9), "也不得重排/抬起日常窗");
  assert.equal(polluted.created.length, 1, "应新建自家 popup 顶上");
  assert.equal(plain(polluted.getSaved())["claude.ai"].id, 100, "登记必须自愈成新建的 popup");

  // ⑥b removeIfPopup / updateIfPopup 的类型校验（铁律三支柱里此前唯一没有真回归的两根）
  const guard = realRuntime({}, { 1: { type: "popup", host: "a.com" }, 2: { type: "normal", host: "b.com" } });
  await guard.scope.removeIfPopup(2);
  assert.deepEqual(guard.removed, [], "removeIfPopup 绝不关 type:normal 的日常窗");
  assert.equal(await guard.scope.updateIfPopup(2, { focused: true }), false, "updateIfPopup 对日常窗必须返回 false");
  assert.deepEqual(guard.updated, [], "更不得真的 update 日常窗");
  assert.equal(await guard.scope.updateIfPopup(1, { focused: true }), true, "popup 正向：确实 update");
  await guard.scope.removeIfPopup(1);
  assert.deepEqual(guard.removed, [1], "popup 正向：确实关闭");

  // ⑥c F001：受管窗被导航到鉴权域 → 解析不到 → 新建并覆盖登记，旧窗进孤儿表等 closeAll 回收
  const orphan = realRuntime({ "claude.ai": { id: 5, owned: true } }, { 5: { type: "popup", host: "accounts.google.com" } });
  await orphan.scope.openTile([site("claude.ai")], true);
  assert.equal(orphan.created.length, 1, "被导航走的受管窗解析不到，应新建");
  assert.deepEqual(plain(orphan.getSaved())["claude.ai"].orphans, [5], "旧窗不当场关闭，收进孤儿表");
  assert.deepEqual(orphan.removed, [], "用户可能正在旧窗里登录，openTile 不得关它");
  await orphan.scope.closeAll();
  assert.ok(orphan.removed.includes(5), "closeAll 必须连孤儿窗一起回收");
  assert.ok(orphan.removed.includes(100), "自家新建的窗同样要关");

  // ⑧ F005：开窗入口的 in-flight 去重按参数指纹分桶——归档窗点「辅助综合」后立刻点 console 的「编辑」
  // （或反序），第二条曾命中在途 promise 被整个丢掉，用户点了「辅助综合」却拿到普通编辑窗且无任何报错。
  const dedup = realRuntime({}, {});
  await Promise.all([dedup.scope.openCompose(undefined, undefined), dedup.scope.openCompose(undefined, "synthesis")]);
  assert.equal(dedup.created.length, 1, "背靠背两条 openCompose 仍只开一个伴侣窗（去重本身不能失效）");
  assert.ok(dedup.navigated.some((n) => String(n.url).endsWith("?mode=synthesis")),
    "第二条的 mode 必须生效：既有伴侣窗要被导航到综合模式，而不是被静默丢弃");
  const same = realRuntime({}, {});
  await Promise.all([same.scope.openCompose(undefined, "synthesis"), same.scope.openCompose(undefined, "synthesis")]);
  assert.equal(same.created.length, 1, "同参数仍复用在途 promise");
  assert.deepEqual(same.navigated, [], "同参数不得多跑一遍导航");

  // ⑦a F007：窗口被用户中途关掉后 tabsForHost 恒空，旧代码空转到绝对截止线才报 timeout（把用户引向
  // 排查登录状态）。连续 NO_WINDOW_MISSES 轮解析不到即判 no_window，且必须远早于 deadline。
  const goneClock = { t: 0 };
  const gone = sendRuntime(goneClock, [], () => ({ state: "fast" }));
  const goneRes = plain(await gone.submitWhenReady(site("a.com"), "q", null, 40, 0, 0, [], false));
  assert.equal(goneRes.code, "no_window", "解析不到受管窗口应判 no_window，不再空转到 timeout");
  assert.equal(goneRes.ok, false);

  // ⑦b F018：仅仅「超过软截止线后继续等」不得再冒充「已自动重试」（console 据 retried 显示该文案）
  const slowClock = { t: 0 };
  let submits = 0;
  const slow = sendRuntime(slowClock, [{ id: 7 }], (msg) => {
    if (msg.cmd === "getState") return { state: "fast" };
    if (msg.cmd !== "submitPrompt") return null;
    if (++submits === 1) { slowClock.t = 25000; return { ok: false, code: "composer_not_found" }; } // 慢站首轮还没渲染出编辑器
    return { ok: true };
  });
  const slowRes = plain(await slow.submitWhenReady(site("a.com"), "q", null, 22000, 0, 0, [], false));
  assert.equal(slowRes.ok, true);
  assert.equal(slowRes.waited, true, "越过软截止线继续等应记 waited");
  assert.equal(slowRes.retried, undefined, "只是继续等、一次都没重发，绝不能标成「已自动重试」");
  assert.equal(slowRes.resent, undefined);

  // ⑦c F018：真重发（只读 submitted() 确认末条用户消息不是本次内容）才置 resent，并沿用 retried 供 console 显示
  const kimiClock = { t: 0 };
  let kimiSubmits = 0;
  const kimi = sendRuntime(kimiClock, [{ id: 7 }], (msg) => {
    if (msg.cmd === "getState") return { state: "fast", canConfirm: true };
    if (msg.cmd === "wasSubmitted") return { supported: true, ok: false }; // 五次确认「没发出去」
    if (msg.cmd !== "submitPrompt") return null;
    return ++kimiSubmits === 1 ? { ok: false, code: "submit_unconfirmed" } : { ok: true };
  });
  const kimiRes = plain(await kimi.submitWhenReady(site("www.kimi.com"), "q", null, 22000, 0, 0, [], false));
  assert.equal(kimiRes.ok, true);
  assert.equal(kimiRes.resent, true, "真重发过应记 resent");
  assert.equal(kimiRes.retried, true, "真重发才保留 retried（console 的「已自动重试」只应出现在这里）");
  assert.equal(kimiRes.waited, undefined);

  // ⑨ F006：工作区与 console 坐标必须同一次解析。console 中心点落在所有 workArea 之外（被拖进任务栏
  // 带、副屏刚拔掉）时工作区回退主屏，旧代码仍拿 console 的绝对底边算 reserve → 那是跨屏距离（2196），
  // 平铺区被压成 120px 废格甚至整批落到两块屏幕之外。
  const main = { left: 0, top: 0, width: 1920, height: 1040 };
  const second = { left: 0, top: 1080, width: 1920, height: 1040 };
  const screens = [{ isPrimary: true, workArea: main }, { workArea: second }];
  const offscreen = plain(await geometryRuntime(screens, { type: "popup", left: 0, top: 2100, width: 1920, height: 96 }).consoleGeometry());
  assert.deepEqual(offscreen.wa, main, "未命中显示器时工作区回退主屏");
  assert.equal(offscreen.reserve, 96, "此时 reserve 必须回退细条高度，绝不能是 console 绝对底边减主屏顶（跨屏距离）");
  assert.equal(offscreen.attached, false, "未命中时也不得拿 console 的 left 当锚点");
  const onSecond = plain(await geometryRuntime(screens, { type: "popup", left: 0, top: 2024, width: 1920, height: 96 }).consoleGeometry());
  assert.deepEqual(onSecond.wa, second, "console 在副屏时以副屏工作区为基准");
  assert.equal(onSecond.reserve, 1040, "同屏时 reserve 仍按 console 实际底边算（含窗口管理器的上移装饰）");
  const stale = plain(await geometryRuntime(screens, { type: "normal", left: 0, top: 0, width: 1920, height: 96 }).consoleGeometry());
  assert.equal(stale.attached, false, "登记 id 撞上日常窗时按细条估算，不拿它的几何做基准");

  // ⑩ F013：console 未持焦时点细条上的按钮，窗口 focus 先于 click 派发，180ms 后的 raiseWorkspace 会把
  // 刚建好的伴侣窗踢下去。三个入口必须都先 holdRaise。运行时链路要整套 chrome.windows 桩，按本仓惯例
  // （见 test-console-polish 的源码级断言）钉住结构即可。
  const bg = fs.readFileSync("background.js", "utf8");
  assert.match(bg, /function holdRaise\(\) \{\s*\n\s*if \(raiseTimer != null\) \{ clearTimeout\(raiseTimer\)/, "holdRaise 必须先清掉待触发的抬窗");
  assert.match(bg, /function holdRaise\(\)[\s\S]{0,200}?suppressFocusUntil = Date\.now\(\)/, "holdRaise 必须推后抬窗抑制窗");
  for (const action of ["openScope", "openCompose", "openArchive"]) {
    assert.match(bg, new RegExp(`msg\\.action === "${action}"\\) \\{ holdRaise\\(\\);`), `${action} 入口必须先抑制抬窗，否则伴侣窗一开就被抢焦`);
  }

  console.log("tile-reflow tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
