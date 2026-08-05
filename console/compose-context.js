// console/compose-context.js — 提示词工作区的单一网页来源预览与载荷。
const ComposeContext = (() => {
  "use strict";

  const CONTEXT_KEY = "amsComposeContext";
  const ERROR_KEY = "amsComposeContextError";
  const ERROR_COPY = { page_access_denied: "cmp_contextDenied", page_empty: "cmp_contextEmpty",
    source_update_failed: "cmp_sourceUpdateFailed" };
  const card = document.getElementById("cmp-source");
  const kind = document.getElementById("cmp-source-kind");
  const title = document.getElementById("cmp-source-title");
  const link = document.getElementById("cmp-source-url");
  const count = document.getElementById("cmp-source-count");
  const detail = document.getElementById("cmp-source-detail");
  const replace = document.getElementById("cmp-source-replace");
  const status = document.getElementById("cmp-status");
  let activeSource = null, activeMarker = null, pendingSource = null, errorCode = null, initialized = false;

  function sessionGet(keys) {
    return new Promise((resolve, reject) => chrome.storage.session.get(keys, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(value || {});
    }));
  }
  function sessionRemove(keys) {
    return new Promise((resolve) => chrome.storage.session.remove(keys, () => {
      const error = chrome.runtime.lastError; resolve(!error);
    }));
  }
  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch (e) { return null; }
  }
  function render() {
    if (!activeSource) { card.hidden = true; return; }
    const chars = [...String(activeSource.text || "")];
    const url = safeUrl(activeSource.url);
    kind.textContent = t(activeSource.kind === "selection" ? "cmp_sourceSelection" : "cmp_sourcePage");
    title.textContent = String(activeSource.title || "");
    link.removeAttribute("href"); link.textContent = ""; link.hidden = !url;
    if (url) { link.href = url.href; link.textContent = url.hostname; }
    count.textContent = t("cmp_sourceCount", chars.length) + (activeSource.truncated ? ` · ${t("cmp_sourceTruncated")}` : "");
    detail.textContent = chars.slice(0, 800).join("");
    card.hidden = false;
  }
  function clearError() { errorCode = null; status.textContent = ""; }
  function showError(code) {
    errorCode = code;
    status.textContent = t(ERROR_COPY[code] || "cmp_contextDenied");
  }
  function activate(source) {
    do { activeMarker = crypto.randomUUID(); } while (String(source.text || "").includes(activeMarker));
    activeSource = source; render();
  }
  async function receive(source) {
    clearError();
    if (activeSource) { pendingSource = source; replace.hidden = false; return; }
    if (!await sessionRemove(CONTEXT_KEY)) { showError("source_update_failed"); return false; }
    activate(source); return true;
  }

  async function init() {
    if (initialized) return false;
    initialized = true;
    const values = await sessionGet([CONTEXT_KEY, ERROR_KEY]);
    if (!await sessionRemove([CONTEXT_KEY, ERROR_KEY])) { showError("source_update_failed"); return false; }
    if (values[CONTEXT_KEY]) activate(values[CONTEXT_KEY]);
    if (values[ERROR_KEY]) showError(values[ERROR_KEY]);
    return Boolean(values[CONTEXT_KEY]);
  }
  function payload(task) {
    if (!activeSource) return { text: task, task, source: null };
    const source = { ...activeSource }; delete source.text;
    const titleText = String(activeSource.title || "").replace(/\s+/g, " ").trim();
    const text = [...(task ? [task, ""] : []), t("cmp_referenceNotice"),
      `--- ${t("cmp_referenceStart")} · ${activeMarker} ---`, t("cmp_payloadSource", titleText),
      t("cmp_payloadUrl", activeSource.url), "", activeSource.text, `--- ${t("cmp_referenceEnd")} · ${activeMarker} ---`].join("\n");
    return { text, task, source };
  }
  async function remove() {
    if (pendingSource && !await sessionRemove(CONTEXT_KEY)) { showError("source_update_failed"); return false; }
    activeSource = activeMarker = null; pendingSource = null; card.hidden = true; replace.hidden = true;
    clearError(); return true;
  }
  async function resolveReplacement(usePending) {
    if (!pendingSource) return;
    if (!await sessionRemove(CONTEXT_KEY)) { showError("source_update_failed"); return; }
    if (usePending) activate(pendingSource);
    clearError();
    pendingSource = null; replace.hidden = true;
  }

  document.getElementById("cmp-source-remove").addEventListener("click", remove);
  document.getElementById("cmp-source-replace-yes").addEventListener("click", () => resolveReplacement(true));
  document.getElementById("cmp-source-replace-no").addEventListener("click", () => resolveReplacement(false));
  document.addEventListener("i18n:changed", () => { render(); if (errorCode) showError(errorCode); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    if (changes[CONTEXT_KEY]?.newValue) void receive(changes[CONTEXT_KEY].newValue);
    if (changes[ERROR_KEY] && Object.hasOwn(changes[ERROR_KEY], "newValue")) {
      if (changes[ERROR_KEY].newValue === null) clearError();
      else if (changes[ERROR_KEY].newValue !== undefined) showError(changes[ERROR_KEY].newValue);
      void sessionRemove(ERROR_KEY);
    }
  });

  return { init, payload, remove };
})();
