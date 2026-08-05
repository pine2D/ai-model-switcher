// console/compose.js — 提示词工作区：编辑、模板、历史与发送。
applyI18n();
const composeContextReady = ComposeContext.init().catch(() => false);
const elText = document.getElementById("ch-text");
const elList = document.getElementById("cmp-list");
const elActions = document.getElementById("cmp-actions");
const elNameRow = document.getElementById("cmp-name");
const elConfirm = document.getElementById("cmp-confirm");
const finishButtons = ["ch-close", "ch-back", "ch-send"].map((id) => document.getElementById(id));
let templates = [], history = [], historyCursor = null, historyLoadToken = 0, activeKind = "templates", selectedTemplate = -1;
let finishing = false;

function setFinishing(value) { finishing = value; finishButtons.forEach((button) => { button.disabled = value; }); }
function requestConsoleReady() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ready); } };
    const timer = setTimeout(() => finish(false), 6000);
    chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openConsole" },
      (result) => finish(!chrome.runtime.lastError && result?.ok === true));
  });
}
function consoleSettings() {
  return new Promise((resolve, reject) => chrome.storage.local.get(["amsConsole"],
    (values) => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve((values && values.amsConsole) || {})));
}
function savePrompt(text) {
  return new Promise((resolve, reject) => chrome.storage.local.set({ amsConsolePrompt: text },
    () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()));
}
function dispatchLock(until = 0) {
  const method = until ? "set" : "remove", value = until ? { amsComposeDispatchUntil: until } : "amsComposeDispatchUntil";
  return new Promise((resolve, reject) => chrome.storage.session[method](value,
    () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()));
}
function finishFailed(key) { document.getElementById("cmp-status").textContent = t(key); setFinishing(false); }

function itemLabel(item) {
  const text = item.text || item.preview || "";
  return item.name || (text.length > 40 ? text.slice(0, 40) + "…" : text);
}
function showLibraryRow(row) {
  elActions.hidden = row !== elActions;
  elNameRow.hidden = row !== elNameRow;
  elConfirm.hidden = row !== elConfirm;
}
function syncTemplateActions() {
  const text = elText.value.trim();
  document.getElementById("cmp-save-template").disabled = !text || templates.some((item) => item.text === text);
  document.getElementById("cmp-delete-template").disabled = selectedTemplate < 0;
}
function renderLibrary() {
  const items = activeKind === "templates" ? templates : history;
  elList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "cmp-empty";
    empty.textContent = t(activeKind === "templates" ? "cmp_emptyTemplates" : "cmp_emptyHistory");
    elList.appendChild(empty);
  }
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "cmp-item"; button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(activeKind === "templates" && index === selectedTemplate));
    const title = document.createElement("strong"); title.textContent = itemLabel(item);
    const preview = document.createElement("span"); preview.textContent = item.text || item.preview || "";
    button.append(title, preview);
    button.addEventListener("click", () => {
      if (activeKind === "history" && !item.text) return loadHistoryItem(item.id);
      historyLoadToken++;
      elText.value = item.text; selectedTemplate = activeKind === "templates" ? index : -1;
      chrome.storage.local.set({ amsConsolePrompt: elText.value });
      renderLibrary(); elText.focus();
    });
    elList.appendChild(button);
  });
  document.querySelectorAll("#cmp-tabs [data-kind]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.kind === activeKind)));
  elActions.hidden = activeKind !== "templates";
  document.getElementById("cmp-more").hidden = activeKind !== "history" || !historyCursor;
  syncTemplateActions();
}
function setKind(kind) {
  historyLoadToken++; activeKind = kind; selectedTemplate = -1; showLibraryRow(elActions);
  if (kind === "history") loadHistory(true); else renderLibrary();
}
document.querySelectorAll("#cmp-tabs [data-kind]").forEach((button) => button.addEventListener("click", () => setKind(button.dataset.kind)));

async function persistAndReturn() {
  if (finishing) return; setFinishing(true);
  await composeContextReady;
  const run = ComposeContext.payload(elText.value.trim());
  try {
    await savePrompt(run.text); await RunMeta.savePending(run);
    if (await requestConsoleReady()) window.close();
    else finishFailed("cmp_consoleOpenFailed");
  } catch (error) { finishFailed("cmp_pendingSaveFailed"); }
}
document.getElementById("ch-close").addEventListener("click", () => { if (!finishing) window.close(); });
document.getElementById("ch-back").addEventListener("click", persistAndReturn);
elText.addEventListener("input", () => {
  historyLoadToken++;
  elText.removeAttribute("aria-invalid");
  chrome.storage.local.set({ amsConsolePrompt: elText.value });
  if (selectedTemplate >= 0) { selectedTemplate = -1; renderLibrary(); } else syncTemplateActions();
});

document.getElementById("cmp-save-template").addEventListener("click", () => {
  if (!elText.value.trim()) return;
  showLibraryRow(elNameRow); document.getElementById("cmp-template-name").focus();
});
function saveTemplate() {
  const text = elText.value.trim();
  if (!text || templates.some((item) => item.text === text)) { showLibraryRow(elActions); syncTemplateActions(); return; }
  const name = document.getElementById("cmp-template-name");
  templates = [...templates, { id: crypto.randomUUID(), name: name.value.trim(), text, updatedAt: Date.now() }];
  selectedTemplate = templates.length - 1; name.value = "";
  chrome.storage.local.set({ amsTemplates: templates }); showLibraryRow(elActions); renderLibrary();
}
document.getElementById("cmp-name-save").addEventListener("click", saveTemplate);
document.getElementById("cmp-name-cancel").addEventListener("click", () => showLibraryRow(elActions));
document.getElementById("cmp-template-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); saveTemplate(); }
  else if (event.key === "Escape") { event.preventDefault(); showLibraryRow(elActions); }
});
document.getElementById("cmp-delete-template").addEventListener("click", () => {
  if (selectedTemplate < 0) return;
  document.getElementById("cmp-confirm-text").textContent = t("con_delTpl", itemLabel(templates[selectedTemplate]));
  showLibraryRow(elConfirm); document.getElementById("cmp-confirm-no").focus();
});
document.getElementById("cmp-confirm-yes").addEventListener("click", () => {
  if (selectedTemplate >= 0) templates = templates.filter((_, index) => index !== selectedTemplate);
  selectedTemplate = -1; chrome.storage.local.set({ amsTemplates: templates });
  showLibraryRow(elActions); renderLibrary();
});
document.getElementById("cmp-confirm-no").addEventListener("click", () => showLibraryRow(elActions));

function renderScope(selected) {
  const chosen = SITES.filter((s) => selected[s.host]);
  const el = document.getElementById("ch-scope");
  el.removeAttribute("data-invalid");
  el.replaceChildren();
  if (!chosen.length) { el.textContent = t("cmp_scopeNone"); return; }
  el.append(document.createTextNode(t("cmp_scopePrefix")));
  const b = document.createElement("b"); b.textContent = t("cmp_scopeN", chosen.length); el.append(b);
  el.append(document.createTextNode(t("cmp_scopeColon") + chosen.map((s) => s.label).join(" · ")));
}
function loadHistory(reset) {
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyPage", cursor: reset ? null : historyCursor, limit: 50 }, (res) => {
    void chrome.runtime.lastError;
    if (!res || !res.ok) { document.getElementById("cmp-status").textContent = t("cmp_historyLoadFailed"); return; }
    history = reset ? res.items || [] : history.concat(res.items || []);
    historyCursor = res.nextCursor || null; document.getElementById("cmp-status").textContent = ""; renderLibrary();
  });
}
function loadHistoryItem(id) {
  const token = ++historyLoadToken;
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyGet", id }, (res) => {
    void chrome.runtime.lastError;
    if (token !== historyLoadToken || activeKind !== "history") return;
    if (!res || !res.ok || !res.record || !res.record.text) { document.getElementById("cmp-status").textContent = t("cmp_historyLoadFailed"); return; }
    history = history.map((item) => item.id === id ? res.record : item);
    elText.value = res.record.text; chrome.storage.local.set({ amsConsolePrompt: elText.value }); renderLibrary(); elText.focus();
  });
}
document.getElementById("cmp-more").addEventListener("click", () => loadHistory(false));
chrome.storage.local.get(["amsConsole", "amsConsolePrompt", "amsTemplates"], async (o) => {
  if (chrome.runtime.lastError) { document.getElementById("cmp-status").textContent = t("cmp_settingsLoadFailed"); return; }
  const freshSource = await composeContextReady;
  const c = (o && o.amsConsole) || {};
  const savedSelection = c.selected || {};
  const selected = resolveSiteSelection(savedSelection);
  if (!Object.keys(savedSelection).length) chrome.storage.local.set({ amsConsole: { ...c, selected } });
  const prompt = o.amsConsolePrompt != null ? o.amsConsolePrompt : c.prompt;
  if (!freshSource && prompt) elText.value = prompt;
  templates = (o && o.amsTemplates) || [];
  renderScope(selected); renderLibrary(); elText.focus();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.amsConsolePrompt) {
    const prompt = ch.amsConsolePrompt.newValue;
    if (prompt != null && prompt !== elText.value && !(document.hasFocus() && document.activeElement === elText)) elText.value = prompt;
  }
  if (ch.amsConsole) renderScope((ch.amsConsole.newValue || {}).selected || {});
  if (ch.amsTemplates) {
    templates = ch.amsTemplates.newValue || [];
    selectedTemplate = Math.min(selectedTemplate, templates.length - 1); renderLibrary();
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === "AMS_DATA" && msg.type === "historyChanged" && activeKind === "history") loadHistory(true);
});

document.addEventListener("i18n:changed", () => {
  applyI18n();
  chrome.storage.local.get("amsConsole", (o) => renderScope(((o && o.amsConsole) || {}).selected || {}));
  renderLibrary();
});

elText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); document.getElementById("ch-send").click(); }
});
document.getElementById("ch-send").addEventListener("click", async () => {
  const task = elText.value.trim();
  if (finishing) return; setFinishing(true);
  await composeContextReady;
  const payload = ComposeContext.payload(task);
  if (!payload.text.trim()) { setFinishing(false); elText.setAttribute("aria-invalid", "true"); elText.focus(); return; }
  let c;
  try { c = await consoleSettings(); }
  catch (error) { finishFailed("cmp_settingsLoadFailed"); return; }
  const selected = resolveSiteSelection(c.selected || {});
  const sites = SITES.filter((s) => selected[s.host]);
  if (!sites.length) { setFinishing(false); const scope = document.getElementById("ch-scope"); scope.setAttribute("data-invalid", "true"); scope.focus(); return; }
  const tier = c.tier || null;
  try { await savePrompt(payload.text); await dispatchLock(Date.now() + 10000); }
  catch (error) { finishFailed("cmp_pendingSaveFailed"); return; }
  if (!await requestConsoleReady()) { await dispatchLock().catch(() => {}); finishFailed("cmp_consoleOpenFailed"); return; }
  try { await RunMeta.clearPending(); }
  catch (error) { await dispatchLock().catch(() => {}); finishFailed("cmp_pendingSaveFailed"); return; }
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyAdd", text: payload.text }, (result) => {
    if (chrome.runtime.lastError || !result?.ok) {
      chrome.runtime.sendMessage({ from: "AMS_COMPOSE", type: "historySaveFailed" }, () => window.close());
    } else window.close();
  });
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text: payload.text, tier,
    run: { task: payload.task, source: payload.source } });
});
