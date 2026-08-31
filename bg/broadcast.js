// bg/broadcast.js — 广播层：群发、平铺开窗、新会话（依赖 bg/windows.js 的窗口层）

// 把 openTile/sendAll 串行化，杜绝并发各自读-改-写 amsWindows 泄漏同 host 重复 popup
let _opChain = Promise.resolve();
function serializeOp(fn) { const r = _opChain.then(fn, fn); _opChain = r.then(() => {}, () => {}); return r; }
let _sendEpoch = 0;
function currentSendEpoch() { return _sendEpoch; }
function cancelPendingSends() { _sendEpoch++; }
async function clearLastRun() {
  await chrome.storage.session.remove("amsLastRun");
  pushBroadcast({ type: "runCleared" });
}
const MESSAGE_TIMEOUT = Symbol("message-timeout");
async function messageBefore(send, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return MESSAGE_TIMEOUT;
  let timer;
  try {
    return await Promise.race([send(), new Promise((resolve) => { timer = setTimeout(() => resolve(MESSAGE_TIMEOUT), left); })]);
  } finally { clearTimeout(timer); }
}
// Kimi 发送/切模会重挂页面并断开消息端口；新 content 明确确认“末条用户消息不存在”后才可重试。
async function submittedAfterRerender(tabId, text, deadline) {
  const end = Math.min(deadline, Date.now() + 1500);
  let misses = 0;
  while (Date.now() < end) {
    try {
      const r = await messageBefore(() => chrome.tabs.sendMessage(tabId, { source: "AMS", cmd: "wasSubmitted", text }), end);
      if (r === MESSAGE_TIMEOUT) break;
      if (r && r.supported === true) { if (r.ok) return true; if (++misses >= 5) return false; }
      else if (r && r.supported === false) return null;
    } catch (e) { /* 页面重挂中，等新 content 注入 */ }
    await new Promise((resolve) => setTimeout(resolve, Math.min(150, Math.max(0, end - Date.now()))));
  }
  return null;
}

const TILE_MIN_H = 240; // 平铺区可用下限：低于此高度的一条窄带不足以显示任何 AI 页面，宁可翻到 console 上方
// 旧受管窗被导航走（会话过期跳鉴权域、点了回答里的外链）后 popupWindowForHost 认不出它，openTile 新建
// 并覆盖登记，旧窗从此彻底脱管：closeAll 关不掉、最小化/抬前也够不到，几轮下来堆出一屏无人认领的 popup
// （F001）。这里把它收进孤儿表交给 closeAll 回收——当场不关，因为用户很可能正在那个窗里登录。
// 只留最近 4 个：长会话里反复跳转不至于把登记表撑大，且孤儿窗 id 同会话内不复用，按 id 关是安全的。
function orphansOf(stale, windowId) {
  const kept = ((stale && stale.orphans) || []).concat(stale && stale.owned && stale.id !== windowId ? [stale.id] : []);
  return kept.filter((id, i) => id !== windowId && kept.indexOf(id) === i).slice(-4);
}

// prune=true（显式「平铺」与 sendAll 隐式开窗共用）：全量重排 + 清理未勾选（owned 关闭、复用仅解除登记）。
// prune=false 仅剩辅助综合单站隐式开窗（bg/synthesis.js）：只为缺窗站落格，绝不关别的窗、不动既有布局。
// sendAll 曾走 prune=false「不重排既有窗口」，但缺窗本身说明勾选集变了：新窗按新布局落格、旧窗停在旧
// 布局原地 → 错位重叠，且取消勾选的站不清理（用户实报 2026-08-18）。「追问少数站不得动手调布局」的
// 保护仍在——勾选集没新增缺窗时 sendAll 根本不会调 openTile（见 anyMissing 判定与 test-tile-reflow.js ③）。
// epoch：长流程（最多 9 次 create + 9 次 update，数秒）必须逐段核对，否则用户关掉 console 后后台还在
// 开窗抢焦、随后排队的 closeAll 再把它们全关掉（F002）。取消时不中止已建窗，但一律先落盘再返回。
async function openTile(sites, prune = true, epoch = currentSendEpoch()) {
  const stop = () => epoch !== currentSendEpoch();
  const geo = await consoleGeometry(); // console 拖到哪个显示器就铺哪个显示器；wa 与 console 上下边同一次解析
  const wa = geo.wa;
  // 平铺区 = console 让出的可用带。旧代码只夹高度不夹顶边：console 停在工作区下缘时 reserve≈全高，
  // areaTop 正好落在工作区底边甚至更低，九个窗全部建到屏幕之外（F011）。consoleBand 恒返回工作区内的带。
  const band = consoleBand(wa, geo, TILE_MIN_H);
  const areaLeft = wa.left, areaTop = band.top, areaW = wa.width, areaH = band.height;
  const n = sites.length || 1;
  // n≤4：单排等分并排（水平二/三/四等分，各占满高度）；n≥5：方形网格
  let cols, rows;
  if (n <= 4) { cols = n; rows = 1; }
  else { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
  const cellW = Math.floor(areaW / cols), cellH = Math.floor(areaH / rows);
  const wins = await getWindows();
  const selectedHosts = sites.map((s) => s.host);
  const out = [];
  // 1) 处理已取消勾选（仅显式平铺）：owned 的真正关闭，复用的仅解除登记（用户窗口不动）
  if (prune) for (const host of Object.keys(wins)) {
    if (stop()) break;
    if (!selectedHosts.includes(host)) {
      for (const id of wins[host].orphans || []) await removeIfPopup(id); // 该站的孤儿窗随之回收
      if (wins[host].owned) { await removeIfPopup(wins[host].id); }
      delete wins[host];
    }
  }
  // 2) 处理选中站点：优先复用受管 popup → 新建 popup，逐个定位（popup-only 铁律）
  for (let i = 0; i < sites.length && !stop(); i++) {
    const s = sites[i];
    const col = i % cols, row = Math.floor(i / cols);
    const bounds = { left: areaLeft + col * cellW, top: areaTop + row * cellH, width: cellW, height: cellH };
    const stale = wins[s.host];
    let windowId = await popupWindowForHost(s.host, wins);
    let reused = false, owned = false;
    if (windowId != null) {
      reused = true;
      const rec = wins[s.host];
      owned = !!(rec && rec.id === windowId && rec.owned); // 仅沿用「同一登记窗口」的归属
      if (prune) { try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {} } // 隐式开窗不重排既有窗
    } else {
      // 新建窗口始终从该站的新会话入口开始；只有已存在的受管 popup 才延续当前对话。
      // create 后补一次 update 落格：部分窗口管理器（WSLg/X 系，真机 2026-08-18 实证）忽略 create 的
      // 初始 bounds、但服从 update——不补这行新窗会叠在 WM 默认位置。
      try {
        const w = await chrome.windows.create(Object.assign({ url: s.url, type: "popup", focused: false }, bounds));
        windowId = w.id; owned = true;
        await chrome.windows.update(windowId, bounds);
      } catch (e) {}
    }
    if (windowId != null) wins[s.host] = { id: windowId, owned, orphans: orphansOf(stale, windowId) };
    out.push({ host: s.host, windowId, reused, opened: !reused && windowId != null });
  }
  await setWindows(wins); // 中途取消也先落盘：已建的窗必须留在登记表里，否则 closeAll 够不到（F002）
  if (stop()) return out; // 取消后不再抢焦/抬窗
  // 3) 操作期间用户若最小化控制台，新建窗口也保持最小化，不在完成回调里把整组重新抬起。
  const minimized = await consoleIsMinimized();
  for (const r of out) if (r.windowId != null) {
    try { await chrome.windows.update(r.windowId, minimized ? { state: "minimized" } : { state: "normal", focused: true }); } catch (e) {}
  }
  if (!minimized) await raiseConsole();
  return out;
}

// 发送到全部：有站点尚无窗口则先平铺，再逐站等页面就绪后提交。
// 用户初次使用无需先点「平铺」：勾选 → 输入 → Enter 即可一步开窗+群发。
async function sendAll(sites, text, tier, tile = true, epoch = currentSendEpoch(), images = [], run = {}) {
  // F023（取消早退时 console 的 progress 从未起表 → 失败汇总与 #live 全程静默）不能在 bg 侧闭环：
  // 补 sendStart 会撞上 scripts/test-archive-capture.js:50「过期请求不得开始进度广播」这条既有保护，
  // 也会把 closeAll 刚清空的芯片重新点亮（console/status.js 的 ignoreResults 正是为此存在）。
  // 该由 console 侧收口：applyResults 收到一批 ok===false 而 progress.total 为 0 时补一次 progress 再播报。
  const cancelled = () => sites.map((s) => ({ host: s.host, ok: false, code: "cancelled" }));
  if (epoch !== currentSendEpoch()) return cancelled();
  const now = Date.now();
  const runId = run.runId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : now.toString(36) + Math.random().toString(36).slice(2));
  const runMeta = { runId, text, task: typeof run.task === "string" ? run.task : String(text), source: run.source || null,
    hosts: Array.isArray(run.hosts) ? run.hosts : sites.map((site) => site.host), tier: run.tier || tier || null, sentAt: run.sentAt || now };
  await chrome.storage.session.set({ amsLastRun: runMeta });
  const wins = await getWindows();
  let anyMissing = false;
  for (const s of sites) { if ((await popupWindowForHost(s.host, wins)) == null) { anyMissing = true; break; } }
  if (tile && anyMissing) await openTile(sites, true, epoch); // 勾选集变了（有缺窗）→ 全量重排+清理未勾选；retry 传 tile=false 连开窗也免
  if (epoch !== currentSendEpoch()) return cancelled();
  // 进度起点（console/compose 发起都统一）；带 text/tier 让 console 重建 lastSend（compose 发起的失败也能一键重试）
  pushBroadcast({ type: "sendStart", hosts: sites.map((site) => site.host), run: runMeta, text, task: runMeta.task,
    source: runMeta.source, tier: runMeta.tier, hasImage: images.length > 0 });
  const wins2 = await getWindows(); // 开窗失败或 retry 不开窗：缺窗站立即报 no_window，不空转到 timeout
  const results = await Promise.all(sites.map(async (s) => {
    if ((await popupWindowForHost(s.host, wins2)) == null) {
      const res = { host: s.host, ok: false, code: "no_window" }; pushSiteResult(res); return res;
    }
    return submitWhenReady(s, text, tier, images.length ? 45000 : 22000, 800, epoch, images);
  }));
  if (epoch === currentSendEpoch()) {
    if (await consoleIsMinimized()) await minimizeAllManaged();
    else {
      if (await getAutoRaise()) await focusAll(sites); // 发送后自动置顶全部平铺窗
      await raiseConsole();
    }
  }
  return results;
}

// 单站结果即时推给控制台（逐站实时回填，无需等全部完成）；无接收方时静默吞错。
function pushBroadcast(payload) {
  try { chrome.runtime.sendMessage(Object.assign({ from: "AMS_BG" }, payload), () => void chrome.runtime.lastError); } catch (e) {}
}
function pushSiteResult(res) { pushBroadcast({ type: "siteResult", result: res }); }

// 连续多少轮解析不到受管窗口才判 no_window。轮间隔 gap=800ms → 8 轮≈6.4s：远小于 44s/90s 绝对线，
// 又给「新建窗口的标签尚未挂上」「跨域登录跳转」留足宽限（真机上首轮即可解析，8 轮是 8 倍余量）。
const NO_WINDOW_MISSES = 8;
// 轮询直到该站页面就绪并提交：已开窗口首轮即命中；新开窗口需加载+content 注入+composer 出现，
// 故 content 未注入 / composer_not_found 都视为"还没好"继续等，其它 ok=false 才是真失败。
// 失败原因走错误码协议（code），由 console 端按界面语言翻译——bg/content 不产出用户可见文案。
// 任一出口都先 pushSiteResult 让该站圆点立刻变色，再返回参与 Promise.all 汇总。
async function submitWhenReady(s, text, tier, timeoutMs = 22000, gap = 800, epoch = currentSendEpoch(), images = [], notify = true) {
  const t0 = Date.now();
  const firstDeadline = t0 + timeoutMs, deadline = t0 + timeoutMs * 2;
  // waited 与 resent 是两件事，曾合流成一个 retried：对只是「慢加载站超过软截止线后继续等」的站也报
  // 「已自动重试」，用户以为对方收到了两遍、跑去站里删一条；而真重发过的 Kimi 又长得一模一样（F018）。
  let waited = false;                       // 超过首轮软截止线（22s/45s）继续等到绝对线——没有任何重发动作
  let submitRetried = false, resent = false; // resent：只读 submitted() 明确确认后真的重发了一次（仅 Kimi）
  let misses = 0;                            // 连续解析不到受管窗口的轮数（见下方 NO_WINDOW_MISSES）
  const done = (ok, code, reason) => {
    const res = { host: s.host, ok, code, reason, ms: Date.now() - t0 }; // ms：逐站耗时，console 拼进 title 服务速度对比
    if (waited) res.waited = true;
    if (resent) { res.resent = true; res.retried = true; } // retried 只留给真重发，继续等不再冒充重发
    if (notify) pushSiteResult(res); return res;
  };
  const wins = await getWindows(); // openTile 已在 Promise.all 前定稿登记表，轮询期不变，读一次即可
  for (;;) {
    if (epoch !== currentSendEpoch()) return done(false, "cancelled");
    if (Date.now() >= deadline) return done(false, "timeout");
    if (!waited && Date.now() >= firstDeadline) waited = true;
    const tabs = await tabsForHost(s.host, wins);
    // 窗口被用户中途关掉后 tabsForHost 恒空，旧代码把「空」一律当成「页面还没准备好」，一路空转到
    // 44s/90s 才报 timeout，把用户引向排查登录状态（F007）。连续 NO_WINDOW_MISSES 轮解析不到即判 no_window。
    if (!tabs.length && ++misses >= NO_WINDOW_MISSES) return done(false, "no_window");
    if (tabs.length) {
      misses = 0;
      let ready = false, probe;
      try {
        probe = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "getState" }), deadline);
        if (probe === MESSAGE_TIMEOUT) return done(false, "timeout");
        ready = !!probe && Object.prototype.hasOwnProperty.call(probe, "state");
      } catch (e) { /* content 尚未注入，继续等 */ }
      if (ready) {
        if (epoch !== currentSendEpoch()) return done(false, "cancelled");
        if (Date.now() >= deadline) return done(false, "timeout");
        let r, dispatchFailed = false;
        try {
          r = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "submitPrompt", text, tier, deadline, images }), deadline);
        } catch (e) { dispatchFailed = true; }
        const uncertain = dispatchFailed || r === MESSAGE_TIMEOUT || !r || typeof r.ok !== "boolean" || (!r.ok && r.code === "submit_unconfirmed");
        if (uncertain && probe.canConfirm) {
          const submitted = await submittedAfterRerender(tabs[0].id, text, deadline);
          if (submitted === true) return done(true);
          if (submitted === false && !submitRetried) { submitRetried = true; resent = true; continue; }
        }
        if (uncertain) return done(false, "submit_unconfirmed"); // 无只读确认能力的站点仍绝不重发
        if (r && r.ok) return done(true, r.code); // ok 时 code 可携带 tier_unconfirmed 警示
        if (r.code !== "composer_not_found") {
          return done(false, r.code || "error", r.reason);
        }
      }
    }
    await new Promise((res) => setTimeout(res, Math.min(gap, Math.max(0, deadline - Date.now()))));
  }
}

// 全站健康巡检：对每个选中站点的受管 tab 发只读 diagnose（零副作用），逐站汇总失败项。
// 无窗/未注入也如实上报——适配器失效不再要用户逐站打开 popup 手动诊断。
// 并行逐站（Promise.all 保序）：串行时一站挂起（如水合中的重站）会拖住整批结果。
async function checkupAll(sites, timeoutMs = 8000) {
  const wins = await getWindows();
  const deadline = Date.now() + timeoutMs;
  return Promise.all(sites.map(async (s) => {
    const tabs = await tabsForHost(s.host, wins);
    if (!tabs.length) return { host: s.host, ok: false, code: "no_window" };
    try {
      const r = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "diagnose" }), deadline);
      if (r === MESSAGE_TIMEOUT) return { host: s.host, ok: false, code: "not_ready" };
      if (!r || !Array.isArray(r.checks)) return { host: s.host, ok: false, code: "not_ready" };
      const bad = r.checks.filter((c) => !c.ok).map((c) => c.name);
      return bad.length ? { host: s.host, ok: false, reason: bad.join(" / ") } : { host: s.host, ok: true, code: "checkup_ok" };
    } catch (e) { return { host: s.host, ok: false, code: "not_ready" }; }
  }));
}

// 汇总收集：逐站取最后一条 AI 回答的只读快照（不等流式完成——以点击时刻为准，ponytail 有意取舍）；
// 并行同 checkupAll，汇总耗时从各站之和降为最慢单站。
async function collectAll(sites, timeoutMs = 8000) {
  const wins = await getWindows();
  const deadline = Date.now() + timeoutMs;
  return Promise.all(sites.map(async (s) => {
    const tabs = await tabsForHost(s.host, wins);
    if (!tabs.length) return { host: s.host, code: "no_window" };
    try {
      const r = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "collectAnswer" }), deadline);
      if (r === MESSAGE_TIMEOUT) return { host: s.host, code: "not_ready" };
      return r && r.text ? { host: s.host, text: r.text, state: r.state } : { host: s.host, code: "no_answer" };
    } catch (e) { return { host: s.host, code: "not_ready" }; }
  }));
}

// tab 是否已停在该站"新会话入口"（origin+pathname 一致，忽略 query/hash 与尾斜杠）。
// 这 9 站的会话 id 都落在 path（/new→/chat/x、/→/c/x、/app→/app/x），故 path 一致≈空白新会话。
function isNewSessionUrl(tabUrl, newUrl) {
  try {
    const a = new URL(tabUrl), b = new URL(newUrl);
    if (a.origin !== b.origin) return false;
    const norm = (p) => p.replace(/\/+$/, "") || "/";
    return norm(a.pathname) === norm(b.pathname);
  } catch (e) { return false; }
}
// 全部新会话：把每个站点绑定窗口的 tab 导航到该站新会话 URL（无需各站适配新建按钮）；
// 已在新会话入口的窗口跳过重载（省闪烁，并保留用户未发送的输入）。
async function newSessionAll(sites) {
  await clearLastRun();
  const wins = await getWindows();
  for (const s of sites) {
    if (!s.url) continue;
    const tabs = await tabsForHost(s.host, wins);
    if (!tabs.length) continue;
    const tab = tabs[0];
    if (tab.url && isNewSessionUrl(tab.url, s.url)) continue;
    try { await chrome.tabs.update(tab.id, { url: s.url }); } catch (e) {}
  }
}
