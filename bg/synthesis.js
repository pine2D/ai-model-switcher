// bg/synthesis.js — 在一个受管 popup 的新会话中发送辅助综合载荷。
function validSynthesisRequest(msg = {}) {
  const site = msg.site || {};
  if (typeof site.host !== "string" || typeof site.url !== "string" || !String(msg.text || "").trim() || ![null, "think", "fast"].includes(msg.tier ?? null)) return false;
  try { const url = new URL(site.url); return url.protocol === "https:" && url.hostname === site.host; } catch (_) { return false; }
}
async function waitForNewSession(tabId, url, timeoutMs = 22000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === "complete" && isNewSessionUrl(tab.url, url)) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
async function sendOneNewSession(site, text, tier) {
  const [opened] = await openTile([site], false);
  if (!opened?.windowId) return { host: site.host, ok: false, code: "no_window" };
  const tabs = await tabsForHost(site.host, await getWindows()), tab = tabs[0];
  if (!tab?.id) return { host: site.host, ok: false, code: "no_window" };
  if (!opened.opened) await chrome.tabs.update(tab.id, { url: site.url, active: true });
  if (!await waitForNewSession(tab.id, site.url)) return { host: site.host, ok: false, code: "timeout" };
  return submitWhenReady(site, text, tier, 22000, 800, currentSendEpoch(), [], false);
}
