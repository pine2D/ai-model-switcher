// bg/data.js — 本地记录与设备状态协议
const Data = (() => {
  const SETTINGS = ["amsLang", "amsTheme", "displayMode", "amsAutoRaise"];
  const archiveUpdates = new Map();
  let cachedDeviceId, deviceIdOpening;
  const scheduleLocal = () => { if (typeof SyncEngine !== "undefined") SyncEngine.scheduleLocal?.(); };
  async function getDeviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    if (deviceIdOpening) return deviceIdOpening;
    deviceIdOpening = (async () => {
      const saved = await SyncStore.getMeta("deviceId");
      if (saved) { cachedDeviceId = saved; return saved; }
      const created = crypto.randomUUID();
      await SyncStore.putMeta("deviceId", created);
      cachedDeviceId = created;
      return created;
    })();
    try { return await deviceIdOpening; } finally { deviceIdOpening = null; }
  }
  async function deviceState() {
    const id = await getDeviceId(), saved = await SyncStore.getMeta("deviceState");
    return saved && typeof saved === "object" ? { ...saved, schema: SyncModel.SCHEMA, deviceId: id,
      settings: saved.settings || {}, templates: saved.templates || {}, groups: saved.groups || {} } :
      { schema: SyncModel.SCHEMA, deviceId: id, settings: {}, templates: {}, groups: {} };
  }
  async function addHistory(text) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const id = await SyncModel.hashText(clean), now = Date.now(), deviceId = await getDeviceId();
    const old = await SyncStore.getHistory(id);
    const record = { id, textHash: id, text: clean, preview: SyncModel.utf8Preview(clean),
      createdAt: old?.createdAt || now, lastUsedAt: now, deviceId, schema: SyncModel.SCHEMA };
    await SyncStore.putHistory(record);
    await SyncStore.enqueue({ key: `history:${id}:${deviceId}`, kind: "history", entityId: id, nextAt: 0, attempt: 0 });
    await SyncStore.trimBodies(200, 50);
    scheduleLocal();
    return record;
  }
  async function addArchive(entry = {}) {
    const createdAt = entry.createdAt || Date.now(), id = entry.id || crypto.randomUUID(), deviceId = await getDeviceId();
    const record = { ...ArchiveModel.normalize(entry, { id, now: createdAt, deviceId }), schema: SyncModel.SCHEMA,
      preview: entry.preview || SyncModel.utf8Preview(entry.text || "") };
    await SyncStore.putArchive(record);
    await SyncStore.enqueue({ key: `archive:${id}`, kind: "archive", entityId: id, nextAt: 0, attempt: 0 });
    await SyncStore.trimBodies(200, 50);
    scheduleLocal();
    return record;
  }
  async function writeArchiveUpdate(id, patch) {
    const current = await resolve("archive", id);
    if (!current || Object.hasOwn(current, "deletedAt")) throw Object.assign(new Error("not_found"), { code: "not_found" });
    const record = ArchiveModel.update(current, patch, { now: Date.now(), deviceId: await getDeviceId() });
    await SyncStore.putArchive(record);
    await SyncStore.enqueue({ key: `archive:${id}`, kind: "archive", entityId: id, nextAt: 0, attempt: 0 });
    scheduleLocal();
    return record;
  }
  function updateArchive(id, patch) {
    const run = (archiveUpdates.get(id) || Promise.resolve()).catch(() => {}).then(() => writeArchiveUpdate(id, patch));
    archiveUpdates.set(id, run);
    return run.finally(() => { if (archiveUpdates.get(id) === run) archiveUpdates.delete(id); });
  }
  function searchArchives(cursor, limit = 50, filters = {}) {
    const query = { query: String(filters.query || "").trim(), favorite: !!filters.favorite, tag: String(filters.tag || "").trim() };
    return SyncStore.searchArchives(cursor, limit, (record) => ArchiveModel.matches(record, query));
  }
  async function archiveTags() {
    const tags = new Set();
    await SyncStore.iterate("archives", (record) => {
      if (!Object.hasOwn(record, "deletedAt")) for (const tag of record.tags || []) tags.add(tag);
    });
    return [...tags].sort((left, right) => left.localeCompare(right));
  }
  async function deleteArchive(id) {
    const old = await SyncStore.getArchive(id);
    if (!old) return null;
    const now = Date.now(), record = { id, createdAt: old.createdAt, updatedAt: now, deletedAt: now,
      deviceId: await getDeviceId(), schema: SyncModel.SCHEMA };
    await SyncStore.putArchive(record);
    await SyncStore.enqueue({ key: `archive:${id}`, kind: "archive", entityId: id, nextAt: 0, attempt: 0 });
    scheduleLocal();
    return record;
  }
  async function noteStorageChanges(changes = {}) {
    const state = await deviceState(), now = Date.now(), id = await getDeviceId();
    let changed = false;
    for (const key of SETTINGS) if (changes[key]) {
      state.settings[key] = { value: changes[key].newValue, updatedAt: now, deviceId: id }; changed = true;
    }
    if (changes.amsConsole) {
      const value = changes.amsConsole.newValue || {};
      state.settings["amsConsole.selected"] = { value: value.selected || {}, updatedAt: now, deviceId: id };
      state.settings["amsConsole.tier"] = { value: value.tier || "", updatedAt: now, deviceId: id }; changed = true;
    }
    for (const [key, bucket] of [["amsTemplates", "templates"], ["amsGroups", "groups"]]) if (changes[key]) {
      const current = new Map((changes[key].newValue || []).map((item) => [item.id, item]));
      for (const item of current.values()) state[bucket][item.id] = { ...item, updatedAt: item.updatedAt || now, deviceId: id };
      for (const old of changes[key].oldValue || []) if (!current.has(old.id))
        state[bucket][old.id] = { id: old.id, updatedAt: now, deletedAt: now, deviceId: id };
      changed = true;
    }
    if (!changed) return null;
    await SyncStore.putMeta("deviceState", state);
    await SyncStore.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    return state;
  }
  async function projectState(state = {}, suppress) {
    const settings = state.settings || {}, values = {};
    for (const key of SETTINGS) if (settings[key]) values[key] = settings[key].value;
    if (settings["amsConsole.selected"] || settings["amsConsole.tier"]) values.amsConsole = {
      selected: settings["amsConsole.selected"]?.value || {}, tier: settings["amsConsole.tier"]?.value || "" };
    if (state.templates) values.amsTemplates = Object.values(state.templates).filter((item) => !Object.hasOwn(item, "deletedAt"));
    if (state.groups) values.amsGroups = Object.values(state.groups).filter((item) => !Object.hasOwn(item, "deletedAt"));
    if (Object.keys(values).length) {
      const cleanup = suppress?.(values);
      try { await chrome.storage.local.set(values); } finally { cleanup?.(); }
    }
  }
  const applyRemoteState = projectState;
  async function seedState(cloudEmpty) {
    const keys = cloudEmpty ? [...SETTINGS, "amsConsole", "amsTemplates", "amsGroups", "amsHistory", "amsArchive"] :
      ["amsTemplates", "amsGroups", "amsHistory", "amsArchive"];
    const local = await chrome.storage.local.get(keys);
    const changes = {};
    const stateKeys = cloudEmpty ? [...SETTINGS, "amsConsole", "amsTemplates", "amsGroups"] : ["amsTemplates", "amsGroups"];
    for (const key of stateKeys) if (key in local)
      changes[key] = { newValue: local[key] };
    await noteStorageChanges(changes);
    for (const text of local.amsHistory || []) await addHistory(text);
    for (const entry of local.amsArchive || []) await addArchive(entry);
    return exportRecords();
  }
  const stamp = (record = {}) => ({ ...record, updatedAt: Math.max(Number(record.updatedAt) || 0, Number(record.deletedAt) || 0, Number(record.createdAt) || 0) });
  const newer = (old, next) => !old || SyncModel.compareVersion(stamp(old), stamp(next)) < 0;
  async function importRecords(records = []) {
    if (!Array.isArray(records)) {
      for (const value of records.history || []) {
        const old = await SyncStore.getHistory(value.id), merged = SyncModel.mergeHistory([old, value])[0];
        if (merged) await SyncStore.putHistory(merged);
      }
      for (const value of records.archives || []) if (newer(await SyncStore.getArchive(value.id), value)) await SyncStore.putArchive(value);
      return;
    }
    const rows = records;
    const id = await getDeviceId(), state = await deviceState();
    let stateChanged = false;
    for (const row of rows) {
      const value = row?.value || {}, kind = row?.kind;
      if (kind === "setting") {
        const next = { value: value.value, updatedAt: value.updatedAt, deviceId: value.deviceId };
        if (newer(state.settings[value.key], next)) { state.settings[value.key] = next; stateChanged = true; }
      } else if (kind === "template" || kind === "group") {
        const bucket = kind === "template" ? state.templates : state.groups;
        const next = { ...value, deviceId: value.deviceId || id };
        if (newer(bucket[value.id], next)) { bucket[value.id] = next; stateChanged = true; }
      } else if (kind === "history") {
        const next = { ...value, id: value.textHash, deviceId: id, schema: SyncModel.SCHEMA, preview: value.preview || SyncModel.utf8Preview(value.text) };
        const old = await SyncStore.getHistory(next.id), merged = SyncModel.mergeHistory([old, next])[0];
        await SyncStore.putHistory(merged);
        await SyncStore.enqueue({ key: `history:${next.id}:${id}`, kind: "history", entityId: next.id, nextAt: 0, attempt: 0 });
      } else if (kind === "archive") {
        const next = { ...value, deviceId: id, schema: SyncModel.SCHEMA, updatedAt: value.updatedAt || value.deletedAt || value.createdAt,
          preview: value.preview || SyncModel.utf8Preview(value.text || "") };
        const old = await SyncStore.getArchive(next.id);
        if (newer(old, next)) await SyncStore.putArchive(next);
        await SyncStore.enqueue({ key: `archive:${next.id}`, kind: "archive", entityId: next.id, nextAt: 0, attempt: 0 });
      }
    }
    if (stateChanged) {
      await SyncStore.putMeta("deviceState", state); await SyncStore.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      if (typeof SyncEngine !== "undefined") await SyncEngine.projectImportedState(state); else await projectState(state);
    }
    await SyncStore.trimBodies(200, 50);
  }
  async function* exportRecords() {
    const state = SyncModel.mergeStateFragments([await SyncStore.getMeta("materializedState") || {}, await deviceState()]).materialized;
    for (const [key, value] of Object.entries(state.settings)) yield { kind: "setting", value: { key, value: value.value, updatedAt: value.updatedAt, deviceId: value.deviceId } };
    for (const value of Object.values(state.templates)) yield { kind: "template", value };
    for (const value of Object.values(state.groups)) yield { kind: "group", value };
    for (const store of ["history", "archives"]) {
      let after = null, item;
      while ((item = await SyncStore.next(store, after))) {
        after = item.key;
        const isHistory = store === "history", tombstone = !isHistory && Object.hasOwn(item.value, "deletedAt");
        const resolved = tombstone ? item.value : await resolve(isHistory ? "history" : "archive", item.value.id);
        if (!resolved || isHistory && resolved.text == null || !isHistory && !Object.hasOwn(resolved, "deletedAt") && (resolved.text == null || !Array.isArray(resolved.results)))
          throw Object.assign(new Error("reconnect_required"), { code: "reconnect_required" });
        const value = { ...resolved }; delete value.fileId;
        yield { kind: isHistory ? "history" : "archive", value };
      }
    }
  }
  async function resolve(kind, id) {
    const record = await (kind === "history" ? SyncStore.getHistory(id) : SyncStore.getArchive(id));
    if (record?.text != null || !record?.fileId || typeof SyncEngine === "undefined") return record;
    const config = (await chrome.storage.local.get({ amsSyncConfig: {} })).amsSyncConfig || {};
    if (!config.connected) throw Object.assign(new Error("reconnect_required"), { code: "reconnect_required" });
    return kind === "history" ? SyncEngine.resolveHistory(id) : SyncEngine.resolveArchive(id);
  }
  return { deviceId: getDeviceId, deviceState, noteStorageChanges, applyRemoteState, addHistory,
    pageHistory: (cursor, limit = 50) => SyncStore.pageHistory(cursor, limit), getHistory: (id) => resolve("history", id),
    addArchive, updateArchive, deleteArchive, pageArchives: (cursor, limit = 50) => SyncStore.pageArchives(cursor, limit), searchArchives, archiveTags, getArchive: (id) => resolve("archive", id),
    seedState, importRecords, exportRecords, projectState };
})();

if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.source !== "AMS_DATA") return;
  const actions = {
    historyAdd: async () => { const record = await Data.addHistory(msg.text); return { record, changed: record && "historyChanged" }; },
    historyPage: () => Data.pageHistory(msg.cursor, msg.limit),
    historyGet: async () => ({ record: await Data.getHistory(msg.id) }),
    archiveAdd: async () => ({ record: await Data.addArchive(msg.entry), changed: "archiveChanged" }),
    archiveDelete: async () => { const record = await Data.deleteArchive(msg.id); return { ok: true, changed: record && "archiveChanged" }; },
    archivePage: () => Data.pageArchives(msg.cursor, msg.limit),
    archiveGet: async () => ({ record: await Data.getArchive(msg.id) }),
    archiveSearch: () => Data.searchArchives(msg.cursor, msg.limit, msg.filters || {}),
    archiveTags: async () => ({ tags: await Data.archiveTags() }),
    archiveUpdate: async () => ({ record: await Data.updateArchive(msg.id, msg.patch), changed: "archiveChanged",
      changeToken: typeof msg.changeToken === "string" ? msg.changeToken : undefined }),
  };
  if (!Object.hasOwn(actions, msg.action)) return;
  actions[msg.action]().then((value) => {
    sendResponse({ ok: true, ...value });
    if (value.changed) chrome.runtime.sendMessage({ source: "AMS_DATA", type: value.changed,
      ...(value.changeToken ? { changeToken: value.changeToken } : {}) });
  }, (error) => sendResponse({ ok: false, code: error.code || "local_write_failed" }));
  return true;
});
