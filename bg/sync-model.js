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
      const version = (value) => Math.max(Number(value?.updatedAt) || 0, Number(value?.deletedAt) || 0, Number(value?.lastUsedAt) || 0);
      const wins = !old || version(item) > version(old) || version(item) === version(old) &&
        (Object.hasOwn(item, "deletedAt") !== Object.hasOwn(old, "deletedAt") ? Object.hasOwn(item, "deletedAt") :
          String(item.deviceId || "").localeCompare(String(old.deviceId || "")) > 0);
      if (wins) byHash.set(item.textHash, item);
    }
    return [...byHash.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  // 归档合并的权威实现在 bg/data.js 的 newer() 与 bg/store.js 的 compareEntityVersion()，这里不再另写一份。

  // 未来 schema 只读锁：记住每个触发只读的文件及其 schema。差集清空即解锁，本机 SCHEMA 追平（升级后
  // 记下的 schema 不再大于 SCHEMA）也解锁。saved 缺失但配置已只读且本批没抓到任何未来文件 = 旧版留下的
  // 锁，补一枚哨兵维持「只有全量重扫/清空云端才解锁」的既有语义，避免升级当天空 changes 直接放开上行。
  const FUTURE_STATE = " state", FUTURE_LEGACY = " legacy";
  function futureFiles(saved, collected = {}, replace = false, stateReadOnly = false, wasReadOnly = false) {
    const seen = collected.futureFiles || new Map();
    const legacy = !saved && wasReadOnly && !seen.size ? { [FUTURE_LEGACY]: SCHEMA + 1 } : {};
    const files = replace ? {} : { ...(saved || legacy) };
    delete files[FUTURE_STATE];
    for (const fileId of collected.removedStates || []) delete files[fileId];
    for (const [fileId, schema] of seen) files[fileId] = Number(schema) || SCHEMA + 1;
    if (stateReadOnly) files[FUTURE_STATE] = SCHEMA + 1;
    return { files, locked: Object.values(files).some((schema) => Number(schema) > SCHEMA) };
  }

  // 上行正文完整性：与下行 validBody 的「正文存在性」判定同源，防止被 trimBodies 裁空的壳记录
  // PATCH 覆盖云端好副本。元数据形状由 ArchiveModel 在写入侧保证，这里只看正文是否还在。
  function completeBody(kind, body) {
    if (!body || typeof body !== "object") return false;
    if (kind === "state" || Object.hasOwn(body, "deletedAt")) return true;
    return typeof body.text === "string" && (kind !== "archive" || Array.isArray(body.results));
  }

  return { SCHEMA, validTime, compareVersion, hashText, utf8Preview, retryDelay, mergeStateFragments, mergeHistory, futureFiles, completeBody };
})();
