// console/compose-synthesis.js — 辅助综合配置、完整预览与单站发送。
const SynthesisCompose = (() => {
  const active = new URLSearchParams(location.search).get("mode") === "synthesis";
  if (!active) return { active };
  applyI18n();
  document.getElementById("cmp-library").hidden = true; document.getElementById("cmp-editor").hidden = true;
  document.getElementById("ch-foot").hidden = true; document.getElementById("syn-panel").hidden = false;
  const answers = document.getElementById("syn-answers"), target = document.getElementById("syn-target"), count = document.getElementById("syn-count");
  const tier = document.getElementById("syn-tier"), instruction = document.getElementById("syn-instruction");
  const preview = document.getElementById("syn-preview"), send = document.getElementById("syn-send"), status = document.getElementById("syn-status");
  const MAX_PAYLOAD = 60000;
  const ERR_KEYS = { timeout: "con_errTimeout", composer_not_found: "con_errNoComposer", inject_failed: "con_errInject",
    submit_unconfirmed: "con_errSubmit", tier_unconfirmed: "con_errTier", no_window: "con_errNoWindow", not_ready: "con_errNotReady", error: "con_errGeneric" };
  let context = null, busy = false, statusKey = null;
  const runtimeMessage = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (result) => {
    const error = chrome.runtime.lastError; resolve(error ? null : result);
  }));
  const sessionSet = (value) => new Promise((resolve, reject) => chrome.storage.session.set(value,
    () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()));
  function selectedHosts() { return [...answers.querySelectorAll("input:checked")].map((input) => input.value); }
  function payload() { return SynthesisModel.build({ ...context, selectedHosts: selectedHosts(), instruction: instruction.value }); }
  function setStatus(key, warning = false) {
    statusKey = key; status.textContent = key ? t(key) : "";
    if (warning) status.setAttribute("data-warning", ""); else status.removeAttribute("data-warning");
  }
  function rebuild() {
    if (!context) return;
    const input = { ...context, selectedHosts: selectedHosts(), targetHost: target.value, instruction: instruction.value };
    const built = SynthesisModel.build(input), invalid = SynthesisModel.validate(input);
    preview.value = built.text; count.textContent = t("syn_count", built.count); send.disabled = busy || !!invalid;
    setStatus(built.tooLong || [...built.text].length > MAX_PAYLOAD ? "syn_tooLong" : invalid === "not_enough_answers" ? "syn_notEnough" : invalid ? "syn_targetMissing" : null, built.tooLong);
  }
  function renderAnswers() {
    const selected = new Set(selectedHosts()); answers.querySelectorAll("label").forEach((node) => node.remove());
    for (const result of context?.results || []) {
      const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.value = result.host;
      input.checked = !selected.size || selected.has(result.host); input.addEventListener("change", rebuild);
      const state = result.state === "think" ? t("con_mdThink") : result.state === "fast" ? t("con_mdFast") : t("syn_unknown");
      label.append(input, document.createTextNode(`${result.label || result.host} · ${state}`)); answers.appendChild(label);
    }
  }
  function renderTargets() {
    const old = target.value, empty = document.createElement("option"); empty.value = ""; empty.textContent = t("syn_targetMissing");
    target.replaceChildren(empty);
    for (const site of SITES) { const option = document.createElement("option"); option.value = site.host; option.textContent = site.label; target.appendChild(option); }
    target.value = SITES.some((site) => site.host === old) ? old : "";
  }
  document.getElementById("ch-close").addEventListener("click", () => { if (!busy) window.close(); });
  target.addEventListener("change", rebuild); tier.addEventListener("change", rebuild); instruction.addEventListener("input", rebuild);
  send.addEventListener("click", async () => {
    const site = SITES.find((item) => item.host === target.value), built = payload();
    if (!site || busy || selectedHosts().length < 2) return;
    busy = true; rebuild(); setStatus("syn_opening");
    const history = runtimeMessage({ source: "AMS_DATA", action: "historyAdd", text: built.text });
    const result = await runtimeMessage({ source: "AMS_CONSOLE", action: "sendOneNewSession", site, text: built.text, tier: tier.value || null });
    history.then((saved) => { if (!saved?.ok) chrome.runtime.sendMessage({ from: "AMS_COMPOSE", type: "historySaveFailed" }, () => void chrome.runtime.lastError); });
    if (!result?.ok) { busy = false; rebuild(); setStatus(ERR_KEYS[result?.code] || "con_errGeneric", true); return; }
    try { await sessionSet({ amsPendingSynthesis: { archiveId: context.archiveId, targetHost: site.host, instruction: instruction.value.trim(), sentAt: Date.now() } }); window.close(); }
    catch (_) { busy = false; rebuild(); setStatus("cmp_pendingSaveFailed", true); }
  });
  chrome.storage.session.get("amsComposeSynthesis", (value) => {
    context = value?.amsComposeSynthesis || null; chrome.storage.session.remove("amsComposeSynthesis");
    if (!context || !Array.isArray(context.results)) { setStatus("syn_contextFailed", true); send.disabled = true; return; }
    instruction.value = t("syn_defaultInstruction"); renderAnswers(); renderTargets();
    chrome.storage.local.get({ amsConsole: {} }, (local) => { const current = local.amsConsole?.tier; tier.value = ["think", "fast"].includes(current) ? current : ""; rebuild(); });
  });
  document.addEventListener("i18n:changed", () => { applyI18n(); if (!context) return; const key = statusKey, warning = status.hasAttribute("data-warning"); renderAnswers(); renderTargets(); rebuild();
    if (key && !["syn_notEnough", "syn_targetMissing", "syn_tooLong"].includes(key)) setStatus(key, warning); });
  return { active };
})();
