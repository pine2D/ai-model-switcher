const elSites = document.getElementById("sites");
const elTier = document.getElementById("tier");
const elTierButtons = [...document.querySelectorAll("#tierbuttons [data-tier]")];
const elPrompt = document.getElementById("prompt");
let selected = {};
let pendingClear = Promise.resolve();
function clearPendingRun() {
  pendingClear = RunMeta.clearPending();
  pendingClear.catch(() => {});
}
// 细条历史与范围/档位控件拆在 console/library.js（本文件之前加载，classic script 共享全局）

function render() {
  // 快照重建前的运行时状态（send/open/done/fail + 原因 title），重建后恢复——群发中改分组不再抹掉进度
  const prev = {};
  elSites.querySelectorAll(".chip").forEach((c) => {
    const st = ["send", "open", "done", "fail"].find((x) => c.classList.contains(x));
    if (st) prev[c.dataset.host] = { st, title: c.title, aria: c.getAttribute("aria-label") };
  });
  elSites.replaceChildren();
  SITES.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selected[s.host] ? "" : " off");
    chip.hidden = !selected[s.host];
    chip.dataset.host = s.host;
    chip.dataset.label = s.label;
    chip.title = s.label + " · " + t("con_chipHint"); // 闲时教学、忙时报状态（setDot 会覆盖为原因）
    chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
    chip.setAttribute("aria-label", s.label); // setDot 会随状态更新（读屏拿不到 title）
    const d = document.createElement("span"); d.className = "d";
    chip.append(d, document.createTextNode(s.label));
    const p = prev[s.host]; if (p) { chip.classList.add(p.st); chip.title = p.title; chip.setAttribute("aria-label", p.aria || s.label); }
    chip.addEventListener("click", () => {
      const hadFocus = document.activeElement === chip;
      selected[s.host] = !selected[s.host];
      chip.classList.toggle("off", !selected[s.host]);
      chip.hidden = !selected[s.host];
      chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
      save();
      if (chip.hidden && hadFocus) document.getElementById("group").focus();
      if (typeof updateRetry === "function") { updateRetry(); updateFailSum(); }
    });
    elSites.appendChild(chip);
  });
  updateArrows(); // 芯片数量/宽度变化后重算溢出箭头
}
function chosen() { return SITES.filter((s) => selected[s.host]); }
elTierButtons.forEach((button) => button.addEventListener("click", () => setTierValue(button.dataset.tier)));
// 芯片区滚动条已隐藏（挤占 96px 细条布局）：滚轮横滚 + 按住拖动补滚动通道，两侧箭头指示溢出方向
function updateArrows() {
  const left = document.getElementById("sites-l");
  const right = document.getElementById("sites-r");
  const leftOn = elSites.scrollLeft > 2;
  const rightOn = elSites.scrollLeft + elSites.clientWidth < elSites.scrollWidth - 2;
  const chips = [...elSites.querySelectorAll(".chip:not([hidden])")];
  if (!leftOn && document.activeElement === left) (chips[0] || document.getElementById("group")).focus();
  if (!rightOn && document.activeElement === right) (chips.at(-1) || document.getElementById("group")).focus();
  left.classList.toggle("on", leftOn); left.disabled = !leftOn; left.setAttribute("aria-hidden", String(!leftOn));
  right.classList.toggle("on", rightOn); right.disabled = !rightOn; right.setAttribute("aria-hidden", String(!rightOn));
}
elSites.addEventListener("scroll", updateArrows, { passive: true });
// ResizeObserver 而非 window resize：命名输入/确认条展开会挤压 #sites 但不触发窗口 resize，
// 旧监听下芯片被裁一半却不出溢出箭头
new ResizeObserver(updateArrows).observe(elSites);
// #bar 滚动条已隐藏（96px 细条里系统滚动条吃视觉空间），滚轮横滚补上鼠标通道（对抗审查 F3）：
// 窄屏下右端按钮溢出视口时，鼠标用户靠滚轮可达；芯片区上的滚轮已被 #sites 接管（defaultPrevented）
document.getElementById("bar").addEventListener("wheel", (e) => {
  if (e.defaultPrevented || !e.deltaY || e.deltaX) return;
  const bar = e.currentTarget;
  if (bar.scrollWidth > bar.clientWidth) { bar.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
document.getElementById("sites-l").addEventListener("click", () => elSites.scrollBy({ left: -120 }));
document.getElementById("sites-r").addEventListener("click", () => elSites.scrollBy({ left: 120 }));
elSites.addEventListener("wheel", (e) => {
  if (!e.deltaY || e.deltaX) return; // 触控板横扫走原生
  elSites.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
let dragX = null, dragL = 0, dragged = false; // 按住拖动；4px 阈值内视为点选、不进入拖动
elSites.addEventListener("pointerdown", (e) => { dragX = e.clientX; dragL = elSites.scrollLeft; dragged = false; });
elSites.addEventListener("pointermove", (e) => {
  if (dragX == null) return;
  if (!dragged && Math.abs(e.clientX - dragX) > 4) { dragged = true; elSites.setPointerCapture(e.pointerId); }
  if (dragged) elSites.scrollLeft = dragL - (e.clientX - dragX);
});
elSites.addEventListener("pointerup", () => { dragX = null; });
elSites.addEventListener("pointercancel", () => { dragX = null; });
elSites.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true); // 拖动收尾的 click 不算点选

// 群发进度/结果状态（setDot/applyResults/errText/progress/lastSend/失败汇总）拆在 console/status.js（本文件之后加载）
function save() {
  chrome.storage.local.set({ amsConsole: { selected, tier: elTier.value }, amsConsolePrompt: elPrompt.value });
  if (typeof syncGroupSelect === "function") syncGroupSelect();
}
function loadHistory() {
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyPage", cursor: null, limit: 20 }, (res) => {
    void chrome.runtime.lastError;
    if (!res || !res.ok || !Array.isArray(res.items)) return;
    history = res.items.map((item) => item.text || item.preview).filter(Boolean);
  });
}
function load() {
  // 所需 key 单次 get：冷启动少一轮 storage IPC 往返
  chrome.storage.local.get(["amsConsole", "amsConsolePrompt", "amsConsolePrefill"], (o) => {
    const c = (o && o.amsConsole) || {};
    const savedSelection = c.selected || {};
    const firstSelection = !Object.keys(savedSelection).length;
    const pre = o && o.amsConsolePrefill; // popup「打开控制台」带来的当前站（一次性消费）
    if (pre) chrome.storage.local.remove("amsConsolePrefill");
    selected = resolveSiteSelection(savedSelection, pre);
    if (c.tier) elTier.value = c.tier;
    syncTierButtons();
    const prompt = o.amsConsolePrompt != null ? o.amsConsolePrompt : c.prompt;
    if (prompt) elPrompt.value = prompt;
    if (o.amsConsolePrompt == null && c.prompt != null) chrome.storage.local.set({ amsConsolePrompt: c.prompt }); // 旧结构一次性迁移
    loadHistory();
    render();
    if (firstSelection) save(); // 范围伴侣窗从 storage 读取；首次默认选择也必须落盘
    syncGroupSelect();
  });
}
// 排队操作忙碌态：openTile/closeAll/newSession/sendAll 在 bg 走 serializeOp 严格排队，群发中点这些
// 按钮最长要等 ~22s 才真正执行——零反馈像卡死。禁用到回调返回，兜底定时器防回调丢失永久禁用。
function busy(btn, ms) {
  const reset = () => { btn.disabled = false; };
  btn.disabled = true;
  const timer = setTimeout(reset, ms || 30000);
  return () => { clearTimeout(timer); reset(); };
}
document.getElementById("tile").addEventListener("click", (e) => {
  const sites = chosen(); if (!sites.length) return;
  ignoreResults = false; // 用户新动作：解除 closeAll 后的结果忽略态
  const free = busy(e.currentTarget);
  // Task 7: 改用 state "send"
  sites.forEach((s) => setDot(s.host, "send", t("con_winOpening")));
  armDotTimeouts(sites.map((s) => s.host)); // 回调断掉时"开窗中"不永久挂起
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openTile", sites }, (resp) => { free(); applyResults(resp && resp.results); });
});
function markInvalid(el) { el.setAttribute("aria-invalid", "true"); el.focus(); }
document.getElementById("send").addEventListener("click", async () => {
  if (elSend.disabled) return;                       // in-flight 防双发/双 Enter
  const sites = chosen(); if (!sites.length) { markInvalid(document.getElementById("group")); return; }
  const text = elPrompt.value.trim(); if (!text) { markInvalid(elPrompt); return; }
  elSend.disabled = true;
  const sentImages = pendingImages;
  let images = [];
  try { if (sentImages.length) images = await imagePayloads(sentImages); }
  catch (e) { elSend.disabled = false; flashNote(t("con_imageRead")); return; }
  let run;
  try { await pendingClear; run = await RunMeta.resolve(text); }
  catch (error) { elSend.disabled = false; flashNote(t("con_failed")); return; }
  pushHistory(text);
  lastSend = { text, ...run, tier: elTier.value || null, hasImage: images.length > 0, images };
  const reEnableTimer = setTimeout(() => { elSend.disabled = false; }, images.length ? 95000 : 48000);
  sites.forEach((s) => setDot(s.host, "send", t("con_sendingTile")));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text, tier: elTier.value || null, images, run }, (resp) => {
    clearTimeout(reEnableTimer); elSend.disabled = false; applyResults(resp && resp.results);
  });
  if (pendingImages === sentImages) setPendingImages([], false);
});
document.getElementById("collect").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  const fallback = elPrompt.value.trim();
  const collect = (run, snapshot, checked) => {
    const matches = typeof run?.runId === "string" && Array.isArray(run.hosts) && sites.every((site) => run.hosts.includes(site.host));
    const message = { source: "AMS_CONSOLE", action: "collect", sites };
    if (typeof run?.runId === "string") message.runId = run.runId;
    else if (checked) message.runId = null;
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError || resp?.code || !Array.isArray(resp?.results)) { flashNote(t("con_collectFail")); return; }
      Promise.resolve(matches ? snapshot : null).then((archive) => copySummary(sites, resp.results, matches ? run.text : fallback, archive));
    });
  };
  const run = lastSend?.runId && { ...lastSend };
  if (run) { collect(run, archiveRun(run)); return; }
  archiveRun(null).then((restored) => collect(restored, restored, true));
});
document.getElementById("archive").addEventListener("click", () => {
  // 受管归档窗（与伴侣窗同款）：幂等打开、随 console 联动最小化/抬前、closeAll 一起关
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openArchive" });
});
document.getElementById("newsession").addEventListener("click", (e) => {
  const sites = chosen(); if (!sites.length) return;
  const free = busy(e.currentTarget);
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "newSession", sites }, () => { void chrome.runtime.lastError; free(); });
});
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.isComposing) return;
  const el = document.getElementById({ KeyC: "collect", KeyL: "tile", KeyN: "newsession", KeyP: "prompt", KeyR: "retry" }[e.code]);
  if (!el) return;
  e.preventDefault(); el === elPrompt ? el.focus() : el.click();
});
document.getElementById("closeall").addEventListener("click", (e) => {
  const free = busy(e.currentTarget);
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "closeAll" }, () => { void chrome.runtime.lastError; free(); });
  clearRunState(); // 在途群发的迟到结果不得复活刚清空的芯片（下一次 sendStart/tile/checkup 解除）
});
elTier.addEventListener("change", () => { syncTierButtons(); save(); });
elPrompt.addEventListener("input", () => {
  clearPendingRun();
  elPrompt.removeAttribute("aria-invalid");
  histCursor = -1; elPrompt.title = ""; // 编辑历史条目即成为新草稿，清位置指示
  chrome.storage.local.set({ amsConsolePrompt: elPrompt.value });
});

// Enter 发送 + ↑↓ 历史（鼠标历史入口在独立编辑窗）
elPrompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && !e.shiftKey) { // 输入法合成中不误发
    e.preventDefault(); document.getElementById("send").click(); return;
  }
  if (e.key === "ArrowUp" && !e.isComposing && history.length) { // IME 方向键选词不劫持
    e.preventDefault();
    if (histCursor === -1) histDraft = elPrompt.value; // 进浏览前先存草稿，↓ 回来可还原
    histCursor = Math.min(histCursor + 1, history.length - 1); clearPendingRun();
    elPrompt.value = history[histCursor]; // 浏览期间不落盘：storage 里始终是草稿，误关窗也不丢
    elPrompt.title = t("con_histPos", histCursor + 1, history.length); // 位置指示（悬停可见）
  } else if (e.key === "ArrowDown" && !e.isComposing) {
    if (histCursor === -1) return; // 未在浏览历史 → 不动用户草稿
    e.preventDefault();
    if (histCursor === 0) { histCursor = -1; clearPendingRun(); elPrompt.value = histDraft; elPrompt.title = ""; }
    else { histCursor -= 1; clearPendingRun(); elPrompt.value = history[histCursor]; elPrompt.title = t("con_histPos", histCursor + 1, history.length); }
  }
});

document.getElementById("compose").addEventListener("click", () => {
  // 上报输入框的视口内位置/宽度，让伴侣窗贴着它展开（制造"输入框展开"的错觉）
  const r = elPrompt.getBoundingClientRect();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openCompose", anchor: { left: r.left, width: r.width } });
});
document.getElementById("retry").addEventListener("click", (e) => {
  if (!lastSend || (lastSend.hasImage && !lastSend.images)) return;
  const sel = new Set(chosen().map((s) => s.host));   // 只重发"仍勾选且失败"的站
  const failHosts = [...document.querySelectorAll(".chip.fail")].map((c) => c.dataset.host).filter((h) => sel.has(h));
  const sites = SITES.filter((s) => failHosts.includes(s.host));
  if (!sites.length) return;
  const free = busy(e.currentTarget);
  const run = { runId: lastSend.runId, hosts: lastSend.hosts, task: lastSend.task, source: lastSend.source, tier: lastSend.tier, sentAt: lastSend.sentAt };
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text: lastSend.text, tier: lastSend.tier, images: lastSend.images || [], tile: false, run }, (resp) => { free(); applyResults(resp && resp.results); });
});

// 伴侣窗编辑 → 经 storage 回填细条输入框（本框未编辑时才更新，防回环）
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.amsConsole && ch.amsConsole.newValue) {
    const c = ch.amsConsole.newValue; selected = c.selected || {};
    if (c.tier != null) elTier.value = c.tier;
    syncTierButtons(); render(); syncGroupSelect();
  }
  if (!ch.amsConsolePrompt) return;
  const p = ch.amsConsolePrompt.newValue;
  // "编辑中"须同时窗口持焦：窗口失焦后 activeElement 不重置，单看它会永久挡住回填
  if (p != null && p !== elPrompt.value && !(document.hasFocus() && document.activeElement === elPrompt)) { elPrompt.value = p; }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === "AMS_DATA" && msg.type === "historyChanged") loadHistory();
});

load();
document.addEventListener("i18n:changed", () => { syncGroupSelect(); updateSendLabel(); });
applyI18n();

// 可靠抬窗触发：chrome.windows.onFocusChanged 在部分 Windows 环境下不触发、也不唤醒休眠的 SW（实测
// 「从非 Chrome 窗口点回 console，平铺窗不跟随」即此因——该事件压根没派发）。改用 console 页面自身的
// DOM focus 事件：只要 console 窗口被点到前台，渲染进程必触发，且 sendMessage 必唤醒 SW，比 onFocusChanged 可靠。
window.addEventListener("focus", () => {
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "consoleFocused" }, () => void chrome.runtime.lastError);
});
// 最小化联动同样改用可靠页面事件：console 窗口被最小化 → document.hidden=true → 通知后台联动最小化
// 平铺窗（后台再校验 window state 区分「最小化 vs 被完全遮挡」）。还原/抬前由上面的 focus 监听覆盖。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "consoleHidden" }, () => void chrome.runtime.lastError);
});
