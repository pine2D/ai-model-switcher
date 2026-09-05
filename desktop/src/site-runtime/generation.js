// desktop/src/site-runtime/generation.js — Desktop 只读回答状态探测；保守误漏，不以旧回答冒充本轮完成。
(function () {
  "use strict";

  const S = window.__AMS;
  if (!S || !S.adapters) return;

  const stopSelectors = {
    // chat-input-stop 是 Claude 生产包里的 testid 常量（同族的 chat-input / chat-input-send /
    // chat-input-attach 均已真机核实）；stop-button 是 ChatGPT 的形状，Claude 上零命中，
    // 保留它只为万一回归。aria-label 由 react-intl 产出、随界面语言变，只能当兜底不能当锚点。
    "claude.ai": '[data-testid="chat-input-stop"],[data-testid="stop-button"],button[aria-label*="stop response" i],button[aria-label*="停止回答"]',
    "chatgpt.com": '[data-testid="stop-button"],button[aria-label*="stop answering" i],button[aria-label*="stop generating" i],button[aria-label*="停止回答"]',
    "gemini.google.com": 'button[aria-label*="stop response" i],button[aria-label*="停止回答"]',
    "deepseek.com": '[aria-label*="stop" i],[aria-label*="停止"]',
    "doubao.com": '#flow-end-msg-stop,[aria-label*="stop" i],[aria-label*="停止"]',
    "qianwen.com": '[aria-label*="stop" i],[aria-label*="停止"]',
    "kimi.com": '.stop-button,[class*="stop-button"],[aria-label*="stop" i],[aria-label*="停止"]',
    "yuanbao.tencent.com": '[aria-label="Stop"],[aria-label="停止"]',
    "chatglm.cn": '.stop-button,[aria-label*="stop" i],[aria-label*="停止"]',
  };

  function visibleNearComposer(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const composer = S.findComposer && S.findComposer();
    if (!composer || typeof composer.getBoundingClientRect !== "function") return true;
    const c = composer.getBoundingClientRect();
    return r.bottom >= c.top - 360 && r.top <= c.bottom + 160;
  }

  for (const [host, selector] of Object.entries(stopSelectors)) {
    const adapter = S.adapters[host];
    if (!adapter || typeof adapter.generation === "function") continue;
    adapter.generation = function () {
      try {
        if (!location.hostname.includes(host)) return null;
        const stop = [...document.querySelectorAll(selector)].find(visibleNearComposer);
        if (stop) return "generating";
        if (typeof this.answer !== "function") return null;
        return this.answer() ? "complete" : "idle";
      } catch (e) {
        return null;
      }
    };
  }
}());
