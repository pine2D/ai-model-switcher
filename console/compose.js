// console/compose.js — 提示词工作区：编辑、模板、历史与发送。
applyI18n();
const composeContextReady = ComposeContext.init().catch(() => {});
const elText = document.getElementById("ch-text");
const elList = document.getElementById("cmp-list");
const elActions = document.getElementById("cmp-actions");
const elNameRow = document.getElementById("cmp-name");
const elConfirm = document.getElementById("cmp-confirm");
let templates = [], history = [], historyCursor = null, historyLoadToken = 0, activeKind = "templates", selectedTemplate = -1;

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

async function persistAndClose() {
  await composeContextReady;
  const run = ComposeContext.payload(elText.value.trim());
  chrome.storage.local.set({ amsConsolePrompt: run.text }, () => {
    const error = chrome.runtime.lastError;
    if (error) { document.getElementById("cmp-status").textContent = t("cmp_pendingSaveFailed"); return; }
    chrome.storage.session.set({ amsPendingRun: run }, () => {
      const sessionError = chrome.runtime.lastError;
      if (sessionError) { document.getElementById("cmp-status").textContent = t("cmp_pendingSaveFailed"); return; }
      window.close();
    });
  });
}
document.getElementById("ch-close").addEventListener("click", persistAndClose);
document.getElementById("ch-back").addEventListener("click", persistAndClose);
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
chrome.storage.local.get(["amsConsole", "amsConsolePrompt", "amsTemplates"], (o) => {
  const c = (o && o.amsConsole) || {};
  const prompt = o.amsConsolePrompt != null ? o.amsConsolePrompt : c.prompt;
  if (prompt) elText.value = prompt;
  templates = (o && o.amsTemplates) || [];
  renderScope(c.selected || {}); renderLibrary(); elText.focus();
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
  if (!task) { elText.setAttribute("aria-invalid", "true"); elText.focus(); return; }
  await composeContextReady;
  const payload = ComposeContext.payload(task);
  chrome.storage.local.get(["amsConsole"], (o) => {
    const c = (o && o.amsConsole) || {};
    const sites = SITES.filter((s) => (c.selected || {})[s.host]);
    if (!sites.length) { const scope = document.getElementById("ch-scope"); scope.setAttribute("data-invalid", "true"); scope.focus(); return; }
    chrome.storage.local.set({ amsConsolePrompt: payload.text }, () => {
      chrome.runtime.sendMessage({ source: "AMS_DATA", action: "historyAdd", text: payload.text }, (result) => {
        const send = () => { chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text: payload.text, tier: c.tier || null, run: { task: payload.task, source: payload.source } }); window.close(); };
        if (chrome.runtime.lastError || !result?.ok) chrome.runtime.sendMessage({ from: "AMS_COMPOSE", type: "historySaveFailed" }, send);
        else send();
      });
    });
  });
});
