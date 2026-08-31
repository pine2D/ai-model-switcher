// console/status.js — 群发进度/结果状态：圆点状态机、错误码翻译、失败汇总、无障碍播报。
// 在 console.js 之后加载，共享其全局（SITES/t/save 等）；progress/lastSend 声明于此，console.js 的事件处理器读写。

// 状态写到芯片：idle 清空 send/open/done/fail；title 拼「站名 · 原因」（悬停提示）。
// aria-label 同步状态：title 对读屏/触屏不可靠，可访问名须自带状态信息。
// F107：芯片文案不缓存已翻译的成品串，只记"生成方式"（kind/payload，未翻译的原始数据）——语言切换后
// 可按当前语言重算，不把旧语言译文原样抄回。chipMeta 无条目 = idle，统一回退 con_chipHint。
const chipMeta = new Map(); // host -> {kind, payload}
function labelChip(chip, reason) {
  chip.title = reason ? chip.dataset.label + " · " + reason : chip.dataset.label + " · " + t("con_chipHint");
  chip.setAttribute("aria-label", reason ? chip.dataset.label + " · " + reason : chip.dataset.label);
}
function chipReason(kind, payload) {
  if (kind === "hint") return t(payload); // payload = i18n key（如 con_sendingDot/con_winOpening）
  if (kind === "send") {
    // sendAll 提交结果；ok+code（如 tier_unconfirmed）= 绿点带警示 title。
    // 耗时（ms）与自动重试标记拼进提示：直接服务"对比各家响应速度"的核心场景
    const parts = [payload.ok ? (ERR_KEYS[payload.code] ? t(ERR_KEYS[payload.code]) : "") : errText(payload)];
    if (payload.retried) parts.push(t("con_autoRetried"));
    if (payload.ms != null) parts.push((payload.ms / 1000).toFixed(1) + "s");
    return parts.filter(Boolean).join(" · ");
  }
  // kind === "open"：openTile 结果，区分「已回答」的实心绿勾与「已打开」的空心绿圈——平铺后满屏绿勾曾被误读为已回复
  return payload.reused ? t("con_reused") : payload.opened ? t("con_opened") : t("con_failed");
}
function setDot(host, state, reason, meta) {
  const chip = document.querySelector('.chip[data-host="' + host + '"]');
  if (!chip) return;
  chip.classList.remove("send", "open", "done", "fail");
  if (state && state !== "idle") chip.classList.add(state);
  labelChip(chip, reason);
  if (state !== "send") clearDotTimeout(host);
  if (state && state !== "idle" && meta) chipMeta.set(host, meta); else chipMeta.delete(host);
}

// 错误码 → 当前语言文案（bg/content 只传 code，避免硬编码中文泄漏到 en/zh_TW 界面）
const ERR_KEYS = { timeout: "con_errTimeout", composer_not_found: "con_errNoComposer", inject_failed: "con_errInject", submit_unconfirmed: "con_errSubmit", tier_unconfirmed: "con_errTier",
  image_invalid: "con_errImageInvalid", attachment_unsupported: "con_errAttachmentUnsupported", attachment_failed: "con_errAttachmentFailed", attachment_timeout: "con_errAttachmentTimeout", attachment_action_required: "con_errAttachmentAction",
  no_window: "con_errNoWindow", not_ready: "con_errNotReady", cancelled: "con_errCancelled", checkup_ok: "con_checkupOk", no_answer: "con_errNoAnswer", error: "con_errGeneric" };
// error 码 = 意外异常兜底：主文案用词条（不让英文异常原文裸露在 zh 界面），原始 reason 附在后面供排障
function errText(r) {
  const base = ERR_KEYS[r.code] && t(ERR_KEYS[r.code]);
  if (base) return r.code === "error" && r.reason ? base + " · " + r.reason : base;
  return r.reason || t("con_failed");
}
// closeAll 乐观清零后，在途群发的迟到 siteResult/回调会把刚清空的芯片重新点亮——
// 进入忽略态直到用户下一次动作（sendStart 推送或 tile/checkup 点击）解除
let ignoreResults = false;
// F116：结果落地后统一刷新失败汇总/重试可用性——此前只有 siteResult 分支自己调，tile/retry 的回调
// 不刷新，会留下悬空的失败横幅或点了 0 条的重试按钮。F119：平铺批次额外播报一次开窗结果，覆盖
// sendStart/siteResult 完成播报之外、tile 单独触发的这条动作路径（放在 updateFailSum 之后，故意覆盖它）。
function applyResults(results) {
  if (ignoreResults) return;
  let opened = 0, failed = 0, isTile = false;
  (results || []).forEach((r) => {
    if (typeof r.ok === "boolean") {
      setDot(r.host, r.ok ? "done" : "fail", chipReason("send", r), { kind: "send", payload: r });
    } else {
      isTile = true;
      const okWin = r.windowId != null;
      if (okWin) opened++; else failed++;
      setDot(r.host, okWin ? "open" : "fail", chipReason("open", r), { kind: "open", payload: r });
    }
  });
  // F023：epoch 取消早退时 bg 从未推 sendStart，progress.total 恒为 0，updateFailSum 的 finished
  // 判定永假，芯片会翻红却全程不进 #live、不出失败汇总。只在“sendAll 全批 ok===false 且从未记过账”
  // 时补一次账，不影响 openTile（无 ok 字段）与正常 sendStart 已推送过的路径。
  if (!progress.total && results?.length && results.every((r) => r.ok === false)) progress = { total: results.length, done: results.length };
  updateRetry(); updateFailSum();
  if (isTile && Date.now() >= noteUntil) document.getElementById("live").textContent = t("con_liveTileDone", opened, failed);
}

// 逐站实时回填：sendAll 期间每站一完成，background 即推单站结果，立刻更新该站圆点（不等全部）
let progress = { total: 0, done: 0 };
let lastSend = null; // {text, task, source, tier, hasImage, images}
const elSend = document.getElementById("send");
let dispatchTimer = null;
function applyDispatchLock(until) {
  clearTimeout(dispatchTimer); dispatchTimer = null;
  const left = Number(until) - Date.now();
  if (left > 0) { elSend.disabled = true; dispatchTimer = setTimeout(() => applyDispatchLock(0), left); }
  else if (!(progress.total && progress.done < progress.total)) elSend.disabled = false;
}
chrome.storage.session.get("amsComposeDispatchUntil", (value) => {
  if (!chrome.runtime.lastError) applyDispatchLock(value?.amsComposeDispatchUntil);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.amsComposeDispatchUntil) applyDispatchLock(changes.amsComposeDispatchUntil.newValue);
});
function updateSendLabel() {
  elSend.textContent = (progress.total && progress.done < progress.total) ? t("con_sending", progress.done, progress.total) : t("con_sendAll");
}
function updateRetry() {
  const hasFail = [...document.querySelectorAll(".chip.fail")].some((c) => selected[c.dataset.host]);
  const retryable = lastSend && (!lastSend.hasImage || lastSend.images);
  document.getElementById("retry").disabled = !(hasFail && retryable);
}
// 短暂内联提示（借 failsum 位；中性色，3s 后交还失败汇总）+ 读屏播报
let noteUntil = 0; // 展示期内挡住并发 siteResult/sendStart 触发的 updateFailSum 覆盖
function flashNote(text) {
  const el = document.getElementById("failsum");
  el.textContent = text; el.style.display = ""; el.style.color = "var(--text-2)";
  document.getElementById("live").textContent = text;
  noteUntil = Date.now() + 3000;
  setTimeout(() => { noteUntil = 0; updateFailSum(); }, 3000);
}
// 汇总拼装（复制与导出共用）：各站标注当时档位；未适配/未获取的站如实标出。
// miss = 无回答的站数：提示里如实标注，别让用户把错误占位贴给别人而不自知。
function buildSummary(sites, results, question) {
  const byHost = {}; results.forEach((r) => { byHost[r.host] = r; });
  const q = question || "";
  const md = ["# " + t("con_mdHeader") + " · " + new Date().toLocaleString(document.documentElement.lang || undefined)];
  if (q) md.push("\n**" + t("con_mdQuestion") + "**: " + q);
  let miss = 0;
  for (const s of sites) {
    const r = byHost[s.host] || { code: "not_ready" };
    if (!r.text) miss++;
    const tier = r.state === "think" ? " · " + t("con_mdThink") : r.state === "fast" ? " · " + t("con_mdFast") : "";
    md.push("\n## " + s.label + tier + "\n", r.text ? r.text : "> " + errText(r));
  }
  return { md: md.join("\n"), miss, q };
}
// 归档快照：用户点汇总/导出的时刻就是"对比现场定格"的时刻，顺带归档——
// "上次这个问题各家怎么答"从此可回看（console/archive.html）。
function freezeRun(run) {
  return run?.runId && { ...run, hosts: Array.isArray(run.hosts) ? [...run.hosts] : run.hosts, source: run.source && { ...run.source } };
}
function readRun() {
  return new Promise((resolve) => chrome.storage.session.get("amsLastRun", (session) => {
    resolve(chrome.runtime.lastError ? null : freezeRun(session?.amsLastRun));
  }));
}
function archiveRun(run) {
  const clicked = freezeRun(run);
  return readRun().then((last) => clicked ? last?.runId === clicked.runId ? last : clicked : last);
}
function archiveSummary(sites, results, q, run) {
  const byHost = {}; results.forEach((r) => { byHost[r.host] = r; });
  const meta = run || {};
  const entry = {
    ts: Date.now(), text: meta.text || q || "", task: typeof meta.task === "string" ? meta.task : q || "", source: meta.source || null,
    results: sites.map((s) => { const r = byHost[s.host] || {}; return { host: s.host, label: s.label, text: r.text || null, state: r.state || null, code: r.code || null }; }),
  };
  return new Promise((resolve) => chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveAdd", entry }, (result) => resolve(!chrome.runtime.lastError && !!result?.ok)));
}
function copySummary(sites, results, question, run) {
  const { md, miss, q } = buildSummary(sites, results, question);
  Promise.all([navigator.clipboard.writeText(md), archiveSummary(sites, results, q, run)]).then(
    ([, archived]) => flashNote(archived ? (miss ? t("con_collectDonePart", sites.length, miss) : t("con_collectDone", sites.length)) : t("con_collectDoneUnarchived")),
    () => flashNote(t("con_collectFail"))
  );
}
// 全部结果回齐后在细条内联显示失败汇总（薄弹窗限制下不用浮层），并经 aria-live 播报给读屏
function updateFailSum() {
  if (Date.now() < noteUntil) return; // flashNote 展示期内不覆盖
  const el = document.getElementById("failsum");
  el.style.color = ""; // 复位 flashNote 的中性色
  const fails = [...document.querySelectorAll(".chip.fail")].filter((c) => selected[c.dataset.host]);
  const finished = !!progress.total && progress.done >= progress.total;
  if (!fails.length || !finished) {
    el.style.display = "none"; el.textContent = "";
    if (finished && !fails.length) document.getElementById("live").textContent = t("con_allDone", progress.total); // 全绿也要给读屏一个完成信号
    return;
  }
  el.textContent = t("con_failSum", fails.length, fails.map((c) => c.dataset.label).join(" "));
  el.title = fails.map((c) => c.title).join("\n"); // 悬停看逐站原因全文
  el.style.display = "";
  document.getElementById("live").textContent = el.textContent;
}
// 芯片状态的客户端兜底：回调/推送断掉（SW 被杀、扩展重载）时圆点会永久卡"发送中"，
// 到点仍是 send 态就地翻超时失败。纯文字兜底 60s（后台绝对线 44s，≥20% 余量）；带图兜底
// 110s（95000+15000：后台绝对线 90s，历史基线 95000 只有约 5.5% 余量，补到约 22%——F019）。
// F012：只记到期时间、不缩短已武装的剩余时间——重新布防（如 tile 的"开窗中"）不得把 send 阶段
// 已经在倒计时的更长等待抢短；到期时间更晚的重新布防仍会正常替换（如 sendStart 覆盖点击时的布防）。
const dotTimers = new Map(); // host -> {timer, until}
function clearDotTimeout(host) {
  const entry = dotTimers.get(host);
  if (entry) clearTimeout(entry.timer);
  dotTimers.delete(host);
}
function clearDotTimeouts() { [...dotTimers.keys()].forEach(clearDotTimeout); }
function armDotTimeouts(hosts, ms) {
  const until = Date.now() + (ms || 60000);
  hosts.forEach((h) => {
    const existing = dotTimers.get(h);
    if (existing && existing.until >= until) return; // 已有更晚的到期时间，不缩短剩余（F012）
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      dotTimers.delete(h);
      const chip = document.querySelector('.chip[data-host="' + h + '"]');
      if (!chip || !chip.classList.contains("send")) return;
      setDot(h, "fail", t("con_errTimeout"), { kind: "hint", payload: "con_errTimeout" });
      if (progress.total && progress.done < progress.total) { progress.done++; updateSendLabel(); }
      if (progress.total && progress.done >= progress.total) elSend.disabled = false;
      updateRetry(); updateFailSum();
    }, Math.max(0, until - Date.now()));
    dotTimers.set(h, { timer, until });
  });
}
// F119：#live 是群发进度的唯一无障碍通道，但逐站 siteResult 密集到达时不宜一站一播——节流到最近一次
// 静默 400ms 后播报，且到点复核仍未完成才写，避免滞后触发时盖过 updateFailSum 已经写下的完成播报。
let liveProgressTimer = null;
function announceProgress() {
  clearTimeout(liveProgressTimer);
  liveProgressTimer = setTimeout(() => {
    liveProgressTimer = null;
    if (!progress.total || progress.done >= progress.total || Date.now() < noteUntil) return;
    document.getElementById("live").textContent = t("con_liveProgress", progress.done, progress.total);
  }, 400);
}
function clearRunState() {
  ignoreResults = true; clearDotTimeouts(); chipMeta.clear();
  clearTimeout(liveProgressTimer); liveProgressTimer = null; // 上一轮排队中的节流播报不得叫醒已清空的一轮
  [...document.querySelectorAll(".chip")].forEach((chip) => {
    chip.classList.remove("send", "open", "done", "fail"); chip.title = chip.dataset.label + " · " + t("con_chipHint"); chip.setAttribute("aria-label", chip.dataset.label);
  });
  lastSend = null; progress = { total: 0, done: 0 }; elSend.disabled = false; updateSendLabel(); updateRetry(); updateFailSum();
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.from === "AMS_COMPOSE" && msg.type === "historySaveFailed") { flashNote(t("con_historySaveFailed")); return; }
  if (!msg || msg.from !== "AMS_BG") return;
  if (msg.type === "sendStart") {
    ignoreResults = false; // 新一轮群发开始，恢复接收结果
    clearTimeout(liveProgressTimer); liveProgressTimer = null; // 上一轮的节流播报不得盖过新一轮的开场播报
    const run = msg.run || { text: msg.text, task: typeof msg.task === "string" ? msg.task : msg.text, source: msg.source || null, tier: msg.tier || null, hosts: msg.hosts };
    const images = msg.hasImage && lastSend && (lastSend.runId === run.runId || !lastSend.runId && lastSend.text === run.text) ? lastSend.images : null;
    if (run.text) lastSend = { ...run, hasImage: !!msg.hasImage, images };
    progress = { total: msg.hosts.length, done: 0 };
    clearTimeout(dispatchTimer); dispatchTimer = null; elSend.disabled = true;
    chrome.storage.session.remove?.("amsComposeDispatchUntil", () => void chrome.runtime.lastError);
    msg.hosts.forEach((h) => setDot(h, "send", t("con_sendingDot"), { kind: "hint", payload: "con_sendingDot" }));
    armDotTimeouts(msg.hosts, msg.hasImage ? 95000 + 15000 : undefined);
    updateSendLabel(); updateRetry(); updateFailSum();
    document.getElementById("live").textContent = t("con_liveSendStart", msg.hosts.length); // F119：开场播报
  } else if (msg.type === "runCleared") {
    clearRunState();
  } else if (msg.type === "siteResult" && msg.result) {
    if (ignoreResults) return; // closeAll 后的迟到结果不复活芯片
    progress.done++;
    if (progress.done >= progress.total) elSend.disabled = false;
    updateSendLabel();
    applyResults([msg.result]); // 内部已统一刷新 retry/failsum（F116）
    if (progress.done < progress.total) announceProgress(); // 逐站进度节流播报；完成播报已在 updateFailSum 里
  }
});
document.addEventListener("i18n:changed", () => { // F107：按当前语言重算 JS 拼装的文案，不把旧语言译文抄回
  [...document.querySelectorAll(".chip")].forEach((chip) => {
    const meta = chipMeta.get(chip.dataset.host);
    labelChip(chip, meta && chipReason(meta.kind, meta.payload));
  });
  updateFailSum();
  setPendingImages(pendingImages, false); // images.js 先加载，pendingImages/setPendingImages 已在全局可用
});
