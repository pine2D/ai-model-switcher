// console/archive-detail.js — 归档详情与人工评价控件
const ArchiveDetail = (() => {
  const successful = (result) => typeof result?.text === "string" && result.text.trim();
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const field = (text, control) => { const label = node("label", "ar-field", text); label.appendChild(control); return label; };
  function entryMarkdown(entry, errorText = (result) => result.code || t("con_errNoAnswer")) {
    const markdown = ["# " + t("arc_question"), "\n" + (entry.task || entry.text || "")];
    if (entry.source?.url) markdown.push("\n**" + t("arc_source") + "**: [" + (entry.source.title || entry.source.url) + "](" + entry.source.url + ")");
    for (const result of entry.results || []) {
      const tier = result.state === "think" ? " · " + t("con_mdThink") : result.state === "fast" ? " · " + t("con_mdFast") : "";
      markdown.push("\n## " + result.label + tier);
      if (successful(result) && entry.winnerHost === result.host) markdown.push("\n**" + t("arc_bestAnswer", result.label) + "**");
      markdown.push("\n" + (successful(result) ? result.text : "> " + errorText(result)));
    }
    return markdown.join("\n");
  }
  function render(entry, { update, errorText }) {
    const root = document.getElementById("ar-detail");
    const save = (patch) => Promise.resolve().then(() => update(patch)).catch(() => {});
    root.replaceChildren(node("h1", "ar-question", entry.task || entry.text || ""));
    if (entry.source?.url) {
      const source = node("div", "ar-source", t("arc_source") + ": ");
      const link = node("a", "", entry.source.title || entry.source.url);
      link.setAttribute("href", entry.source.url); link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener");
      source.appendChild(link); root.appendChild(source);
    }
    const controls = node("div", "ar-controls");
    const favorite = node("button", "ar-favorite", t("arc_favorite"));
    favorite.id = "ar-favorite"; favorite.type = "button"; favorite.setAttribute("aria-pressed", String(!!entry.favorite));
    favorite.addEventListener("click", () => save({ favorite: !entry.favorite }));
    const tags = node("input", "ar-tags"); tags.id = "ar-tags"; tags.value = (entry.tags || []).join(", ");
    tags.setAttribute("aria-label", t("arc_tags"));
    const saveTags = () => save({ tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) });
    tags.addEventListener("change", saveTags);
    tags.addEventListener("keydown", (event) => { if (event.key === "Enter") saveTags(); });
    const note = node("textarea", "ar-note"); note.id = "ar-note"; note.value = entry.note || "";
    note.setAttribute("aria-label", t("arc_note"));
    let noteTimer;
    note.addEventListener("input", () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => save({ note: note.value }), 400); });
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
        const winner = node("button", "ar-winner", t("arc_markBest"));
        winner.type = "button"; winner.setAttribute("aria-pressed", String(entry.winnerHost === result.host));
        winner.addEventListener("click", () => save({ winnerHost: entry.winnerHost === result.host ? null : result.host })); heading.appendChild(winner);
      }
      const body = node("div", "ar-answer-body"); renderMd(successful(result) ? result.text : "> " + errorText(result), body);
      section.append(heading, body); sections.push(section);
    });
    root.appendChild(nav); root.append(...sections);
  }
  return { render, entryMarkdown };
})();
