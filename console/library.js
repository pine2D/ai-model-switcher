// console/library.js — 细条输入历史与范围/档位控件；模板库已归入 compose 独立窗。

let history = []; // 仅细条内存快捷缓存；完整历史在 IndexedDB，20 条不是数据上限。
let histCursor = -1; // -1 = 未在浏览历史
let histDraft = ""; // 进入历史浏览前的未发送草稿（↓ 回到 -1 时还原）
function pushHistory(text) {
  if (!text) return;
  history = [text, ...history.filter((h) => h !== text)].slice(0, 20);
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyAdd", text }, () => void chrome.runtime.lastError);
  histCursor = -1;
}

const elGroup = document.getElementById("group");
function syncGroupSelect() {
  document.getElementById("group-count").textContent = t("con_scopeCount", chosen().length, SITES.length);
  if (chosen().length) elGroup.removeAttribute("aria-invalid");
}
elGroup.addEventListener("click", () => {
  const r = elGroup.getBoundingClientRect();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openScope", anchor: { left: r.left, width: r.width } });
});

function syncTierButtons() {
  elTierButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tier === elTier.value)));
}
function setTierValue(value) {
  elTier.value = value;
  elTier.dispatchEvent(new Event("change"));
}
