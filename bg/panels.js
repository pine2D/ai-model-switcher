// bg/panels.js — 不改变主 console 尺寸的轻量范围选择窗。
async function getScopeWinId() {
  if (scopeWinId != null) return scopeWinId;
  const value = await new Promise((resolve) => chrome.storage.local.get("amsScopeWin", resolve));
  scopeWinId = value && value.amsScopeWin != null ? value.amsScopeWin : null;
  return scopeWinId;
}

let _openingScope = null;
async function openScope(anchor) {
  if (_openingScope) return _openingScope;
  _openingScope = _openScope(anchor).finally(() => { _openingScope = null; });
  return _openingScope;
}
async function _openScope(anchor) {
  const existing = await getScopeWinId();
  if (existing != null && await updateIfPopup(existing, { focused: true, state: "normal" })) return;
  const wa = await consoleWorkArea();
  const width = Math.min(390, wa.width);
  let height = Math.min(390, wa.height);
  let left = wa.left + Math.max(0, Math.floor((wa.width - width) / 2));
  let top = wa.top;
  try {
    const consoleWindow = await chrome.windows.get(await getConsoleWinId());
    if (consoleWindow.type === "popup") {
      left = consoleWindow.left + ((anchor && anchor.left) || 0);
      top = consoleWindow.top + consoleWindow.height;
    }
  } catch (error) {}
  left = Math.max(wa.left, Math.min(left, wa.left + wa.width - width));
  top = Math.max(wa.top, Math.min(top, wa.top + wa.height - 1));
  height = Math.min(height, Math.max(1, wa.top + wa.height - top));
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("console/scope.html") + "?top=" + Math.round(top), type: "popup",
    left: Math.round(left), top: Math.round(top), width, height, focused: true,
  });
  await chrome.windows.update(created.id, { left: Math.round(left), top: Math.round(top) });
  scopeWinId = created.id;
  await chrome.storage.local.set({ amsScopeWin: created.id });
}
