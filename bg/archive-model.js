// bg/archive-model.js — 归档元数据规范化、更新与筛选
const ArchiveModel = (() => {
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const clean = (value) => String(value || "").trim();
  const preview = (value) => [...clean(value)].slice(0, 320).join("");
  const bounded = (value, max, nullable = false) => nullable && value == null || typeof value === "string" && [...value].length <= max;
  const exactKeys = (value, required, optional = []) => object(value) && required.every((key) => own(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
  function cleanTags(values) {
    if (!Array.isArray(values) || values.length > 20) throw new Error("invalid_tags");
    const out = [...new Set(values.map(clean).filter(Boolean))];
    if (out.some((value) => [...value].length > 32)) throw new Error("invalid_tags");
    return out;
  }
  function cleanSource(value) {
    if (value == null) return null;
    if (!object(value) || !["page", "selection"].includes(value.kind) || typeof value.url !== "string") throw new Error("invalid_source");
    let url;
    try { url = new URL(value.url); } catch (_) { throw new Error("invalid_source"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid_source");
    return { kind: value.kind, title: clean(value.title), url: url.href, truncated: !!value.truncated,
      capturedAt: Number.isSafeInteger(value.capturedAt) && value.capturedAt >= 0 ? value.capturedAt : 0 };
  }
  function cleanSynthesis(value) {
    if (value == null) return null;
    if (!exactKeys(value, ["host", "text", "state", "instruction", "createdAt"]) || !clean(value.host) || !bounded(clean(value.host), 256) ||
      typeof value.text !== "string" || !value.text.trim() || typeof value.instruction !== "string" || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || value.createdAt > 8_640_000_000_000_000)
      throw new Error("invalid_synthesis");
    return { host: clean(value.host), text: value.text, state: ["think", "fast"].includes(value.state) ? value.state : null,
      instruction: clean(value.instruction), createdAt: value.createdAt };
  }
  const successful = (value) => (value.results || []).filter((item) => item && typeof item.text === "string" && item.text.trim());
  function searchable(value) {
    return [value.task, value.source?.title, value.source?.url, value.note,
      ...(value.tags || []), ...(value.results || []).map((item) => item.label),
      ...(value.resultPreviews || []).map((item) => item.text), preview(value.synthesis?.text)].filter(Boolean).join("\n").toLowerCase();
  }
  function normalize(entry = {}, { id, now, deviceId }) {
    const results = Array.isArray(entry.results) ? entry.results : [], task = clean(typeof entry.task === "string" ? entry.task : entry.text);
    const record = { ...entry, id, text: String(entry.text || ""), task, source: cleanSource(entry.source), results,
      favorite: false, tags: [], note: "", winnerHost: null, synthesis: null,
      hosts: results.map((item) => clean(item.host)).filter(Boolean),
      resultPreviews: successful({ results }).map((item) => ({ host: clean(item.host), label: clean(item.label), text: preview(item.text) })),
      createdAt: Number(entry.createdAt) || now, updatedAt: Number(entry.updatedAt) || now,
      ts: Number(entry.ts) || Number(entry.createdAt) || now, deviceId };
    record.searchText = searchable(record);
    return record;
  }
  function update(record, patch = {}, { now, deviceId }) {
    const allowed = new Set(["favorite", "tags", "note", "winnerHost", "synthesis"]);
    if (!object(patch) || Object.keys(patch).some((key) => !allowed.has(key))) throw new Error("invalid_patch");
    if (!validMetadata(record)) throw new Error("invalid_record");
    const next = { ...record, updatedAt: now, deviceId };
    if (own(patch, "favorite")) { if (typeof patch.favorite !== "boolean") throw new Error("invalid_favorite"); next.favorite = patch.favorite; }
    if (own(patch, "tags")) next.tags = cleanTags(patch.tags);
    if (own(patch, "note")) { if (typeof patch.note !== "string" || [...patch.note].length > 4000) throw new Error("invalid_note"); next.note = patch.note; }
    if (own(patch, "winnerHost")) {
      const host = patch.winnerHost == null ? null : clean(patch.winnerHost);
      if (host && !successful(record).some((item) => item.host === host)) throw new Error("invalid_winner");
      next.winnerHost = host;
    }
    if (own(patch, "synthesis")) next.synthesis = cleanSynthesis(patch.synthesis);
    next.searchText = searchable(next);
    return next;
  }
  function matches(record, filters = {}) {
    const query = clean(filters.query).toLowerCase(), tag = clean(filters.tag);
    return (!query || String(record.searchText || searchable(record)).includes(query)) &&
      (!filters.favorite || record.favorite === true) && (!tag || (record.tags || []).includes(tag));
  }
  function validMetadata(record) {
    try {
      const required = ["task", "source", "favorite", "tags", "note", "winnerHost", "synthesis", "hosts", "resultPreviews", "searchText"];
      if (!object(record) || required.some((key) => !own(record, key)) || typeof record.task !== "string" || record.task !== clean(record.task) ||
        typeof record.favorite !== "boolean" || !bounded(record.note, 4000) || !Array.isArray(record.results) ||
        !Array.isArray(record.hosts) || !Array.isArray(record.resultPreviews) || typeof record.searchText !== "string") return false;
      if (record.source !== null) {
        if (!exactKeys(record.source, ["kind", "title", "url", "truncated", "capturedAt"]) || typeof record.source.title !== "string" ||
          record.source.title !== clean(record.source.title) || typeof record.source.truncated !== "boolean" || !Number.isSafeInteger(record.source.capturedAt)) return false;
        const source = cleanSource(record.source);
        if (source.url !== record.source.url || source.capturedAt !== record.source.capturedAt) return false;
      }
      const validResult = (item) => exactKeys(item, ["host", "label", "text"], ["state", "code"]) &&
        bounded(item.host, 256) && item.host === clean(item.host) && !!item.host && bounded(item.label, 256) && item.label === clean(item.label) &&
        (item.text == null || typeof item.text === "string") && bounded(item.state, 64, true) && bounded(item.code, 64, true);
      const validPreview = (item) => exactKeys(item, ["host", "label", "text"]) && bounded(item.host, 256) && bounded(item.label, 256) && bounded(item.text, 320);
      if (!record.results.every(validResult) || !record.resultPreviews.every(validPreview)) return false;
      const tags = cleanTags(record.tags), hosts = record.results.map((item) => clean(item.host)).filter(Boolean);
      const previews = successful(record).map((item) => ({ host: clean(item.host), label: clean(item.label), text: preview(item.text) }));
      if (tags.length !== record.tags.length || tags.some((item, at) => item !== record.tags[at]) || hosts.length !== record.hosts.length ||
        hosts.some((item, at) => item !== record.hosts[at]) || previews.length !== record.resultPreviews.length ||
        previews.some((item, at) => Object.keys(item).some((key) => item[key] !== record.resultPreviews[at][key]))) return false;
      if (record.winnerHost !== null && (!bounded(record.winnerHost, 256) || record.winnerHost !== clean(record.winnerHost) ||
        !successful(record).some((item) => item.host === record.winnerHost))) return false;
      const synthesis = cleanSynthesis(record.synthesis);
      if (synthesis && Object.keys(synthesis).some((key) => synthesis[key] !== record.synthesis[key])) return false;
      return record.searchText === searchable(record);
    } catch (_) { return false; }
  }
  return { normalize, update, matches, validMetadata };
})();
