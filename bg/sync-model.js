const SyncModel = (() => {
  const SCHEMA = 1;
  const validTime = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
  const compareVersion = (a = {}, b = {}) =>
    (Number(a.updatedAt) - Number(b.updatedAt)) || String(a.deviceId || "").localeCompare(String(b.deviceId || ""));

  async function hashText(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function utf8Preview(text, maxBytes = 96) {
    let out = "", used = 0;
    for (const char of String(text || "")) {
      const size = new TextEncoder().encode(char).length;
      if (used + size > maxBytes) break;
      out += char;
      used += size;
    }
    return out;
  }

  function retryDelay(attempt, random = Math.random) {
    const base = Math.min(15 * 60_000, 1000 * (2 ** Math.max(0, attempt)));
    return Math.round(base * (0.75 + random() * 0.5));
  }

  const stamp = (item = {}) => ({
    updatedAt: Math.max(Number(item.updatedAt) || 0, Number(item.deletedAt) || 0),
    deviceId: item.deviceId || "",
  });
  const newer = (a, b) => !a || compareVersion(stamp(b), stamp(a)) > 0 ? b : a;

  function mergeStateFragments(fragments) {
    const settings = {}, templates = new Map(), groups = new Map();
    let readOnly = false, corrupt = 0;
    for (const fragment of fragments || []) {
      if (!fragment || typeof fragment !== "object") { corrupt++; continue; }
      if (Number(fragment.schema) > SCHEMA) readOnly = true;
      for (const [key, value] of Object.entries(fragment.settings || {})) {
        if (!value || !validTime(value.updatedAt) || Object.hasOwn(value, "deletedAt") && !validTime(value.deletedAt)) { corrupt++; continue; }
        settings[key] = newer(settings[key], value);
      }
      for (const [kind, target] of [["templates", templates], ["groups", groups]]) {
        for (const value of Object.values(fragment[kind] || {})) {
          if (!value?.id || !validTime(value.updatedAt) || Object.hasOwn(value, "deletedAt") && !validTime(value.deletedAt)) { corrupt++; continue; }
          target.set(value.id, newer(target.get(value.id), value));
        }
      }
    }
    const all = (map) => Object.fromEntries(map);
    const materialized = { schema: SCHEMA, settings, templates: all(templates), groups: all(groups) };
    const active = (map) => [...map.values()].filter((item) => !Object.hasOwn(item, "deletedAt"));
    return { settings, templates: active(templates), groups: active(groups), materialized, readOnly, corrupt };
  }

  function mergeHistory(records) {
    const byHash = new Map();
    for (const item of records || []) {
      if (!item?.textHash) continue;
      const old = byHash.get(item.textHash);
      if (!old || Number(item.lastUsedAt) > Number(old.lastUsedAt)) byHash.set(item.textHash, item);
    }
    return [...byHash.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  function mergeArchives(records) {
    const byId = new Map();
    for (const item of records || []) if (item?.id) byId.set(item.id, newer(byId.get(item.id), item));
    return [...byId.values()].filter((item) => !Object.hasOwn(item, "deletedAt") || item.deletedAt < item.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  return { SCHEMA, validTime, compareVersion, hashText, utf8Preview, retryDelay, mergeStateFragments, mergeHistory, mergeArchives };
})();
