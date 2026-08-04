// background.js — 快捷键转发：onCommand → 当前活动标签的 content script

// —— 广播控制台编排：共享可变状态（bg/windows.js 与 bg/broadcast.js 通过全局访问）——
let consoleWinId = null;     // console 弹窗 id（内存缓存）
let suppressFocusUntil = 0;  // 程序化抬窗(raiseConsole 末尾重聚焦 console)期间忽略 console 页面回报的 focus 事件（时间窗），防递归
let composeWinId = null;
let scopeWinId = null;       // 站点范围伴侣窗（失焦即关，不改变 console 高度）
let archiveWinId = null;     // 归档查看窗（与伴侣窗同款受管：随 console 联动、closeAll 一起关）
let raiseTimer = null;       // consoleFocused 抬窗去抖句柄（见 scheduleRaise）
importScripts("bg/windows.js", "bg/panels.js", "bg/broadcast.js",
  "bg/sync-model.js", "bg/archive-model.js", "bg/store.js", "bg/data.js", "bg/drive.js", "bg/sync.js", "bg/transfer.js");

// 窗口 id 仅本次浏览器会话有效：重启后 id 重排，陈旧登记可能撞上无关 popup（如 OAuth 弹窗）
// 被误关/误收编——按 id 的操作只验 type 无法防住 popup 撞 popup，故启动时一律清空登记。
chrome.runtime.onStartup.addListener(() =>
  chrome.storage.local.remove(["amsWindows", "amsConsoleWin", "amsComposeWin", "amsScopeWin", "amsArchiveWin"])
);

// console 获焦 → 延迟 ~180ms 再抬整组工作区。点 console 的「最小化按钮」会先让窗口获焦（→ 本会立刻
// 抬窗、把正在最小化的 console 又解最小化，与最小化打架、时好时坏），延迟给紧随其后的「最小化」一个
// 取消窗口：consoleHidden 到达即 clearTimeout 取消本次抬窗。真要抬时再核对 console 非 minimized 兜底。
function scheduleRaise() {
  if (raiseTimer != null) clearTimeout(raiseTimer);
  raiseTimer = setTimeout(async () => {
    raiseTimer = null;
    if (Date.now() < suppressFocusUntil) return;             // 程序化抬窗自触发
    const cid = await getConsoleWinId();
    if (cid == null) return;
    let st = null; try { st = (await chrome.windows.get(cid)).state; } catch (e) { return; }
    if (st === "minimized") return;                          // 用户点的是最小化键（获焦只是顺带）→ 不抬，交给 consoleHidden 联动最小化
    raiseWorkspace();
  }, 180);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-console") {
    // 聚焦既有 console 或新建（openConsole 幂等）。聚焦后 console 页面的 focus 事件会联动抬整组工作区。
    await openConsole();
    return;
  }
  const mode = command === "switch-think" ? "think" : command === "switch-fast" ? "fast" : null;
  if (!mode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { source: "AMS", mode });
  } catch (e) {
    // 活动标签不是受支持站点（无 content script）→ 静默忽略
  }
});

// console 关闭 → 关闭 owned 平铺窗口（不动收编的用户窗口）；各伴侣窗关闭 → 仅清自身登记。
// 单监听器统一清理窗口登记，避免多监听器重复读取 storage。
chrome.windows.onRemoved.addListener(async (winId) => {
  const cid = await getConsoleWinId();
  if (cid != null && winId === cid) {
    consoleWinId = null;
    await chrome.storage.local.remove("amsConsoleWin");
    cancelPendingSends(); // 不等串行链：尚未正式派发的站点立即停止
    await serializeOp(closeAll); // 进串行链：与在途 openTile/sendAll 的读-改-写 amsWindows 互斥
    return;
  }
  const cmp = await getComposeWinId();
  if (cmp != null && winId === cmp) { composeWinId = null; await chrome.storage.local.remove("amsComposeWin"); return; }
  const scope = await getScopeWinId();
  if (scope != null && winId === scope) { scopeWinId = null; await chrome.storage.local.remove("amsScopeWin"); return; }
  const arc = await getArchiveWinId();
  if (arc != null && winId === arc) { archiveWinId = null; await chrome.storage.local.remove("amsArchiveWin"); }
});
// console 前后台/最小化联动改由 console 页面自身的可靠 DOM 事件驱动（见 console/console.js：window
// focus → consoleFocused 抬整组；document visibilitychange hidden → consoleHidden 联动最小化）。弃用
// chrome.windows.onFocusChanged：实测 Windows 上它对「点 console 抬窗 / 最小化 console」常不派发、也
// 不唤醒休眠的 SW，且在 minimizeAllManaged 期间乱发焦点事件，造成「最小化后又自动复原」的竞态。


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.source !== "AMS_CONSOLE") return;
  if (msg.action === "consoleFocused") {
    // console 页面被点到前台（可靠信号，替代不可靠的 chrome.windows.onFocusChanged）→ 去抖后抬整组工作区。
    if (Date.now() < suppressFocusUntil) return; // 抑制 raiseConsole 末尾重聚焦 console 自触发的获焦消息，防递归
    scheduleRaise();
    return;
  }
  if (msg.action === "consoleHidden") {
    // console 页面变 hidden：取消可能由「聚焦最小化键」顺带排下的待抬窗（防抬窗与最小化打架）。再读真实
    // window state 区分最小化 vs 被完全遮挡（Chrome 遮挡跟踪也会置 hidden）——仅当确为 minimized 才联动最小化。
    if (raiseTimer != null) { clearTimeout(raiseTimer); raiseTimer = null; }
    (async () => {
      const cid = await getConsoleWinId();
      if (cid == null) return;
      let st = null; try { st = (await chrome.windows.get(cid)).state; } catch (e) { return; }
      if (st === "minimized") await minimizeAllManaged();
    })();
    return;
  }
  if (msg.action === "openConsole") {
    // popup 发起时带当前站 host：console 首次使用（无勾选历史）预勾该站，打通"正看着这个站想群发"的路径
    openConsole(msg.host); return;
  }
  if (msg.action === "openScope") {
    if (raiseTimer != null) { clearTimeout(raiseTimer); raiseTimer = null; }
    suppressFocusUntil = Date.now() + 600;
    openScope(msg.anchor); return;
  }
  if (msg.action === "openCompose") { openCompose(msg.anchor); return; }
  if (msg.action === "openArchive") { openArchive(); return; }
  if (msg.action === "openTile") { serializeOp(() => openTile(msg.sites || [])).then((results) => sendResponse({ results })).catch(() => sendResponse({ results: [] })); return true; }
  if (msg.action === "sendAll") {
    const epoch = currentSendEpoch();
    serializeOp(() => sendAll(msg.sites || [], msg.text || "", msg.tier || null, msg.tile !== false, epoch, msg.images || [], msg.run || {})).then((results) => sendResponse({ results })).catch(() => sendResponse({ results: [] })); return true;
  }
  if (msg.action === "checkup") { serializeOp(() => checkupAll(msg.sites || [])).then((results) => sendResponse({ results })).catch(() => sendResponse({ results: [] })); return true; }
  if (msg.action === "collect") {
    const epoch = currentSendEpoch(), hasRunId = Object.hasOwn(msg, "runId");
    const matchesRun = () => new Promise((resolve) => chrome.storage.session.get("amsLastRun", (value) => {
      void chrome.runtime.lastError; resolve(!hasRunId || (value?.amsLastRun?.runId || null) === (msg.runId || null));
    }));
    const active = async () => epoch === currentSendEpoch() && await matchesRun();
    (async () => {
      if (!await active()) return { results: [], code: "stale_run" };
      const results = await collectAll(msg.sites || []);
      return await active() ? { results } : { results: [], code: "stale_run" };
    })()
      .then(sendResponse).catch(() => sendResponse({ results: [], code: "error" })); return true;
  } // 只读收集回答，同上
  // 回应完成时刻：console 据此解除按钮忙碌态（操作可能在串行链里排队最长 ~22s，无反馈像卡死）
  if (msg.action === "closeAll") { cancelPendingSends(); serializeOp(closeAll).then(() => sendResponse({}), () => sendResponse({})); return true; }
  if (msg.action === "newSession") { cancelPendingSends(); serializeOp(() => newSessionAll(msg.sites || [])).then(() => sendResponse({}), () => sendResponse({})); return true; }
});
