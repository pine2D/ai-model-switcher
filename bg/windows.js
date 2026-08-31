// bg/windows.js — 窗口层：工作区查询/创建/定位/联动（popup-only 铁律核心）
const STRIP_H = 96;

// 控制台管理的窗口 host→{id,owned,orphans}（会话级，跨 SW 休眠但不跨浏览器重启）。owned=true 为控制台
// 新建（closeAll 可自动关）；owned=false 预留给「复用用户窗口」——该路径当前没有任何生产者，生产代码里
// owned 恒为 true（F003），别把它当现役保护引用。orphans：被导航走后失联的旧受管窗 id，closeAll 一并回收。
// 后续所有按 host 的操作都认这里登记的 windowId，不再裸查 tabs——否则会误抓用户事后在主窗口开的同站标签。
function getWindows() {
  return new Promise((res) => chrome.storage.session.get("amsWindows", (o) => { void chrome.runtime.lastError; res((o && o.amsWindows) || {}); }));
}
function setWindows(map) {
  return new Promise((res) => chrome.storage.session.set({ amsWindows: map }, () => { void chrome.runtime.lastError; res(); }));
}
// 解析某 host 的「PolyAsk 受管 popup 窗口」。铁律：只返回 type:"popup"，绝不返回用户
// 日常浏览窗口(type:"normal")，也不全局收编同站第三方 popup。登记窗口还必须让活动标签停在
// 目标 host；用户把受管窗导航走后绑定立即失效，调用方会新建正确窗口。
async function managedTabForHost(host, wins) {
  const rec = wins && wins[host];
  if (!rec || rec.id == null) return null;
  try {
    const w = await chrome.windows.get(rec.id);
    if (w.type !== "popup") return null;
    const tabs = await chrome.tabs.query({ active: true, windowId: rec.id });
    const tab = tabs[0];
    if (!tab) return null;
    const matches = [tab.url, tab.pendingUrl].some((url) => {
      try { return !!url && new URL(url).hostname === host; } catch (e) { return false; }
    });
    return matches ? tab : null;
  } catch (e) { return null; }
}
async function popupWindowForHost(host, wins) {
  const tab = await managedTabForHost(host, wins);
  return tab ? tab.windowId : null;
}
// 仅当给定窗口 id 确实存在且是 popup 时才关闭它（不回退搜索，避免误关无关窗口）。
async function removeIfPopup(id) {
  try { const w = await chrome.windows.get(id); if (w.type === "popup") await chrome.windows.remove(id); } catch (e) {}
}
// 仅当给定窗口 id 确实是 popup 时才 update（与 removeIfPopup 同款防御）：amsComposeWin 持久化，
// 跨浏览器重启 Chrome 会重排窗口 id，陈旧值可能撞上用户 type:"normal" 日常窗口——故所有对
// composeWinId 的 minimize/restore/focus 都先校验类型，绝不碰日常窗口。返回是否真的操作了 popup。
async function updateIfPopup(id, props) {
  try { const w = await chrome.windows.get(id); if (w.type === "popup") { await chrome.windows.update(id, props); return true; } } catch (e) {}
  return false;
}
// host → 受管 popup 内的标签（只认 popup；无受管窗口则空，调用方对该站静默跳过）。
async function tabsForHost(host, wins) {
  const tab = await managedTabForHost(host, wins);
  return tab ? [tab] : [];
}

async function primaryWorkArea() {
  let wa = { left: 0, top: 0, width: 1280, height: 800 };
  try {
    const info = await chrome.system.display.getInfo();
    const d = info.find((x) => x.isPrimary) || info[0];
    if (d && d.workArea) wa = d.workArea;
  } catch (e) {}
  return wa;
}

// 平铺/伴侣窗的统一几何（一次解析，供 openTile / scope / compose / archive 共用）：
// wa = console 中心点所在显示器的工作区（拖到哪屏就铺哪屏，取不到回退主屏）；left/top/bottom = console
// 窗口的实际边；reserve = console 底边相对 wa.top 的占高。关键：c.top 已含窗口管理器在 Chrome 几何之外
// 的上移装饰（如 X410 给每个窗口套的 ~30px 标题栏——请求 top=0 时 Chrome 报告 top=30），只用 c.height
// 会漏掉这段、让平铺窗压在 console 上。工作区与 console 坐标必须来自同一次解析：console 中心点落在所有
// workArea 之外（被拖进任务栏带、副屏刚拔掉）时 wa 回退主屏，此时 (c.top+c.height)-wa.top 就是跨屏距离，
// 曾把整组平铺窗算到屏幕之外（F006）——故未命中显示器/非 popup/缺字段时一律按「贴 wa 顶部的 STRIP_H
// 细条」估算（attached=false，调用方据此不拿 console 的 left 做锚点），绝不混坐标系。
async function consoleGeometry() {
  const wa = await primaryWorkArea();
  const strip = (area) => ({ wa: area, left: area.left, top: area.top, bottom: area.top + STRIP_H, reserve: STRIP_H, attached: false });
  const cid = await getConsoleWinId();
  if (cid == null) return strip(wa);
  try {
    const [c, info] = [await chrome.windows.get(cid), await chrome.system.display.getInfo()];
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    const d = info.find((x) => x.workArea && cx >= x.workArea.left && cx < x.workArea.left + x.workArea.width &&
      cy >= x.workArea.top && cy < x.workArea.top + x.workArea.height);
    const area = (d && d.workArea) || wa;
    if (!d || !d.workArea || c.type !== "popup" || c.top == null || c.height == null) return strip(area);
    return { wa: area, left: c.left, top: c.top, bottom: c.top + c.height, reserve: Math.max(STRIP_H, c.top + c.height - area.top), attached: true };
  } catch (e) { return strip(wa); }
}
async function consoleWorkArea() { return (await consoleGeometry()).wa; } // 只要工作区的调用点（compose/archive）

async function getConsoleWinId() {
  if (consoleWinId != null) return consoleWinId;
  const o = await new Promise((r) => chrome.storage.local.get("amsConsoleWin", (v) => { void chrome.runtime.lastError; r(v); }));
  consoleWinId = (o && o.amsConsoleWin) != null ? o.amsConsoleWin : null;
  return consoleWinId;
}
async function getComposeWinId() {
  if (composeWinId != null) return composeWinId;
  const o = await new Promise((r) => chrome.storage.local.get("amsComposeWin", (v) => { void chrome.runtime.lastError; r(v); }));
  composeWinId = (o && o.amsComposeWin) != null ? o.amsComposeWin : null;
  return composeWinId;
}
async function getArchiveWinId() {
  if (archiveWinId != null) return archiveWinId;
  const o = await new Promise((r) => chrome.storage.local.get("amsArchiveWin", (v) => { void chrome.runtime.lastError; r(v); }));
  archiveWinId = (o && o.amsArchiveWin) != null ? o.amsArchiveWin : null;
  return archiveWinId;
}

// in-flight 去重（console/compose/archive/scope 四个开窗入口共用）：SW 冷启动时背靠背两条消息会双开窗
// 并孤儿化前一个。但只看「有没有在途」会连第二次调用的参数一起吞掉——归档窗点「辅助综合」后立刻点
// console 的「编辑」，第二条命中在途 promise，`mode:"synthesis"` 被静默丢弃、弹出普通编辑窗（F005）。
// 故按参数指纹分桶：同指纹复用在途 promise；指纹不同的排到它后面重跑一遍（复用分支会把既有窗导航到
// 正确 URL），参数不再被吞掉。
const _inflight = new Map();
function onceByKey(name, key, run) {
  const cur = _inflight.get(name);
  if (cur && cur.key === key) return cur.promise;
  const rec = { key };
  rec.promise = (cur ? cur.promise.catch(() => {}) : Promise.resolve()).then(run)
    .finally(() => { if (_inflight.get(name) === rec) _inflight.delete(name); });
  _inflight.set(name, rec);
  return rec.promise;
}
async function openConsole(prefillHost) { return onceByKey("console", prefillHost || "", () => _openConsole(prefillHost)); }
async function _openConsole(prefillHost) {
  // 幂等：已开则聚焦既有 console（经 type 校验，陈旧/撞日常窗 → 继续新建），杜绝重复 console 孤立旧窗
  const cid = await getConsoleWinId();
  if (cid != null && await updateIfPopup(cid, { focused: true, state: "normal" })) return cid;
  if (prefillHost) await chrome.storage.local.set({ amsConsolePrefill: prefillHost });
  const wa = await primaryWorkArea();
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL("console/console.html"),
    type: "popup", left: wa.left, top: wa.top, width: wa.width, height: STRIP_H, focused: true,
  });
  consoleWinId = w.id;
  await chrome.storage.local.set({ amsConsoleWin: w.id });
  return w.id;
}
function isConsoleTab(tab, expected) { return !!tab && (tab.url === expected || tab.pendingUrl === expected); }
async function ensureConsoleReady(prefillHost, timeoutMs = 5000) { return new Promise((resolve, reject) => {
    let timer, settled = false, onUpdated, onRemoved, windowId, tab, expected;
    const finish = (error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (onUpdated) chrome.tabs.onUpdated.removeListener(onUpdated); if (onRemoved) chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve(windowId);
    }; const verify = () => chrome.tabs.get(tab.id).then((current) => {
      if (!isConsoleTab(current, expected)) return finish(new Error("console_missing"));
      if (current.status === "complete") finish();
    }, () => finish(new Error("console_missing"))); timer = setTimeout(() => finish(new Error("console_timeout")), timeoutMs);
    openConsole(prefillHost).then((id) => {
      if (settled) return null;
      windowId = id; expected = chrome.runtime.getURL("console/console.html");
      return chrome.tabs.query({ windowId });
    }).then((tabs) => {
      if (settled || !tabs) return;
      tab = tabs.find((item) => isConsoleTab(item, expected));
      if (!tab?.id) return finish(new Error("console_missing"));
      if (tab.status === "complete") return finish();
      onUpdated = (tabId, change) => {
        if (tabId !== tab.id) return;
        chrome.tabs.get(tab.id).then((current) => {
          if (!isConsoleTab(current, expected)) return finish(new Error("console_missing"));
          if (change.status === "complete") finish();
        }, () => finish(new Error("console_missing")));
      };
      onRemoved = (tabId) => { if (tabId === tab.id) finish(new Error("console_closed")); };
      chrome.tabs.onUpdated.addListener(onUpdated); chrome.tabs.onRemoved.addListener(onRemoved); verify();
    }, finish);
  }); }

// 伴侣编辑窗：控制面（同 console），绝不进 amsWindows；通过专属 id 随工作区联动和关闭。
// anchor（可选）= console 输入框的视口内 {left,width}：据此把伴侣窗贴 console 底边、与输入框等宽，
// 制造「输入框向下展开」的错觉。取不到 console 几何则回退居中。
// in-flight 去重见 onceByKey：mode + anchor 一起进指纹，「辅助综合」不会被并发的普通「编辑」降级（F005）。
async function openCompose(anchor, mode) {
  return onceByKey("compose", (mode || "") + "|" + JSON.stringify(anchor || null), () => _openCompose(anchor, mode));
}
async function _openCompose(anchor, mode) {
  const desired = chrome.runtime.getURL("console/compose.html") + (mode === "synthesis" ? "?mode=synthesis" : "");
  const cid = await getComposeWinId();
  if (cid != null && await updateIfPopup(cid, { focused: true, state: "normal" })) { const [tab] = await chrome.tabs.query({ active: true, windowId: cid }); if (tab && tab.url !== desired) await chrome.tabs.update(tab.id, { url: desired }); return; }
  const wa = await consoleWorkArea(); // 贴着 console 所在显示器展开
  const H = Math.min(460, wa.height);
  let W = Math.min(760, wa.width);
  let left = wa.left + Math.max(0, Math.floor((wa.width - W) / 2));
  let top = wa.top + Math.max(0, Math.floor((wa.height - H) / 3));
  if (anchor && anchor.width) {
    try {
      const c = await chrome.windows.get(await getConsoleWinId());
      if (c && c.left != null && c.top != null && c.height != null) {
        W = Math.min(Math.max(640, Math.round(anchor.width)), wa.width);
        left = Math.round(c.left + anchor.left); // 窗口屏幕左 + 输入框视口内左 ≈ 输入框屏幕左
        top = c.top + c.height;                  // 贴 console 实际底边（c.top 已含 WM 标题栏上移）
        if (left < wa.left) left = wa.left;       // 夹取到工作区，防越界
        if (left + W > wa.left + wa.width) left = wa.left + wa.width - W;
        if (top + H > wa.top + wa.height) top = wa.top + wa.height - H;
      }
    } catch (e) {}
  }
  const w = await chrome.windows.create({ url: desired, type: "popup", left, top, width: W, height: H, focused: true });
  composeWinId = w.id;
  await chrome.storage.local.set({ amsComposeWin: w.id });
}

// 归档查看窗：与伴侣窗同款受管（专属登记 id、随 console 联动最小化/抬前、closeAll 一起关、
// 绝不进 amsWindows）。幂等：已开则聚焦（经 type 校验，陈旧 id/撞日常窗 → 继续新建）。
async function openArchive() { return onceByKey("archive", "", () => _openArchive()); }
async function _openArchive() {
  const aid = await getArchiveWinId();
  if (aid != null && await updateIfPopup(aid, { focused: true, state: "normal" })) return;
  const wa = await consoleWorkArea(); // 开在 console 所在显示器，居中偏上
  const W = Math.min(760, wa.width - 40), H = Math.min(560, wa.height - 60);
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL("console/archive.html"), type: "popup",
    left: wa.left + Math.max(0, Math.floor((wa.width - W) / 2)),
    top: wa.top + Math.max(0, Math.floor((wa.height - H) / 3)),
    width: W, height: H, focused: true,
  });
  archiveWinId = w.id;
  await chrome.storage.local.set({ amsArchiveWin: w.id });
}

// 把控制台细条窗口抬到最前（每次平铺/操作后保持可见）。
// 只认登记 id + 类型校验：裸查 URL 会命中被用户开进 normal 窗口标签的 console.html，抢焦日常窗口。
async function raiseConsole() {
  suppressFocusUntil = Date.now() + 600; // 程序化抬 console 会触发 onFocusChanged，抑制其自激
  const cid = await getConsoleWinId();
  if (cid != null) await updateIfPopup(cid, { focused: true });
}

async function consoleIsMinimized() {
  const cid = await getConsoleWinId();
  if (cid == null) return false;
  try { return (await chrome.windows.get(cid)).state === "minimized"; } catch (e) { return false; }
}

// 受管平铺窗 id 列表（经 popup-only 解析，绝不含日常窗口）。并行解析：逐 host 串行 await
// 是 9+ 次 windows.get 往返，联动抬窗/最小化的到位速度直接受其拖累。
async function managedTileIds() {
  const wins = await getWindows();
  const ids = await Promise.all(Object.keys(wins).map((host) => popupWindowForHost(host, wins)));
  return ids.filter((id) => id != null);
}

async function windowIdsForSites(sites) {
  const wins = await getWindows();
  const ids = await Promise.all(sites.map((s) => popupWindowForHost(s.host, wins)));
  return ids.filter((id) => id != null);
}

// 发送后自动置顶选中站点（sendAll 用）：逐个恢复+抬前（OS 限制：只能一个持焦，平铺不重叠故视觉全前置）
async function focusAll(sites) {
  for (const id of await windowIdsForSites(sites)) {
    try { await chrome.windows.update(id, { state: "normal", focused: true }); } catch (e) {}
  }
}
// 联动：统一最小化全部受管 popup（绝不碰日常窗口）+ 伴侣窗/归档窗一起最小化
async function minimizeAllManaged() {
  for (const id of await managedTileIds()) { try { await chrome.windows.update(id, { state: "minimized" }); } catch (e) {} }
  const cmp = await getComposeWinId(); // 伴侣窗经专属 id 随动（不入 amsWindows，不破 popup-only 模型）
  if (cmp != null) await updateIfPopup(cmp, { state: "minimized" }); // 类型校验：陈旧 id 不误碰日常窗口
  const arc = await getArchiveWinId(); // 归档窗同款随动
  if (arc != null) await updateIfPopup(arc, { state: "minimized" });
}
// ③ 把 PolyAsk 工作区（平铺窗 + console）整体抬到前台：各窗 focused:true 抬 z-order，伴侣窗随后，
// console 最后置顶。由 console 页面 focus 事件经 background 去抖后调用——此时 console 已是前台进程，
// focused:true 即可把自家窗口抬到前面（温和、不闪；还原最小化窗也走这条，state:normal 即解最小化）。
// ④ 跨平台：state/focused 是 chrome.windows 的可移植操作，三系统通用；置顶实效受各 OS 窗口管理器左右，尽力而为。
async function raiseWorkspace() {
  suppressFocusUntil = Date.now() + 600; // 抑制随后由 raiseConsole 重聚焦 console 回报的 focus 事件，防递归
  const tileIds = await managedTileIds();
  const cmp = await getComposeWinId(); // 伴侣窗/归档窗随工作区前置：在平铺之上、console 之下
  const arc = await getArchiveWinId();
  for (const id of tileIds) { try { await chrome.windows.update(id, { state: "normal", focused: true }); } catch (e) {} }
  if (arc != null) await updateIfPopup(arc, { state: "normal", focused: true });
  if (cmp != null) await updateIfPopup(cmp, { state: "normal", focused: true }); // 类型校验同 removeIfPopup
  await raiseConsole();
  suppressFocusUntil = Date.now() + 600; // ponytail: 时间窗启发式(600ms)，上限=偶尔误抑制一次紧邻真实切换
}

async function getAutoRaise() {
  const o = await new Promise((r) => chrome.storage.local.get({ amsAutoRaise: true }, (v) => { void chrome.runtime.lastError; r(v); }));
  return o.amsAutoRaise !== false;
}
// 关闭全部：关闭控制台新建（owned）的窗口，以及它留下的孤儿窗（被导航走后失联的旧受管窗，F001——
// 当场不关是因为用户很可能正在那个窗里登录）；复用/用户窗口不动。随后清空登记；伴侣窗一起关。
async function closeAll() {
  await clearLastRun();
  const wins = await getWindows();
  for (const host of Object.keys(wins)) {
    for (const id of wins[host].orphans || []) await removeIfPopup(id);
    if (wins[host].owned) { await removeIfPopup(wins[host].id); }
  }
  await setWindows({});
  const cmp = await getComposeWinId(); // 伴侣窗/归档窗随平铺一起关（经专属 id；各自 onRemoved 清登记）
  if (cmp != null) await removeIfPopup(cmp);
  const scope = await getScopeWinId();
  if (scope != null) await removeIfPopup(scope);
  const arc = await getArchiveWinId();
  if (arc != null) await removeIfPopup(arc);
}
