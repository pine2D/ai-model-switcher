// console/sites.js — 站点清单（console 与 compose 共享，classic 全局脚本）
const SITES = [
  { host: "claude.ai", label: "Claude", url: "https://claude.ai/new", on: true, image: true, intl: true },
  { host: "chatgpt.com", label: "ChatGPT", url: "https://chatgpt.com/", on: true, image: true, intl: true },
  { host: "gemini.google.com", label: "Gemini", url: "https://gemini.google.com/app", on: true, intl: true },
  { host: "chat.deepseek.com", label: "DeepSeek", url: "https://chat.deepseek.com/", on: false, image: true },
  { host: "www.doubao.com", label: "豆包", url: "https://www.doubao.com/chat/", on: false, image: true },
  { host: "www.qianwen.com", label: "千问", url: "https://www.qianwen.com/", on: false },
  { host: "www.kimi.com", label: "Kimi", url: "https://www.kimi.com/", on: false, image: true },
  { host: "yuanbao.tencent.com", label: "元宝", url: "https://yuanbao.tencent.com/chat/", on: false, image: true },
  { host: "chatglm.cn", label: "智谱", url: "https://chatglm.cn/main/alltoolsdetail", on: false },
];
function resolveSiteSelection(saved, prefillHost = "") {
  if (saved && Object.keys(saved).length) return { ...saved };
  const selected = {};
  const host = String(prefillHost || "");
  const hit = host && SITES.find((site) => host.includes(site.host.replace(/^www\./, "")) || site.host.includes(host.replace(/^www\./, "")));
  if (hit) selected[hit.host] = true;
  else SITES.forEach((site) => { selected[site.host] = !!site.on; });
  return selected;
}
