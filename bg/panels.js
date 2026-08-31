// bg/panels.js — 不改变主 console 尺寸的轻量范围选择窗，兼放 console 上/下可用带的共用几何。
const SCOPE_MIN_H = 240; // 范围窗可用下限：低于此高度看不全站点复选框/分组/巡检入口，宁可翻到 console 上方

// console 让出的可用带（平铺区与范围窗共用）。console 停在工作区下缘时下方余量可能是 0 甚至负数：
// 旧代码只夹高度不夹顶边，于是九个平铺窗全部建到工作区之外（F011），范围窗被夹成 1px（F010）。
// 规则：下方够 minH 就用下方；不够就整体翻到 console 上方；两边都不够，退回工作区顶部按可用高度取用
// （小屏上与 console 重叠，好过建到屏幕外）。返回的 {top,height} 恒落在工作区内，above 指示是否翻到上方。
function consoleBand(wa, geo, minH) {
  const waBottom = wa.top + wa.height;
  const belowTop = Math.min(Math.max(geo.bottom, wa.top), waBottom);
  const below = { top: belowTop, height: waBottom - belowTop, above: false };
  if (below.height >= minH) return below;
  const above = { top: wa.top, height: Math.max(0, Math.min(geo.top, waBottom) - wa.top), above: true };
  if (above.height >= minH) return above;
  return { top: wa.top, height: Math.min(wa.height, Math.max(minH, below.height, above.height)), above: false };
}

async function getScopeWinId() {
  if (scopeWinId != null) return scopeWinId;
  const value = await new Promise((resolve) => chrome.storage.local.get("amsScopeWin", resolve));
  scopeWinId = value && value.amsScopeWin != null ? value.amsScopeWin : null;
  return scopeWinId;
}

// in-flight 去重见 bg/windows.js 的 onceByKey：anchor 进指纹，第二次调用的锚点不再被静默丢弃（F005）。
async function openScope(anchor) { return onceByKey("scope", JSON.stringify(anchor || null), () => _openScope(anchor)); }
async function _openScope(anchor) {
  const existing = await getScopeWinId();
  if (existing != null && await updateIfPopup(existing, { focused: true, state: "normal" })) return;
  const geo = await consoleGeometry(); // 工作区与 console 上下边同一次解析，杜绝跨屏混算
  const wa = geo.wa;
  const width = Math.min(390, wa.width);
  // 默认贴 console 底边向下展开；下方余量不足则翻到 console 上方并底对齐，保持「从细条长出来」的观感
  const band = consoleBand(wa, geo, SCOPE_MIN_H);
  const height = Math.round(Math.min(390, wa.height, band.height));
  const top = Math.round(band.above ? band.top + band.height - height : band.top);
  let left = geo.attached ? geo.left + ((anchor && anchor.left) || 0) : wa.left + Math.max(0, Math.floor((wa.width - width) / 2));
  left = Math.round(Math.max(wa.left, Math.min(left, wa.left + wa.width - width)));
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("console/scope.html") + "?top=" + top, type: "popup",
    left, top, width, height, focused: true,
  });
  await chrome.windows.update(created.id, { left, top });
  scopeWinId = created.id;
  await chrome.storage.local.set({ amsScopeWin: created.id });
}
