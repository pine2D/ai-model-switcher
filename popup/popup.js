// popup/popup.js — 当前站模式 + console 入口 + 快捷键
applyI18n(); // i18n.js 已在 head 载入并从 localStorage 镜像同步了语言，立即本地化静态文案
let statusSite = "";
let statusConnected = false;
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(msg) {
  const tab = await activeTab();
  if (!tab || !tab.id) throw new Error("no-tab");
  return chrome.tabs.sendMessage(tab.id, msg);
}

function siteFor(tab) {
  try { const host = new URL(tab.url).hostname; return SITES.find((site) => site.host === host) || null; } catch (e) { return null; }
}
function renderStatus() {
  const status = document.getElementById("site-status");
  status.classList.remove("checking");
  status.classList.toggle("connected", statusConnected);
  status.classList.toggle("unsupported", !statusConnected);
  document.getElementById("status-text").textContent = statusConnected ? t("pop_connected", statusSite) : t("pop_unsupportedShort");
}
async function refreshState() {
  try {
    const tab = await activeTab();
    const site = tab && siteFor(tab); if (!site) throw new Error("unsupported");
    const res = await chrome.tabs.sendMessage(tab.id, { source: "AMS", cmd: "getState" });
    statusSite = site.label; statusConnected = true; renderStatus();
    document.getElementById("think").classList.toggle("active", !!res && res.state === "think");
    document.getElementById("fast").classList.toggle("active", !!res && res.state === "fast");
    document.getElementById("think").setAttribute("aria-pressed", !!res && res.state === "think" ? "true" : "false");
    document.getElementById("fast").setAttribute("aria-pressed", !!res && res.state === "fast" ? "true" : "false");
  } catch (e) {
    // 非 AI 站点是常态：中性提示 + 禁用两个档位按钮（否则看似可点、点了才失败）
    document.getElementById("unsupported").style.display = "block";
    document.getElementById("think").disabled = true;
    document.getElementById("fast").disabled = true;
    statusConnected = false; renderStatus();
  }
}

for (const mode of ["think", "fast"]) {
  document.getElementById(mode).addEventListener("click", async () => {
    try {
      await send({ source: "AMS", mode });
      window.close(); // 切换在页面内异步执行，toast 会提示结果
    } catch (e) {
      document.getElementById("unsupported").style.display = "block";
      statusConnected = false; renderStatus();
    }
  });
}

document.getElementById("diag").addEventListener("click", async () => {
  const out = document.getElementById("diagout");
  try {
    const res = await send({ source: "AMS", cmd: "diagnose" });
    out.textContent = "";
    const checks = (res && res.checks) || [];
    for (const c of checks) {
      const row = document.createElement("div");
      const mark = document.createElement("span");
      mark.className = "ck " + (c.ok ? "ok" : "bad"); // SVG 标记，不用 ✓/✗ 字形
      mark.setAttribute("aria-hidden", "true");
      row.append(mark, document.createTextNode(c.name));
      row.setAttribute("aria-label", c.name + " · " + t(c.ok ? "pop_diagPass" : "pop_diagFail"));
      row.style.color = c.ok ? "#16a34a" : "#dc2626";
      out.append(row);
    }
    if (checks.some((c) => !c.ok)) {
      const tip = document.createElement("div");
      tip.textContent = t("pop_diagStale");
      tip.className = "hint"; // 用变量色，暗色下保持可读
      out.append(tip);
    }
  } catch (e) { out.textContent = t("pop_diagUnsupported"); }
});

function buildKeys() {
  chrome.commands.getAll((cmds) => {
    const div = document.getElementById("keys");
    div.textContent = "";
    const order = { "open-console": 0, "switch-think": 1, "switch-fast": 2 };
    cmds.filter((c) => !c.name.startsWith("_")).sort((a, b) => order[a.name] - order[b.name]).forEach((c) => {
      const row = document.createElement("div");
      row.className = "keyrow";
      const label = document.createElement("span");
      const key = { "open-console": "pop_shortcutOpen", "switch-think": "pop_shortcutThink", "switch-fast": "pop_shortcutFast" }[c.name];
      label.textContent = key ? t(key) : (c.description || c.name);
      const kbd = document.createElement("kbd");
      kbd.textContent = c.shortcut || t("pop_shortcutUnset");
      row.append(label, kbd);
      div.append(row);
    });
  });
}
buildKeys();
document.addEventListener("i18n:changed", () => { buildKeys(); renderStatus(); });

document.getElementById("shortcut-help").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById("open-console").addEventListener("click", async () => {
  // 带上当前站 host：console 首次使用（无勾选历史）时预勾该站，打通"正看着这个站想群发"的路径
  let host = null;
  try { const tab = await activeTab(); host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (e) {}
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openConsole", host });
  window.close();
});

refreshState();
