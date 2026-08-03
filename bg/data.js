// bg/data.js — 本地记录与设备状态协议
const Data = (() => {
  const SETTINGS = ["amsLang", "amsTheme", "displayMode", "amsAutoRaise"];
  let cachedDeviceId, deviceIdOpening;
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
    return record;
  }
  async function addArchive(entry = {}) {
    const createdAt = entry.createdAt || Date.now(), id = entry.id || crypto.randomUUID(), deviceId = await getDeviceId();
    const record = { ...entry, id, createdAt, ts: entry.ts || createdAt, deviceId, schema: SyncModel.SCHEMA,
      updatedAt: entry.updatedAt || createdAt, preview: entry.preview || SyncModel.utf8Preview(entry.text || "") };
    await SyncStore.putArchive(record);
    await SyncStore.enqueue({ key: `archive:${id}`, kind: "archive", entityId: id, nextAt: 0, attempt: 0 });
    await SyncStore.trimBodies(200, 50);
    return record;
  }
  async function deleteArchive(id) {
    const old = await SyncStore.getArchive(id);
    if (!old) return null;
    const now = Date.now(), record = { id, createdAt: old.createdAt, updatedAt: now, deletedAt: now,
      deviceId: await getDeviceId(), schema: SyncModel.SCHEMA };
    await SyncStore.putArchive(record);
    await SyncStore.enqueue({ key: `archive:${id}`, kind: "archive", entityId: id, nextAt: 0, attempt: 0 });
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
  async function applyRemoteState(state = {}) {
    const settings = state.settings || {}, values = {};
    for (const key of SETTINGS) if (settings[key]) values[key] = settings[key].value;
    if (settings["amsConsole.selected"] || settings["amsConsole.tier"]) values.amsConsole = {
      selected: settings["amsConsole.selected"]?.value || {}, tier: settings["amsConsole.tier"]?.value || "" };
    if (state.templates) values.amsTemplates = state.templates.filter((item) => !item.deletedAt);
    if (state.groups) values.amsGroups = state.groups.filter((item) => !item.deletedAt);
    if (Object.keys(values).length) await chrome.storage.local.set(values);
  }
  async function seedState(cloudEmpty) {
    if (!cloudEmpty) return null;
    const keys = [...SETTINGS, "amsConsole", "amsTemplates", "amsGroups", "amsHistory", "amsArchive"];
    const local = await chrome.storage.local.get(keys);
    const changes = {};
    for (const key of [...SETTINGS, "amsConsole", "amsTemplates", "amsGroups"]) if (key in local)
      changes[key] = { newValue: local[key] };
    await noteStorageChanges(changes);
    for (const text of local.amsHistory || []) await addHistory(text);
    for (const entry of local.amsArchive || []) await addArchive(entry);
    return exportRecords();
  }
  async function importRecords(records = {}) {
    const history = records.history || [], archives = records.archives || [];
    for (const record of history) await SyncStore.putHistory(record);
    for (const record of archives) await SyncStore.putArchive(record);
  }
  async function exportRecords() {
    const history = [], archives = [];
    await SyncStore.iterate("history", (record) => history.push(record));
    await SyncStore.iterate("archives", (record) => archives.push(record));
    return { history, archives };
  }
  return { deviceId: getDeviceId, noteStorageChanges, applyRemoteState, addHistory,
    pageHistory: (cursor, limit = 50) => SyncStore.pageHistory(cursor, limit), getHistory: (id) => SyncStore.getHistory(id),
    addArchive, deleteArchive, pageArchives: (cursor, limit = 50) => SyncStore.pageArchives(cursor, limit), getArchive: (id) => SyncStore.getArchive(id),
    seedState, importRecords, exportRecords };
})();
