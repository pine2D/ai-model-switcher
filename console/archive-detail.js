// console/archive-detail.js — 归档详情与人工评价控件
const ArchiveDetail = (() => {
  let cancelPendingNote = () => {};
  let renderGeneration = 0;
  let lastFocusEntryId = null; // 同条目重渲染时用于续接备注焦点/选区（F112）
  const savingNotes = new Set();
  const successful = (result) => typeof result?.text === "string" && result.text.trim();
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const field = (text, control) => { const label = node("label", "ar-field", text); label.appendChild(control); return label; };
  function sourceUrl(source) {
    try { const url = new URL(source?.url); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch (_) { return null; }
  }
  function question(entry) {
    if (entry.task) return entry.task;
    const source = String(entry.source?.title || "").replace(/[\r\n]+/g, " ").trim();
    return source || sourceUrl(entry.source) || entry.text || "";
  }
  const markdownText = (value) => String(value).replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
  const markdownUrl = (value) => value.replace(/[()]/g, (char) => char === "(" ? "%28" : "%29").replace(/\s/g, (char) => encodeURIComponent(char));
  function entryMarkdown(entry, errorText = () => t("con_errNoAnswer")) {
    const markdown = ["# " + t("arc_question"), "\n" + question(entry)];
    const url = sourceUrl(entry.source);
    if (url) markdown.push("\n**" + t("arc_source") + "**: [" + markdownText(entry.source.title || url) + "](" + markdownUrl(url) + ")");
    for (const result of entry.results || []) {
      const tier = result.state === "think" ? " · " + t("con_mdThink") : result.state === "fast" ? " · " + t("con_mdFast") : "";
      markdown.push("\n## " + result.label + tier);
      if (successful(result) && entry.winnerHost === result.host) markdown.push("\n**" + t("arc_bestAnswer", result.label) + "**");
      markdown.push("\n" + (successful(result) ? result.text : "> " + errorText(result)));
    }
    if (entry.synthesis) {
      const site = typeof SITES === "undefined" ? null : SITES.find((item) => item.host === entry.synthesis.host);
      const tier = entry.synthesis.state === "think" ? t("con_mdThink") : entry.synthesis.state === "fast" ? t("con_mdFast") : "";
      markdown.push("\n## " + t("syn_saved"), "\n**" + t("syn_target") + "**: " + (site?.label || entry.synthesis.host) + (tier ? " · " + tier : ""), "\n" + entry.synthesis.text);
    }
    return markdown.join("\n");
  }
  function render(entry, { update, errorText, draft = {}, onDraft = () => {} }) {
    const generation = ++renderGeneration;
    cancelPendingNote();
    const root = document.getElementById("ar-detail");
    // 同条目重渲染（如收藏/胜出点击成功后的重绘）不该打断正在输入的备注：先记下光标，重建 DOM 后按 id 续接
    const activeNote = document.activeElement;
    const noteFocus = (entry.id === lastFocusEntryId && activeNote && activeNote.id === "ar-note")
      ? { start: activeNote.selectionStart, end: activeNote.selectionEnd } : null;
    const save = (patch) => Promise.resolve().then(() => update(entry.id, patch)).then(() => true, () => false);
    root.replaceChildren(node("h1", "ar-question", question(entry)));
    const capturedAt = new Date(Number(entry.ts || entry.createdAt));
    if (capturedAt.getTime() > 0) {
      const captured = node("time", "ar-captured", t("arc_capturedAt", capturedAt.toLocaleString(document.documentElement.lang || undefined)));
      captured.setAttribute("datetime", capturedAt.toISOString()); root.appendChild(captured);
    }
    const url = sourceUrl(entry.source);
    if (url) {
      const source = node("div", "ar-source", t("arc_source") + ": ");
      const link = node("a", "", entry.source.title || url);
      link.setAttribute("href", url); link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener");
      source.appendChild(link); root.appendChild(source);
    }
    const controls = node("div", "ar-controls");
    const favorite = node("button", "ar-favorite", t("arc_favorites"));
    favorite.id = "ar-favorite"; favorite.type = "button"; favorite.setAttribute("aria-pressed", String(!!entry.favorite));
    favorite.addEventListener("click", () => save({ favorite: !entry.favorite }));
    const tags = node("input", "ar-tags"); tags.id = "ar-tags";
    tags.value = Object.prototype.hasOwnProperty.call(draft, "tags") ? draft.tags : (entry.tags || []).join(", ");
    tags.setAttribute("aria-label", t("arc_tags"));
    const saveTags = () => { onDraft(entry.id, { tags: tags.value }); return save({ tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) }); };
    tags.addEventListener("input", () => onDraft(entry.id, { tags: tags.value }));
    tags.addEventListener("change", saveTags);
    tags.addEventListener("keydown", (event) => { if (event.key === "Enter") saveTags(); });
    const note = node("textarea", "ar-note"); note.id = "ar-note"; note.maxLength = 4000;
    const hasNoteDraft = Object.prototype.hasOwnProperty.call(draft, "note");
    note.value = hasNoteDraft ? draft.note : entry.note || "";
    note.setAttribute("aria-label", t("arc_note"));
    const noteKey = (value) => JSON.stringify([entry.id, value]);
    let noteTimer, noteSaving = false, pendingNote = hasNoteDraft ? note.value : null;
    cancelPendingNote = () => { clearTimeout(noteTimer); noteTimer = null; };
    const saveNote = () => {
      clearTimeout(noteTimer); noteTimer = null;
      if (generation !== renderGeneration || pendingNote === null || noteSaving) return;
      const value = pendingNote, key = noteKey(value);
      if (savingNotes.has(key)) return;
      noteSaving = true; savingNotes.add(key);
      save({ note: value }).then((ok) => {
        savingNotes.delete(key);
        if (generation !== renderGeneration) return;
        noteSaving = false;
        if (ok && pendingNote === value) pendingNote = null;
        else if (pendingNote !== value) saveNote();
      });
    };
    note.addEventListener("input", () => {
      onDraft(entry.id, { note: note.value }); pendingNote = note.value;
      clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 400);
    });
    note.addEventListener("blur", saveNote);
    if (hasNoteDraft && !savingNotes.has(noteKey(note.value))) noteTimer = setTimeout(saveNote, 400);
    controls.append(favorite, field(t("arc_tags"), tags), field(t("arc_note"), note)); root.appendChild(controls);
    const nav = node("nav", "ar-sites"); nav.setAttribute("aria-label", t("arc_sites"));
    const sections = [];
    (entry.results || []).forEach((result, index) => {
      const section = node("section", "ar-answer"); section.id = "ar-answer-" + index;
      const navButton = node("button", "", result.label); navButton.type = "button";
      navButton.addEventListener("click", () => section.scrollIntoView?.({ behavior: "smooth", block: "start" })); nav.appendChild(navButton);
      const heading = node("div", "ar-answer-head");
      const tier = result.state === "think" ? " · " + t("con_mdThink") : result.state === "fast" ? " · " + t("con_mdFast") : "";
      heading.appendChild(node("h2", "", result.label + tier));
      if (successful(result)) {
        const winner = node("button", "ar-winner", t(entry.winnerHost === result.host ? "arc_unmarkBest" : "arc_best"));
        winner.type = "button"; winner.setAttribute("aria-pressed", String(entry.winnerHost === result.host));
        winner.addEventListener("click", () => save({ winnerHost: entry.winnerHost === result.host ? null : result.host })); heading.appendChild(winner);
      }
      const body = node("div", "ar-answer-body"); renderMd(successful(result) ? result.text : "> " + errorText(result), body);
      section.append(heading, body); sections.push(section);
    });
    root.appendChild(nav); root.append(...sections);
    if (noteFocus) {
      note.focus();
      const len = note.value.length; // value 已在上方写好，裁剪选区防止越界
      note.setSelectionRange(Math.min(noteFocus.start, len), Math.min(noteFocus.end, len));
    }
    lastFocusEntryId = entry.id;
  }
  return { render, entryMarkdown, question };
})();
