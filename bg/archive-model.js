// bg/archive-model.js — 归档元数据规范化、更新与筛选
const ArchiveModel = (() => {
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const clean = (value) => String(value || "").trim();
  const preview = (value) => [...clean(value)].slice(0, 320).join("");
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
      capturedAt: Number.isSafeInteger(value.capturedAt) ? value.capturedAt : 0 };
  }
  const successful = (value) => (value.results || []).filter((item) => item && typeof item.text === "string" && item.text.trim());
  function searchable(value) {
    return [value.task, value.source?.title, value.source?.url, value.note,
      ...(value.tags || []), ...(value.results || []).map((item) => item.label),
      ...(value.resultPreviews || []).map((item) => item.text)].filter(Boolean).join("\n").toLocaleLowerCase();
  }
  function normalize(entry = {}, { id, now, deviceId }) {
    const results = Array.isArray(entry.results) ? entry.results : [], task = clean(entry.task || entry.text);
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
    const allowed = new Set(["favorite", "tags", "note", "winnerHost"]);
    if (!object(patch) || Object.keys(patch).some((key) => !allowed.has(key))) throw new Error("invalid_patch");
    const next = { ...record, updatedAt: now, deviceId };
    if (own(patch, "favorite")) { if (typeof patch.favorite !== "boolean") throw new Error("invalid_favorite"); next.favorite = patch.favorite; }
    if (own(patch, "tags")) next.tags = cleanTags(patch.tags);
    if (own(patch, "note")) { if (typeof patch.note !== "string" || [...patch.note].length > 4000) throw new Error("invalid_note"); next.note = patch.note; }
    if (own(patch, "winnerHost")) {
      const host = patch.winnerHost == null ? null : clean(patch.winnerHost);
      if (host && !successful(record).some((item) => item.host === host)) throw new Error("invalid_winner");
      next.winnerHost = host;
    }
    next.searchText = searchable(next);
    return next;
  }
  function matches(record, filters = {}) {
    const query = clean(filters.query).toLocaleLowerCase(), tag = clean(filters.tag);
    return (!query || String(record.searchText || searchable(record)).includes(query)) &&
      (!filters.favorite || record.favorite === true) && (!tag || (record.tags || []).includes(tag));
  }
  function validMetadata(record) {
    try {
      if (!object(record) || typeof record.task !== "string" || typeof record.favorite !== "boolean" ||
        typeof record.note !== "string" || [...record.note].length > 4000 || !Array.isArray(record.hosts) ||
        !Array.isArray(record.resultPreviews) || typeof record.searchText !== "string") return false;
      cleanSource(record.source); cleanTags(record.tags);
      return !record.winnerHost || successful(record).some((item) => item.host === record.winnerHost);
    } catch (_) { return false; }
  }
  return { normalize, update, matches, validMetadata };
})();
