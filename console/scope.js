let consoleState = {};
let selected = {};
let groups = [];
// checkResults 存 bg 巡检的原始结果（或 {checking:true} 占位），checks 是渲染前由它现算出的 {state,text}
// 映射，只在 renderScope() 里重建，不缓存已翻译成品串——语言切换后可按当前语言重算（同 status.js 的
// chipMeta 模式），不把旧语言译文原样抄回。
let checkResults = {};
let checks = {};
let checksAt = 0; // 最近一次巡检完成时刻——诊断报告用它，不用复制时刻（隔久了会误导改版时点比对）
let checking = false;
let pendingGroupDeleteId = null; // 分组删除确认目标（按 id 定位，见 renderScope 顶部的撤销）
let scopeTopHonored = false; // 创建时的 ?top= 只落位一次，此后信任窗口真实位置（F008：别把用户拖动过的窗口拉回去）
const ALL_HOSTS = SITES.map((site) => site.host);
const IMAGE_HOSTS = SITES.filter((site) => site.image).map((site) => site.host);
const INTL_HOSTS = SITES.filter((site) => site.intl).map((site) => site.host);
const DOMESTIC_HOSTS = SITES.filter((site) => !site.intl).map((site) => site.host);
const elNameRow = document.getElementById("scope-name");
const elConfirm = document.getElementById("scope-confirm");
const elManage = document.getElementById("scope-manage");
const elName = document.getElementById("group-name");
const scopeTopParam = new URLSearchParams(location.search).get("top");
const requestedScopeTop = scopeTopParam == null ? null : Number(scopeTopParam);
let scopeFitFrame = 0;

// SCOPE_SIZE_START — scripts/test-console-polish.js 直接执行纯高度计算。
function fittedScopeHeight(contentHeight, frameHeight, requestedTop, actualTop, screenBottom) {
  return Math.max(1, Math.min(contentHeight + frameHeight, screenBottom - Math.max(requestedTop, actualTop)));
}
// SCOPE_SIZE_END

// SCOPE_TOP_START — scripts/test-console-polish.js 直接执行顶部落位判定。
function resolveScopeTop(honored, requestedTop, actualTop) {
  return !honored && Number.isFinite(requestedTop) ? requestedTop : actualTop;
}
// SCOPE_TOP_END

function fitScopeHeight() {
  cancelAnimationFrame(scopeFitFrame);
  scopeFitFrame = requestAnimationFrame(() => {
    const bodyRect = document.body.getBoundingClientRect();
    const paddingBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const contentBottom = [...document.body.children]
      .filter((element) => element.tagName !== "SCRIPT" && !element.hidden)
      .reduce((bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom), bodyRect.top);
    const contentHeight = Math.ceil(contentBottom - bodyRect.top + paddingBottom);
    chrome.windows.getCurrent((current) => {
      if (chrome.runtime.lastError || !current || current.id == null) return;
      const frameHeight = Math.max(0, (current.height || outerHeight) - innerHeight);
      const actualTop = current.top == null ? screenY : current.top;
      const top = resolveScopeTop(scopeTopHonored, requestedScopeTop, actualTop);
      scopeTopHonored = true;
      const height = fittedScopeHeight(contentHeight, frameHeight, top, actualTop, screen.availTop + screen.availHeight);
      if (height === current.height) return;
      chrome.windows.update(current.id, { top, height }, () => void chrome.runtime.lastError);
    });
  });
}

function currentHosts() { return ALL_HOSTS.filter((host) => selected[host]); }
let lastPersistedSelection = null; // 自写抑制：写入方自身也会收到 storage.onChanged，靠它识别「这是我刚写的」，别再重渲一次
function persistSelection() {
  consoleState = { ...consoleState, selected: { ...selected } };
  lastPersistedSelection = JSON.stringify(consoleState.selected);
  chrome.storage.local.set({ amsConsole: consoleState });
}
function applyHosts(hosts) {
  ALL_HOSTS.forEach((host) => { selected[host] = hosts.includes(host); });
  checkResults = {}; setLive(null);
  persistSelection(); renderScope();
}

// SCOPE_LOGIC_START — scripts/test-background.js 直接执行这段选择逻辑。
function groupSignature(hosts) { return hosts.slice().sort().join(","); }
const PRESET_SIGNATURES = new Set([ALL_HOSTS, IMAGE_HOSTS, INTL_HOSTS, DOMESTIC_HOSTS].map(groupSignature));
function isPresetGroup(group) { return PRESET_SIGNATURES.has(groupSignature(group.hosts)); }
function canSaveGroup(hosts) {
  if (!hosts.length || isPresetGroup({ hosts })) return false;
  const signature = groupSignature(hosts);
  return !groups.some((group) => groupSignature(group.hosts) === signature);
}
function setSiteSelected(host, on) {
  if (!ALL_HOSTS.includes(host)) return false;
  selected[host] = on; persistSelection(); renderScope(); return true;
}
// SCOPE_LOGIC_END

function currentGroupIndex() {
  const signature = groupSignature(currentHosts());
  return groups.findIndex((group) => !isPresetGroup(group) && groupSignature(group.hosts) === signature);
}
// SCOPE_SITE_SYNC_START — scripts/test-console-polish.js 直接执行单站行同步纯逻辑。
function siteRowState(host, selectedMap, checksMap) {
  const check = checksMap[host];
  return {
    checked: !!selectedMap[host],
    state: check ? check.state : null,
    statusText: check ? (check.state === "checking" ? "…" : "") : "",
    ariaLabel: check ? check.text : null,
    title: check ? check.text : "",
  };
}
// SCOPE_SITE_SYNC_END
const siteRefs = {};
let sitesBuilt = false;
function buildSites() {
  const sites = document.getElementById("scope-sites"); sites.replaceChildren();
  SITES.forEach((site) => {
    const label = document.createElement("label"); label.className = "scope-site";
    const input = document.createElement("input"); input.type = "checkbox";
    input.addEventListener("change", () => { delete checkResults[site.host]; setSiteSelected(site.host, input.checked); });
    const name = document.createElement("span"); name.className = "scope-site-name"; name.textContent = site.label;
    const status = document.createElement("span"); status.className = "scope-state";
    label.append(input, name, status); sites.appendChild(label);
    siteRefs[site.host] = { label, input, status };
  });
  sitesBuilt = true;
}
// 只做增量同步（checked/巡检状态/提示），不重建整个九宫格——避免每次勾选都丢一次键盘焦点（F117）
function syncSites() {
  if (!sitesBuilt) buildSites();
  SITES.forEach((site) => {
    const ref = siteRefs[site.host];
    const row = siteRowState(site.host, selected, checks);
    ref.input.checked = row.checked;
    if (row.state) ref.label.dataset.state = row.state; else delete ref.label.dataset.state;
    ref.status.textContent = row.statusText;
    if (row.ariaLabel != null) ref.status.setAttribute("aria-label", row.ariaLabel); else ref.status.removeAttribute("aria-label");
    ref.label.title = row.title;
  });
}
// checkResults（原始结果）→ checks（{state,text}，供 siteRowState 直接消费）：每次渲染前现算一遍。
function computeChecks() {
  checks = {};
  for (const host in checkResults) {
    const result = checkResults[host];
    checks[host] = result.checking ? { state: "checking", text: t("con_checking") } : { state: result.ok ? "ok" : "fail", text: checkText(result) };
  }
}
function renderScope() {
  pendingGroupDeleteId = null; showOnly(elManage);
  document.getElementById("scope-count").textContent = t("con_scopeCount", currentHosts().length, SITES.length);
  computeChecks();
  syncSites();
  const saved = document.getElementById("scope-groups"); saved.replaceChildren();
  groups.filter((group) => !isPresetGroup(group)).forEach((group) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = group.name; button.title = group.name;
    button.addEventListener("click", () => applyHosts(group.hosts)); saved.appendChild(button);
  });
  document.getElementById("grp-save").disabled = !canSaveGroup(currentHosts());
  document.getElementById("grp-del").disabled = currentGroupIndex() < 0;
  document.getElementById("scope-checkup").disabled = checking || !currentHosts().length;
  document.getElementById("scope-report").disabled = checking ||
    !Object.values(checks).some((check) => check.state === "ok" || check.state === "fail");
  fitScopeHeight();
}
function showOnly(row) {
  elManage.hidden = row !== elManage; elNameRow.hidden = row !== elNameRow; elConfirm.hidden = row !== elConfirm;
  fitScopeHeight();
}
function clearGroupName() { elName.value = ""; elName.removeAttribute("aria-invalid"); }
function saveGroup() {
  const name = elName.value.trim();
  if (!name) { elName.setAttribute("aria-invalid", "true"); elName.focus(); return; }
  const hosts = currentHosts();
  if (!canSaveGroup(hosts)) { showOnly(elManage); renderScope(); return; }
  groups = [...groups.filter((group) => group.name !== name), { id: crypto.randomUUID(), name, hosts, updatedAt: Date.now() }];
  chrome.storage.local.set({ amsGroups: groups });
  clearGroupName(); showOnly(elManage); renderScope();
}

document.getElementById("scope-all").addEventListener("click", () => applyHosts(ALL_HOSTS));
document.getElementById("scope-none").addEventListener("click", () => applyHosts([]));
document.getElementById("scope-image").addEventListener("click", () => applyHosts(IMAGE_HOSTS));
document.getElementById("scope-intl").addEventListener("click", () => applyHosts(INTL_HOSTS));
document.getElementById("scope-domestic").addEventListener("click", () => applyHosts(DOMESTIC_HOSTS));
const CHECK_ERR_KEYS = { no_window: "con_errNoWindow", not_ready: "con_errNotReady" };
function checkText(result) {
  // note = 档位读不出这类「合法但不可判」的软信号，不再算巡检失败。**必须用带说明的词条**：
  // 光把失败项的名字拼在「自检通过」后面会读成「这项通过了」，语义正好反过来。
  if (result.ok) return result.note ? t("con_checkupOkAdvisory", result.note) : t("con_checkupOk");
  return result.reason || t(CHECK_ERR_KEYS[result.code] || "con_errGeneric");
}
// #scope-live 同样不缓存成品串：只记「按哪个词条 + 什么参数」现算，语言切换后 refreshLive() 能补算一次。
let liveState = null; // {key, args} | null
function setLive(key, ...args) {
  liveState = key ? { key, args } : null;
  document.getElementById("scope-live").textContent = key ? t(key, ...args) : "";
}
function refreshLive() { if (liveState) document.getElementById("scope-live").textContent = t(liveState.key, ...liveState.args); }
document.getElementById("scope-checkup").addEventListener("click", () => {
  const sites = SITES.filter((site) => selected[site.host]);
  if (!sites.length || checking) return;
  checking = true;
  checkResults = Object.fromEntries(sites.map((site) => [site.host, { checking: true }]));
  setLive("con_checking"); renderScope();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "checkup", sites }, (response) => {
    const results = (response && response.results) || [];
    checkResults = Object.fromEntries(results.map((result) => [result.host, result]));
    checksAt = Date.now();
    checking = false;
    const ok = results.filter((result) => result.ok).length;
    setLive("scope_checkDone", ok, sites.length - ok);
    renderScope();
  });
});
// 报障出口：把最近一次巡检结果整理成可粘贴的诊断报告（不含任何对话内容），配合 GitHub issue 模板使用
function buildReport() {
  const manifest = chrome.runtime.getManifest();
  // dpr 必带：v0.15.2 事故根因就是显示缩放（19.999998px），这是报障里最值钱的一个环境值
  const lines = [
    `PolyAsk ${manifest.version} · ${document.documentElement.lang || "?"} · dpr ${devicePixelRatio} · ${new Date(checksAt || Date.now()).toISOString()}`,
    navigator.userAgent,
  ];
  SITES.forEach((site) => {
    const check = checks[site.host];
    if (check && check.state !== "checking") lines.push(`${site.host}: ${check.state === "ok" ? "OK" : "FAIL"} · ${check.text || ""}`);
  });
  lines.push("", t("scope_reportHint"));
  return lines.join("\n");
}
document.getElementById("scope-report").addEventListener("click", () => {
  navigator.clipboard.writeText(buildReport()).then(
    () => setLive("scope_reportCopied"),
    () => setLive("con_collectFail"));
});
document.getElementById("grp-save").addEventListener("click", () => { showOnly(elNameRow); elName.focus(); });
document.getElementById("group-name-cancel").addEventListener("click", () => { clearGroupName(); showOnly(elManage); });
elName.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); saveGroup(); }
  else if (event.key === "Escape") { event.preventDefault(); clearGroupName(); showOnly(elManage); }
});
elName.addEventListener("input", () => elName.removeAttribute("aria-invalid"));
document.getElementById("grp-del").addEventListener("click", () => {
  const index = currentGroupIndex(); if (index < 0) return;
  pendingGroupDeleteId = groups[index].id; // 绑定目标分组 id：确认期间改勾选/换分组，renderScope 顶部会清掉它（F114）
  document.getElementById("scope-confirm-text").textContent = t("con_delGroup", groups[index].name);
  showOnly(elConfirm); document.getElementById("scope-confirm-no").focus();
});
document.getElementById("scope-confirm-yes").addEventListener("click", () => {
  const targetId = pendingGroupDeleteId;
  if (groups.some((group) => group.id === targetId)) {
    groups = groups.filter((group) => group.id !== targetId);
    chrome.storage.local.set({ amsGroups: groups });
  }
  renderScope(); // 顶部会清 pendingGroupDeleteId 并 showOnly(elManage)，目标已漂移时这里只是安全撤销，不写入
});
document.getElementById("scope-confirm-no").addEventListener("click", () => { pendingGroupDeleteId = null; showOnly(elManage); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!elNameRow.hidden || !elConfirm.hidden) { pendingGroupDeleteId = null; showOnly(elManage); } else window.close();
});
window.addEventListener("blur", () => window.close());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let shouldRender = false;
  if (changes.amsConsole) {
    const nextConsole = changes.amsConsole.newValue || {};
    const nextSelected = nextConsole.selected || {};
    const isOwnEcho = lastPersistedSelection === JSON.stringify(nextSelected); // 自写抑制：吃掉自己写入触发的回环（F117）
    lastPersistedSelection = null;
    consoleState = nextConsole; selected = nextSelected;
    if (!isOwnEcho) shouldRender = true;
  }
  if (changes.amsGroups) { groups = changes.amsGroups.newValue || []; shouldRender = true; }
  if (shouldRender) renderScope();
});
chrome.storage.local.get(["amsConsole", "amsGroups"], (value) => {
  consoleState = value.amsConsole || {}; selected = consoleState.selected || {}; groups = value.amsGroups || [];
  renderScope();
});
document.addEventListener("i18n:changed", () => { renderScope(); refreshLive(); }); // renderScope 内 computeChecks() 已现算 checks，这里补现算 #scope-live
applyI18n();
