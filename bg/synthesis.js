// bg/synthesis.js — 在一个受管 popup 的新会话中发送辅助综合载荷。

// 九站白名单：service worker 不加载 console/sites.js（那是页面脚本），故与其 host+url 手抄同源；
// 新增站点时也要在这里补一条（见 CLAUDE.md「加站点」清单），否则辅助综合发不到新站会静默报
// invalid_request。此前 validSynthesisRequest 只做自洽性检查（host 与 url.hostname 互相匹配即过），
// {host:"evil.example", url:"https://evil.example/"} 这类自洽但不属于九站的请求会被放行——F230。
const SYNTHESIS_ALLOWED_SITES = [
  { host: "claude.ai", url: "https://claude.ai/new" },
  { host: "chatgpt.com", url: "https://chatgpt.com/" },
  { host: "gemini.google.com", url: "https://gemini.google.com/app" },
  { host: "chat.deepseek.com", url: "https://chat.deepseek.com/" },
  { host: "www.doubao.com", url: "https://www.doubao.com/chat/" },
  { host: "www.qianwen.com", url: "https://www.qianwen.com/" },
  { host: "www.kimi.com", url: "https://www.kimi.com/" },
  { host: "yuanbao.tencent.com", url: "https://yuanbao.tencent.com/chat/" },
  { host: "chatglm.cn", url: "https://chatglm.cn/main/alltoolsdetail" },
];
function validSynthesisRequest(msg = {}) {
  const site = msg.site || {};
  if (typeof site.host !== "string" || typeof site.url !== "string" || !String(msg.text || "").trim() || ![null, "think", "fast"].includes(msg.tier ?? null)) return false;
  if (!SYNTHESIS_ALLOWED_SITES.some((s) => s.host === site.host && s.url === site.url)) return false;
  try { const url = new URL(site.url); return url.protocol === "https:" && url.hostname === site.host; } catch (_) { return false; }
}
async function waitForNewSession(tabId, url, timeoutMs = 22000, epoch = currentSendEpoch()) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (epoch !== currentSendEpoch()) return false; // 取消：立即让位，不空耗到超时（F017/F034）
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === "complete" && isNewSessionUrl(tab.url, url)) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
// 辅助综合只为缺窗站点补一扇窗，绝不能复用 openTile 的平铺网格几何：那套按 sites.length 现算，
// 单站请求 n=1 时 cols=rows=1，算出的 bounds 就是整块平铺区，新窗会吃满全屏盖住其余已平铺窗口
// （F014）。改走独立的居中中等尺寸；仍登记进 amsWindows 让 closeAll/联动照常生效；已有受管窗口
// 原样复用、不改其几何（与 openTile 在 prune=false 下对既有窗口的处理一致）。
async function openSynthesisWindow(site) {
  const wins = await getWindows();
  const existing = await popupWindowForHost(site.host, wins);
  if (existing != null) return { windowId: existing, opened: false };
  const wa = await consoleWorkArea();
  const reserve = await consoleReserveHeight(wa);
  const areaTop = wa.top + reserve, areaH = Math.max(120, wa.height - reserve);
  const width = Math.min(900, wa.width - 40), height = Math.min(700, areaH - 40);
  const left = wa.left + Math.max(0, Math.floor((wa.width - width) / 2));
  const top = areaTop + Math.max(0, Math.floor((areaH - height) / 3));
  let windowId = null;
  try {
    const w = await chrome.windows.create({ url: site.url, type: "popup", left, top, width, height, focused: false });
    windowId = w.id;
    await chrome.windows.update(windowId, { left, top, width, height }); // 同 openTile：部分 WM 忽略 create 的初始 bounds
  } catch (e) {}
  if (windowId == null) return { windowId: null, opened: false };
  wins[site.host] = { id: windowId, owned: true };
  await setWindows(wins);
  const minimized = await consoleIsMinimized();
  try { await chrome.windows.update(windowId, minimized ? { state: "minimized" } : { state: "normal", focused: true }); } catch (e) {}
  if (!minimized) await raiseConsole();
  return { windowId, opened: true };
}
async function sendOneNewSession(site, text, tier, epoch = currentSendEpoch()) {
  const opened = await openSynthesisWindow(site);
  if (epoch !== currentSendEpoch()) return { host: site.host, ok: false, code: "cancelled" }; // 开窗期间取消
  if (!opened?.windowId) return { host: site.host, ok: false, code: "no_window" };
  const tabs = await tabsForHost(site.host, await getWindows()), tab = tabs[0];
  if (!tab?.id) return { host: site.host, ok: false, code: "no_window" };
  if (!opened.opened) await chrome.tabs.update(tab.id, { url: site.url, active: true });
  const ready = await waitForNewSession(tab.id, site.url, 22000, epoch);
  if (epoch !== currentSendEpoch()) return { host: site.host, ok: false, code: "cancelled" }; // 等新会话期间取消
  if (!ready) return { host: site.host, ok: false, code: "timeout" };
  return submitWhenReady(site, text, tier, 22000, 800, epoch, [], false);
}
