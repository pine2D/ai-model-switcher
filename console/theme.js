// console/theme.js — 主题：auto(随系统)/light/dark。popup、console 与 compose 共用，在 <head> 内最先加载。
// MV3 CSP（script-src 'self'）禁止内联脚本，故「防首帧闪烁的同步读 localStorage 抢先应用」也放这里
// （外链脚本仍先于首帧执行）。真值存 storage.local.amsTheme（popup 改）；localStorage 仅同步缓存。
// auto 时不设 data-theme，交给 console.css 的 @media 跟随系统。
(function () {
  // 首帧前同步应用缓存：<head> 内的外链脚本先于 body 渲染执行
  try { var t = localStorage.amsTheme; if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
})();
function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === "light" || pref === "dark") root.dataset.theme = pref;
  else root.removeAttribute("data-theme");
  try { localStorage.amsTheme = pref || "auto"; } catch (e) {}
}
chrome.storage.local.get({ amsTheme: "auto" }, (v) => applyTheme(v.amsTheme));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.amsTheme) applyTheme(c.amsTheme.newValue);
});
chrome.runtime.sendMessage({ source: "AMS_SYNC", action: "wake", reason: "surface" }, () => void chrome.runtime.lastError);
