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

// prune=false（sendAll 隐式开窗）：只为缺窗站开窗落格，不关未勾选站、不重排已有窗口的
// 用户手调布局（追问少数站时不得动别人正摆着答案的窗）；显式「平铺」按钮保持全量重排语义。
async function openTile(sites, prune = true) {
  const wa = await consoleWorkArea(); // console 拖到哪个显示器就铺哪个显示器

  const reserve = await consoleReserveHeight(wa);
  const areaLeft = wa.left, areaTop = wa.top + reserve, areaW = wa.width;
  const areaH = Math.max(120, wa.height - reserve); // 夹下界：console 被拖低/小屏时 reserve≈全高 → 防负高度建窗
  const n = sites.length || 1;
  // n≤4：单排等分并排（水平二/三/四等分，各占满高度）；n≥5：方形网格
  let cols, rows;
  if (n <= 4) { cols = n; rows = 1; }
  else { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
  const cellW = Math.floor(areaW / cols), cellH = Math.floor(areaH / rows);
  const wins = await getWindows();
  const selectedHosts = sites.map((s) => s.host);
  // 1) 处理已取消勾选（仅显式平铺）：owned 的真正关闭，复用的仅解除登记（用户窗口不动）
  if (prune) for (const host of Object.keys(wins)) {
    if (!selectedHosts.includes(host)) {
      if (wins[host].owned) { await removeIfPopup(wins[host].id); }
      delete wins[host];
    }
  }
  // 2) 处理选中站点：优先复用受管 popup → 新建 popup，逐个定位（popup-only 铁律）
  const out = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const col = i % cols, row = Math.floor(i / cols);
    const bounds = { left: areaLeft + col * cellW, top: areaTop + row * cellH, width: cellW, height: cellH };
    let windowId = await popupWindowForHost(s.host, wins);
    let reused = false, owned = false;
    if (windowId != null) {
      reused = true;
      const rec = wins[s.host];
      owned = !!(rec && rec.id === windowId && rec.owned); // 仅沿用「同一登记窗口」的归属
      if (prune) { try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {} } // 隐式开窗不重排既有窗
    } else {
      // 新建窗口始终从该站的新会话入口开始；只有已存在的受管 popup 才延续当前对话。
      try { const w = await chrome.windows.create(Object.assign({ url: s.url, type: "popup", focused: false }, bounds)); windowId = w.id; owned = true; } catch (e) {}
    }
    if (windowId != null) wins[s.host] = { id: windowId, owned };
    out.push({ host: s.host, windowId, reused, opened: !reused && windowId != null });
  }
  await setWindows(wins);
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
  if (epoch !== currentSendEpoch()) return sites.map((s) => ({ host: s.host, ok: false, code: "cancelled" }));
  const now = Date.now();
  const runId = run.runId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : now.toString(36) + Math.random().toString(36).slice(2));
  const runMeta = { runId, text, task: typeof run.task === "string" ? run.task : String(text), source: run.source || null,
    hosts: Array.isArray(run.hosts) ? run.hosts : sites.map((site) => site.host), tier: run.tier || tier || null, sentAt: run.sentAt || now };
  await chrome.storage.session.set({ amsLastRun: runMeta });
  const wins = await getWindows();
  let anyMissing = false;
  for (const s of sites) { if ((await popupWindowForHost(s.host, wins)) == null) { anyMissing = true; break; } }
  if (tile && anyMissing) await openTile(sites, false); // 隐式开窗不 prune/不重排；retry 传 tile=false 连开窗也免
  if (epoch !== currentSendEpoch()) return sites.map((s) => ({ host: s.host, ok: false, code: "cancelled" }));
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

// 轮询直到该站页面就绪并提交：已开窗口首轮即命中；新开窗口需加载+content 注入+composer 出现，
// 故 content 未注入 / composer_not_found 都视为"还没好"继续等，其它 ok=false 才是真失败。
// 失败原因走错误码协议（code），由 console 端按界面语言翻译——bg/content 不产出用户可见文案。
// 任一出口都先 pushSiteResult 让该站圆点立刻变色，再返回参与 Promise.all 汇总。
async function submitWhenReady(s, text, tier, timeoutMs = 22000, gap = 800, epoch = currentSendEpoch(), images = [], notify = true) {
  const t0 = Date.now();
  const firstDeadline = t0 + timeoutMs, deadline = t0 + timeoutMs * 2;
  let retried = false; // 慢加载站首开超过 22s 后继续等到绝对截止线 44s
  const done = (ok, code, reason) => {
    const res = { host: s.host, ok, code, reason, ms: Date.now() - t0 }; // ms：逐站耗时，console 拼进 title 服务速度对比
    if (retried) res.retried = true;
    if (notify) pushSiteResult(res); return res;
  };
  const wins = await getWindows(); // openTile 已在 Promise.all 前定稿登记表，轮询期不变，读一次即可
  for (;;) {
    if (epoch !== currentSendEpoch()) return done(false, "cancelled");
    if (Date.now() >= deadline) return done(false, "timeout");
    if (!retried && Date.now() >= firstDeadline) retried = true;
    const tabs = await tabsForHost(s.host, wins);
    if (tabs.length) {
      let ready = false;
      try {
        const probe = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "getState" }), deadline);
        if (probe === MESSAGE_TIMEOUT) return done(false, "timeout");
        ready = !!probe && Object.prototype.hasOwnProperty.call(probe, "state");
      } catch (e) { /* content 尚未注入，继续等 */ }
      if (ready) {
        if (epoch !== currentSendEpoch()) return done(false, "cancelled");
        if (Date.now() >= deadline) return done(false, "timeout");
        let r;
        try {
          r = await messageBefore(() => chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "submitPrompt", text, tier, deadline, images }), deadline);
        } catch (e) { return done(false, "submit_unconfirmed"); } // 已派发后绝不自动重发，避免端口断开造成重复提问
        if (r === MESSAGE_TIMEOUT) return done(false, "submit_unconfirmed");
        if (!r || typeof r.ok !== "boolean") return done(false, "submit_unconfirmed");
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
