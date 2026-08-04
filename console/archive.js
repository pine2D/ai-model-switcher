// console/archive.js — 归档页：管理汇总复制/导出时定格的「问题+各站回答」快照。
applyI18n();
const elList = document.getElementById("ar-list");
const elDetail = document.getElementById("ar-detail");
const elCopy = document.getElementById("ar-copy");
const elExport = document.getElementById("ar-export");
const elDel = document.getElementById("ar-del");
const elSearch = document.getElementById("ar-search");
const elFavorites = document.getElementById("ar-favorites");
const elTag = document.getElementById("ar-tag");
let archive = [];
let archiveCursor = null, selectedId = null;
let filters = { query: "", favorite: false, tag: "" }, searchToken = 0, searchTimer, pageToken = null;
const ownChangeTokens = new Set();
const ARCH_ERR_KEYS = { timeout: "con_errTimeout", composer_not_found: "con_errNoComposer", inject_failed: "con_errInject",
  submit_unconfirmed: "con_errSubmit", tier_unconfirmed: "con_errTier", no_window: "con_errNoWindow",
  not_ready: "con_errNotReady", cancelled: "con_errCancelled", no_answer: "con_errNoAnswer", error: "con_errGeneric" };
function resultError(r) { return t(ARCH_ERR_KEYS[r.code] || "con_errNoAnswer"); }

function entryMd(e) { return ArchiveDetail.entryMarkdown(e, resultError); }
// 详情区极简行级渲染（标题/引用/围栏/行内粗体，其余原样）：回看场景读内容而非 md 源码；
// 「复制」仍取 entryMd 源文（看=渲染，复制=可再粘贴的 Markdown）。全程 textContent 组装，无注入面。
function renderMd(md, box) {
  const add = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; box.appendChild(n); return n; };
  // 围栏状态机记录开栏长度：md.js 对含 ``` 的代码主动升级四反引号外栏（本项目正常产物），
  // 闭栏必须 ≥ 开栏长度且行内仅反引号——内层 ``` 不再提前截断（对抗审查批 B）
  let fenceLen = 0, codeBuf = [];
  for (const ln of md.split("\n")) {
    const f = ln.match(/^(`{3,})(.*)$/);
    if (fenceLen) {
      if (f && f[1].length >= fenceLen && !f[2].trim()) { add("pre", "ar-code", codeBuf.join("\n")); codeBuf = []; fenceLen = 0; }
      else codeBuf.push(ln);
      continue;
    }
    if (f) { fenceLen = f[1].length; continue; } // 开栏（f[2] 为语言标记，渲染不需要）
    const h = ln.match(/^(#{1,4})\s+(.*)/);
    if (h) { add("div", "ar-mh ar-mh" + h[1].length, h[2]); continue; }
    if (/^>\s?/.test(ln)) { add("div", "ar-quote", ln.replace(/^>\s?/, "")); continue; }
    const p = add("div", "ar-p");
    ln.split(/(\*\*[^*]+\*\*)/).forEach((seg) => {
      if (/^\*\*[^*]+\*\*$/.test(seg)) { const b = document.createElement("b"); b.textContent = seg.slice(2, -2); p.appendChild(b); }
      else if (seg) p.appendChild(document.createTextNode(seg));
    });
  }
  if (fenceLen && codeBuf.length) add("pre", "ar-code", codeBuf.join("\n")); // 未闭合围栏兜底
}
function currentEntry() {
  return archive.find((entry) => entry.id === selectedId) || null;
}
function replaceEntry(record) {
  const updateDetail = selectedId === record.id;
  archive = archive.map((entry) => entry.id === record.id ? record : entry);
  renderList(undefined, updateDetail);
}
function renderList(preferredId, updateDetail = true) {
  selectedId = archive.some((entry) => entry.id === preferredId) ? preferredId
    : archive.some((entry) => entry.id === selectedId) ? selectedId : archive[0] && archive[0].id;
  disarmDel();
  elList.replaceChildren();
  archive.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "ar-item"; button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(entry.id === selectedId));
    const date = document.createElement("time"); date.textContent = new Date(entry.ts).toLocaleString(document.documentElement.lang || undefined);
    const question = document.createElement("span");
    const text = entry.task || entry.preview || entry.text || "";
    question.textContent = text.length > 52 ? text.slice(0, 52) + "…" : (text || "—");
    button.append(date, question);
    if (entry.favorite || entry.tags?.length) {
      const badges = document.createElement("div"); badges.className = "ar-badges";
      for (const text of [...(entry.favorite ? [t("arc_favorites")] : []), ...(entry.tags || [])]) {
        const badge = document.createElement("span"); badge.className = "ar-badge"; badge.textContent = text; badges.appendChild(badge);
      }
      button.appendChild(badges);
    }
    button.addEventListener("click", () => { selectedId = entry.id; renderList(entry.id); });
    elList.appendChild(button);
  });
  document.getElementById("ar-more").hidden = !archiveCursor;
  if (!updateDetail) return;
  elDetail.setAttribute("data-empty", t("arc_empty")); showCurrent();
  const current = currentEntry(); if (current && !current.results) loadEntry(current);
}
function showCurrent() {
  const e = currentEntry();
  elDetail.replaceChildren();
  if (e && e.results) ArchiveDetail.render(e, { update: savePatch, errorText: resultError });
  elCopy.disabled = elExport.disabled = elDel.disabled = !e || !e.results;
}
function dataMessage(action, payload, done) {
  chrome.runtime.sendMessage({ source: "AMS_DATA", action, ...payload }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) { document.getElementById("ar-status").textContent = t(action === "archiveDelete" ? "arc_deleteFailed" : "arc_loadFailed"); return; }
    if (done) done(res);
  });
}
function loadPage(reset, preferredId, token = searchToken) {
  if (!reset && pageToken === token) return;
  if (!reset) pageToken = token;
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveSearch", cursor: reset ? null : archiveCursor, limit: 50, filters: { ...filters } }, (res) => {
    void chrome.runtime.lastError;
    if (!reset && pageToken === token) pageToken = null;
    if (token !== searchToken) return;
    if (!res || !res.ok) { document.getElementById("ar-status").textContent = t("arc_loadFailed"); return; }
    archive = reset ? res.items || [] : archive.concat(res.items || []);
    archiveCursor = res.nextCursor || null; document.getElementById("ar-status").textContent = ""; renderList(preferredId);
  });
}
function refreshSearch(preferredId, delay = 0) {
  const token = ++searchToken, preferred = preferredId || selectedId;
  archive = []; archiveCursor = null; elList.replaceChildren(); document.getElementById("ar-more").hidden = true; showCurrent();
  if (searchTimer) clearTimeout(searchTimer);
  const run = () => loadPage(true, preferred, token);
  searchTimer = delay ? setTimeout(run, delay) : (run(), null);
}
function loadTags() {
  if (!elTag) return;
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveTags" }, (res) => {
    void chrome.runtime.lastError;
    if (!res?.ok) return;
    const tags = res.tags || [], selected = filters.tag;
    const all = document.createElement("option"); all.value = ""; all.textContent = t("arc_allTags");
    elTag.replaceChildren(all);
    for (const tag of tags) { const option = document.createElement("option"); option.value = tag; option.textContent = tag; elTag.appendChild(option); }
    filters.tag = tags.includes(selected) ? selected : ""; elTag.value = filters.tag;
    if (selected && !filters.tag) refreshSearch();
  });
}
function savePatch(id, patch) {
  const changeToken = crypto.randomUUID();
  if (ownChangeTokens.size >= 100) ownChangeTokens.delete(ownChangeTokens.values().next().value);
  ownChangeTokens.add(changeToken);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveUpdate", id, patch, changeToken }, (res) => {
      if (chrome.runtime.lastError || !res?.ok || !res.record) {
        ownChangeTokens.delete(changeToken);
        document.getElementById("ar-status").textContent = t("arc_updateFailed"); reject(new Error("archive_update_failed")); return;
      }
      replaceEntry(res.record); loadTags(); document.getElementById("ar-status").textContent = ""; resolve(res.record);
    });
  });
}
function loadEntry(entry) {
  if (entry.results) return;
  chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveGet", id: entry.id }, (res) => {
    void chrome.runtime.lastError;
    if (!res || !res.ok) { document.getElementById("ar-status").textContent = t("arc_loadFailed"); return; }
    if (!res.record || !res.record.results) { document.getElementById("ar-status").textContent = t("arc_loadFailed"); return; }
    archive = archive.map((item) => item.id === entry.id ? res.record : item);
    if (selectedId === entry.id) renderList(entry.id);
  });
}
document.getElementById("ar-more").addEventListener("click", () => loadPage(false));
elSearch?.addEventListener("input", () => { filters.query = elSearch.value; refreshSearch(selectedId, 180); });
elFavorites?.addEventListener("click", () => {
  filters.favorite = !filters.favorite; elFavorites.setAttribute("aria-pressed", String(filters.favorite)); refreshSearch(selectedId);
});
elTag?.addEventListener("change", () => { filters.tag = elTag.value; refreshSearch(selectedId); });
elCopy.addEventListener("click", () => {
  const e = currentEntry();
  if (e) navigator.clipboard.writeText(entryMd(e)).then(() => { elCopy.textContent = t("arc_copied"); setTimeout(() => { elCopy.textContent = t("arc_copy"); }, 1500); });
});
elExport.addEventListener("click", () => {
  const e = currentEntry(); if (!e) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([entryMd(e)], { type: "text/markdown" }));
  const d = new Date(e.ts), p = (n) => String(n).padStart(2, "0");
  a.download = "polyask-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".md";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  document.getElementById("ar-status").textContent = t("arc_exported");
});
document.getElementById("ar-capture").addEventListener("click", (event) => {
  const button = event.currentTarget; if (button.disabled) return;
  chrome.storage.local.get(["amsConsole", "amsConsolePrompt"], (value) => {
    const state = (value && value.amsConsole) || {};
    const sites = SITES.filter((site) => (state.selected || {})[site.host]);
    if (!sites.length) { document.getElementById("ar-status").textContent = t("arc_noSites"); return; }
    chrome.storage.session.get("amsLastRun", (session) => {
      const run = session && session.amsLastRun;
      const matches = Array.isArray(run?.hosts) && run.hosts.length === sites.length && sites.every((site) => run.hosts.includes(site.host));
      const fallback = (value && value.amsConsolePrompt) || "";
      button.disabled = true; document.getElementById("ar-status").textContent = t("arc_capturing");
      chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "collect", sites }, (response) => {
        const byHost = {}; ((response && response.results) || []).forEach((result) => { byHost[result.host] = result; });
        const entry = {
          ts: Date.now(), text: matches ? run.text : fallback, task: matches ? run.task : fallback, source: matches ? run.source || null : null,
          results: sites.map((site) => {
            const result = byHost[site.host] || {};
            return { host: site.host, label: site.label, text: result.text || null, state: result.state || null, code: result.code || null };
          }),
        };
        chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveAdd", entry }, (res) => {
          button.disabled = false;
          if (chrome.runtime.lastError || !res?.ok || !res.record) { document.getElementById("ar-status").textContent = t("arc_saveFailed"); return; }
          selectedId = res.record.id;
          document.getElementById("ar-status").textContent = t("arc_captured", sites.length);
          loadTags(); refreshSearch(selectedId);
        });
      });
    });
  });
});
// 删除二段确认（与 console 删模板/分组的确认保护一致，归档是不可恢复的完整对比现场）：
// 首击按钮变「确认删除？」危险态并绑定目标条目（id 唯一标识），3s 内对同一条目再击才删；
// 超时/换条目/任何重渲染（renderList 首行）都撤销确认——确认目标绝不漂移（对抗审查 F1）。
let delArmedUntil = 0, delArmedId = null;
function disarmDel() { delArmedUntil = 0; delArmedId = null; elDel.textContent = t("arc_del"); elDel.classList.remove("danger"); }
elDel.addEventListener("click", () => {
  const cur = currentEntry();
  if (!cur) return;
  if (Date.now() > delArmedUntil || delArmedId !== cur.id) {
    delArmedUntil = Date.now() + 3000; delArmedId = cur.id;
    elDel.textContent = t("arc_delConfirm"); elDel.classList.add("danger");
    setTimeout(() => { if (delArmedUntil && Date.now() >= delArmedUntil) disarmDel(); }, 3100);
    return;
  }
  disarmDel();
  dataMessage("archiveDelete", { id: cur.id }, () => { loadTags(); refreshSearch(); });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === "AMS_DATA" && msg.type === "archiveChanged") {
    if (msg.changeToken && ownChangeTokens.delete(msg.changeToken)) return;
    loadTags(); refreshSearch(selectedId);
  }
});
refreshSearch(); loadTags();
document.addEventListener("i18n:changed", () => { renderList(); loadTags(); });
