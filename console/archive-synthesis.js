// console/archive-synthesis.js — 辅助综合入口、人工采集与归档保存。
const ArchiveSynthesis = (() => {
  const button = document.getElementById("ar-synthesize"), status = document.getElementById("ar-status"), root = document.getElementById("ar-detail");
  let entry = null, generation = 0;
  const successful = (result) => typeof result?.text === "string" && result.text.trim();
  const node = (tag, className, text) => { const value = document.createElement(tag); value.className = className || ""; if (text != null) value.textContent = text; return value; };
  const message = (value) => new Promise((resolve) => chrome.runtime.sendMessage(value, (result) => resolve(chrome.runtime.lastError ? null : result)));
  const clearPending = (archiveId) => new Promise((resolve) => chrome.storage.session.get("amsPendingSynthesis", (value) => {
    if (value?.amsPendingSynthesis?.archiveId !== archiveId) return resolve();
    chrome.storage.session.remove("amsPendingSynthesis", resolve);
  }));
  function confirm(container, text, action, run) {
    const row = node("div", "syn-confirm"), label = node("span", "", t(text));
    const yes = node("button", "syn-confirm-yes", t(action)), no = node("button", "", t("con_cancel")); yes.type = no.type = "button";
    yes.addEventListener("click", run); no.addEventListener("click", () => row.replaceChildren()); row.append(label, yes, no); container.appendChild(row);
  }
  async function write(archiveId, synthesis) {
    try { await savePatch(archiveId, { synthesis }); await clearPending(archiveId); status.textContent = t(synthesis ? "syn_savedDone" : "syn_removedDone"); }
    catch (_) { status.textContent = t("arc_updateFailed"); }
  }
  function savedSection(section, value) {
    if (!value) return;
    const box = node("div", "syn-saved"), head = node("div", "syn-saved-head");
    const site = SITES.find((item) => item.host === value.host), tier = value.state === "think" ? t("con_mdThink") : value.state === "fast" ? t("con_mdFast") : "";
    head.append(node("h2", "", t("syn_saved")), node("span", "", (site?.label || value.host) + (tier ? " · " + tier : "")));
    const body = node("div", "syn-saved-body"); renderMd(value.text, body);
    const remove = node("button", "syn-remove", t("syn_remove")); remove.type = "button";
    remove.addEventListener("click", () => confirm(box, "syn_removeConfirm", "syn_remove", () => write(entry.id, null)));
    box.append(head, body, remove); section.appendChild(box);
  }
  function collectSection(section, pending, renderId) {
    const box = node("div", "syn-pending"), collect = node("button", "syn-collect", t("syn_collect")); collect.type = "button"; box.appendChild(collect); section.appendChild(box);
    collect.addEventListener("click", async () => {
      const site = SITES.find((item) => item.host === pending.targetHost); if (!site) { status.textContent = t("syn_collectFailed"); return; }
      collect.disabled = true; status.textContent = t("syn_collecting");
      const response = await message({ source: "AMS_CONSOLE", action: "collect", sites: [site] }), result = response?.results?.find((item) => item.host === site.host && successful(item));
      if (renderId !== generation) return;
      collect.disabled = false;
      if (!result) { status.textContent = t("syn_collectFailed"); return; }
      status.textContent = ""; const preview = node("div", "syn-collected"); renderMd(result.text, preview);
      const save = node("button", "syn-save", t(entry.synthesis ? "syn_replace" : "syn_save")); save.type = "button";
      const synthesis = { host: site.host, text: result.text, state: result.state || null, instruction: pending.instruction || "", createdAt: Date.now() };
      save.addEventListener("click", () => entry.synthesis ? confirm(box, "syn_replaceConfirm", "syn_replace", () => write(entry.id, synthesis)) : write(entry.id, synthesis));
      box.replaceChildren(preview, save);
    });
  }
  function render(value) {
    entry = value; const renderId = ++generation;
    button.hidden = !entry || (entry.results || []).filter(successful).length < 2;
    if (!entry) return;
    chrome.storage.session.get("amsPendingSynthesis", (stored) => {
      if (renderId !== generation || entry?.id !== value.id) return;
      const pending = stored?.amsPendingSynthesis?.archiveId === value.id ? stored.amsPendingSynthesis : null;
      if (!value.synthesis && !pending) return;
      const section = node("section", "ar-synthesis"); savedSection(section, value.synthesis); if (pending) collectSection(section, pending, renderId); root.appendChild(section);
    });
  }
  button.addEventListener("click", () => {
    if (!entry || button.hidden) return;
    const context = { archiveId: entry.id, task: entry.task || "", source: entry.source || null,
      results: entry.results.filter(successful).map(({ host, label, text, state }) => ({ host, label, text, state: state || null })) };
    chrome.storage.session.set({ amsComposeSynthesis: context }, () => {
      if (chrome.runtime.lastError) { status.textContent = t("syn_openFailed"); return; }
      chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openCompose", mode: "synthesis" });
    });
  });
  return { render };
})();
