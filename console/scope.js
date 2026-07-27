let consoleState = {};
let selected = {};
let groups = [];
let checks = {};
let checking = false;
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
      const top = Number.isFinite(requestedScopeTop) ? requestedScopeTop : (current.top == null ? screenY : current.top);
      const actualTop = current.top == null ? top : current.top;
      const height = fittedScopeHeight(contentHeight, frameHeight, top, actualTop, screen.availTop + screen.availHeight);
      if (height === current.height) return;
      chrome.windows.update(current.id, { top, height }, () => void chrome.runtime.lastError);
    });
  });
}

function currentHosts() { return ALL_HOSTS.filter((host) => selected[host]); }
function persistSelection() {
  consoleState = { ...consoleState, selected: { ...selected } };
  chrome.storage.local.set({ amsConsole: consoleState });
}
function applyHosts(hosts) {
  ALL_HOSTS.forEach((host) => { selected[host] = hosts.includes(host); });
  checks = {}; document.getElementById("scope-live").textContent = "";
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
function renderScope() {
  document.getElementById("scope-count").textContent = t("con_scopeCount", currentHosts().length, SITES.length);
  const sites = document.getElementById("scope-sites"); sites.replaceChildren();
  SITES.forEach((site) => {
    const label = document.createElement("label"); label.className = "scope-site";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!selected[site.host];
    input.addEventListener("change", () => { delete checks[site.host]; setSiteSelected(site.host, input.checked); });
    const name = document.createElement("span"); name.className = "scope-site-name"; name.textContent = site.label;
    const status = document.createElement("span"); status.className = "scope-state";
    const check = checks[site.host];
    if (check) {
      label.dataset.state = check.state;
      status.textContent = check.state === "checking" ? "…" : "";
      status.setAttribute("aria-label", check.text); label.title = check.text;
    }
    label.append(input, name, status); sites.appendChild(label);
  });
  const saved = document.getElementById("scope-groups"); saved.replaceChildren();
  groups.filter((group) => !isPresetGroup(group)).forEach((group) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = group.name; button.title = group.name;
    button.addEventListener("click", () => applyHosts(group.hosts)); saved.appendChild(button);
  });
  document.getElementById("grp-save").disabled = !canSaveGroup(currentHosts());
  document.getElementById("grp-del").disabled = currentGroupIndex() < 0;
  document.getElementById("scope-checkup").disabled = checking || !currentHosts().length;
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
  groups = [...groups.filter((group) => group.name !== name), { name, hosts }];
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
  if (result.ok) return t("con_checkupOk");
  return result.reason || t(CHECK_ERR_KEYS[result.code] || "con_errGeneric");
}
document.getElementById("scope-checkup").addEventListener("click", () => {
  const sites = SITES.filter((site) => selected[site.host]);
  if (!sites.length || checking) return;
  checking = true;
  checks = Object.fromEntries(sites.map((site) => [site.host, { state: "checking", text: t("con_checking") }]));
  document.getElementById("scope-live").textContent = t("con_checking"); renderScope();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "checkup", sites }, (response) => {
    const results = (response && response.results) || [];
    checks = Object.fromEntries(results.map((result) => [result.host, { state: result.ok ? "ok" : "fail", text: checkText(result) }]));
    checking = false;
    const ok = results.filter((result) => result.ok).length;
    document.getElementById("scope-live").textContent = t("scope_checkDone", ok, sites.length - ok);
    renderScope();
  });
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
  document.getElementById("scope-confirm-text").textContent = t("con_delGroup", groups[index].name);
  showOnly(elConfirm); document.getElementById("scope-confirm-no").focus();
});
document.getElementById("scope-confirm-yes").addEventListener("click", () => {
  const index = currentGroupIndex(); if (index >= 0) groups = groups.filter((_, i) => i !== index);
  chrome.storage.local.set({ amsGroups: groups }); showOnly(elManage); renderScope();
});
document.getElementById("scope-confirm-no").addEventListener("click", () => showOnly(elManage));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!elNameRow.hidden || !elConfirm.hidden) showOnly(elManage); else window.close();
});
window.addEventListener("blur", () => window.close());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.amsConsole) { consoleState = changes.amsConsole.newValue || {}; selected = consoleState.selected || {}; }
  if (changes.amsGroups) groups = changes.amsGroups.newValue || [];
  if (changes.amsConsole || changes.amsGroups) renderScope();
});
chrome.storage.local.get(["amsConsole", "amsGroups"], (value) => {
  consoleState = value.amsConsole || {}; selected = consoleState.selected || {}; groups = value.amsGroups || [];
  renderScope();
});
document.addEventListener("i18n:changed", renderScope);
applyI18n();
