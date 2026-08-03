// bg/sync.js — Drive 同步串行状态机
const SyncEngine = (() => {
  const CONFIG = "amsSyncConfig", STATUS = "amsSyncStatus";
  let chain = Promise.resolve(), localTimer = null, applyingRemote = false, errorCount = 0;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const LOCAL_KEYS = { amsLang: 1, amsTheme: 1, displayMode: 1, amsAutoRaise: 1, amsConsole: 1, amsTemplates: 1, amsGroups: 1 };
  const serialize = (task) => {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  };
  const config = async () => (await chrome.storage.local.get({ [CONFIG]: {} }))[CONFIG] || {};
  const saveConfig = async (patch) => {
    const value = { ...(await config()), ...patch };
    await chrome.storage.local.set({ [CONFIG]: value });
    return value;
  };
  async function setStatus(state, extra = {}) {
    const old = (await chrome.storage.local.get({ [STATUS]: {} }))[STATUS] || {};
    const value = { ...old, ...extra, state, errorCount };
    if (!own(extra, "reason")) delete value.reason;
    value.pending = await SyncStore.countOutbox();
    await chrome.storage.local.set({ [STATUS]: value });
    return value;
  }
  const logicalKey = (file) => {
    const props = file.appProperties || {}, kind = props.kind, id = props.id || "";
    return kind === "state" ? `state:${id}` : kind === "history" ? `history:${id}:${props.device || ""}` :
      kind === "archive" ? `archive:${id}` : null;
  };
  async function forget(fileId) { if (fileId) await SyncStore.deleteFile(fileId); }
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  async function validBody(kind, body, props) {
    if (!object(body) || Number(body.schema) !== SyncModel.SCHEMA) return false;
    if (kind === "state") return body.deviceId === props.id && ["settings", "templates", "groups"].every((key) => body[key] == null || object(body[key]));
    if (kind === "history") return body.id === props.id && body.textHash === props.id && body.deviceId === props.device && ["text"].every((key) => typeof body[key] === "string") && Number.isFinite(Number(body.createdAt)) && Number.isFinite(Number(body.lastUsedAt)) && await SyncModel.hashText(body.text) === body.textHash;
    return kind === "archive" && body.id === props.id && Number.isFinite(Number(body.createdAt)) &&
      (Number.isFinite(Number(body.deletedAt)) || typeof body.text === "string" && Array.isArray(body.results));
  }
  async function readFile(file, collected) {
    if (file.removed) { collected.removedStates.push(file.fileId); return forget(file.fileId); }
    if (file.appProperties?.app !== "polyask") return;
    if (Number(file.appProperties.schema) > SyncModel.SCHEMA) { await saveConfig({ readOnly: true }); return; }
    const kind = file.appProperties.kind;
    if (!Object.hasOwn({ state: 1, history: 1, archive: 1 }, kind) || !file.appProperties.id || kind === "history" && !file.appProperties.device || Number(file.appProperties.schema) !== SyncModel.SCHEMA) { errorCount++; return; }
    const id = file.id || file.fileId;
    try {
      const body = await Drive.download(id);
      if (Number(body?.schema) > SyncModel.SCHEMA) { await saveConfig({ readOnly: true }); return; }
      if (!await validBody(kind, body, file.appProperties)) { errorCount++; return; }
      const key = logicalKey(file);
      if (key) await SyncStore.putFile({ fileId: id, logicalKey: key });
      if (kind === "state") collected.states.push({ fileId: id, body });
      if (kind === "history") collected.history.push({ ...body, fileId: id });
      if (kind === "archive") collected.archives.push({ ...body, fileId: id });
    } catch (error) {
      if (error?.code === "not_found" || error?.status === 404) return forget(id);
      if (error?.code === "invalid_response") { errorCount++; return; }
      throw error;
    }
  }
  function archiveWinners(records) {
    const winners = new Map();
    for (const record of records) if (record?.id) {
      const old = winners.get(record.id), stamp = (item) => ({ ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, Number(item.deletedAt) || 0, Number(item.createdAt) || 0) });
      if (!old || SyncModel.compareVersion(stamp(old), stamp(record)) < 0) winners.set(record.id, record);
    }
    return [...winners.values()];
  }
  function stateMap(base, collected, seen) {
    const remoteStates = { ...base };
    for (const item of collected.states) if (!seen || seen.has(item.fileId)) remoteStates[item.fileId] = item.body;
    for (const fileId of collected.removedStates) delete remoteStates[fileId];
    if (seen) for (const fileId of Object.keys(remoteStates)) if (!seen.has(fileId)) delete remoteStates[fileId];
    return remoteStates;
  }
  async function setStateFile(states) {
    const deviceId = await Data.deviceId(), fileId = Object.keys(states).find((id) => states[id].deviceId === deviceId);
    const { stateFileId, ...saved } = await config();
    await chrome.storage.local.set({ [CONFIG]: { ...saved, ...(fileId ? { stateFileId: fileId } : {}) } });
  }
  async function applyCollected(collected, replaceStates = false, seen = null) {
    const remoteStates = stateMap(replaceStates ? {} : await SyncStore.getMeta("remoteStates"), collected, seen);
    await SyncStore.putMeta("remoteStates", remoteStates);
    await setStateFile(remoteStates);
    const state = SyncModel.mergeStateFragments([...Object.values(remoteStates), await Data.deviceState()]);
    errorCount += state.corrupt || 0;
    if (state.readOnly) await saveConfig({ readOnly: true });
    applyingRemote = true;
    try {
      if (Object.keys(remoteStates).length || collected.removedStates.length) await Data.applyRemoteState(state);
      await Data.importRecords({
        history: collected.history,
        archives: archiveWinners(collected.archives),
      });
    } finally { applyingRemote = false; }
  }
  async function saveToken(token) {
    await SyncStore.putMeta("pageToken", token); await saveConfig({ pageToken: token });
  }
  async function readChanges(token, collected) {
    const changes = await Drive.listChanges(token);
    for (const change of changes.changes || []) await readFile(change.file || change, collected);
    return changes;
  }
  async function changesSince(token) {
    const later = { states: [], history: [], archives: [], removedStates: [] };
    const changes = await readChanges(token, later);
    await applyCollected(later);
    await saveToken(changes.newStartPageToken || token);
  }
  const stamp = (item) => ({ ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, Number(item.deletedAt) || 0, Number(item.createdAt) || 0) });
  function mergeBucket(a = {}, b = {}) { const out = { ...a }; for (const [id, item] of Object.entries(b)) if (!out[id] || SyncModel.compareVersion(stamp(out[id]), stamp(item)) < 0) out[id] = item; return out; }
  async function fullScan(token, firstConnect) {
    const collected = { states: [], history: [], archives: [], removedStates: [] };
    const files = await Drive.listFiles();
    for (const file of files) await readFile(file, collected);
    const changes = await readChanges(token, collected), seen = new Set(files.filter((file) => file.appProperties?.app === "polyask").map((file) => file.id));
    for (const change of changes.changes || []) {
      if (change.removed) seen.delete(change.fileId);
      else if (change.file?.appProperties?.app === "polyask") seen.add(change.file.id);
    }
    await SyncStore.iterate("files", async (file) => { if (!seen.has(file.fileId)) await forget(file.fileId); });
    const cloudEmpty = seen.size === 0;
    if (firstConnect) await Data.seedState(cloudEmpty);
    const localState = await Data.deviceState();
    if (firstConnect && !cloudEmpty) {
      const states = stateMap({}, collected, seen), mine = Object.values(states).filter((body) => body.deviceId === localState.deviceId);
      if (mine.length) for (const body of mine) { localState.settings = mergeBucket(localState.settings, body.settings); localState.templates = mergeBucket(localState.templates, body.templates); localState.groups = mergeBucket(localState.groups, body.groups); }
      else localState.settings = {};
      await SyncStore.putMeta("deviceState", localState);
    }
    await applyCollected(collected, true, seen);
    await saveToken(changes.newStartPageToken || token);
  }
  async function pull() {
    const token = await SyncStore.getMeta("pageToken") || (await config()).pageToken;
    try { return await (token ? changesSince(token) : fullScan(await Drive.getStartToken(), true)); }
    catch (error) {
      if (error?.status === 410) return fullScan(await Drive.getStartToken(), false);
      throw error;
    }
  }
  async function upload(op) {
    const id = await Data.deviceId(); let key = op.key, existing;
    let name, props, body, record;
    if (op.kind === "state") {
      key = `state:${id}`; existing = { fileId: (await config()).stateFileId };
      name = `state-${id}.json`; props = { app: "polyask", schema: "1", kind: "state", id };
      body = await Data.deviceState();
    } else if (op.kind === "history") {
      existing = await SyncStore.findFile(key);
      record = await Data.getHistory(op.entityId); if (!record) return SyncStore.completeOutbox(op.key);
      name = `history-${record.textHash}-${id}.json`;
      props = { app: "polyask", schema: "1", kind: "history", id: record.textHash, device: id, preview: SyncModel.utf8Preview(record.text) };
      body = record;
    } else if (op.kind === "archive") {
      existing = await SyncStore.findFile(key);
      record = await Data.getArchive(op.entityId); if (!record) return SyncStore.completeOutbox(op.key);
      name = `archive-${record.id}.json`;
      props = { app: "polyask", schema: "1", kind: "archive", id: record.id, deleted: record.deletedAt ? "1" : "0", preview: SyncModel.utf8Preview(record.text) };
      body = record;
    } else return SyncStore.completeOutbox(op.key);
    const saved = await Drive.upsert(existing?.fileId, name, props, body);
    await SyncStore.putFile({ fileId: saved.id, logicalKey: key });
    if (op.kind === "state") await saveConfig({ stateFileId: saved.id });
    if (record) await (op.kind === "history" ? SyncStore.putHistory({ ...record, fileId: saved.id }) : SyncStore.putArchive({ ...record, fileId: saved.id }));
    await SyncStore.completeOutbox(op.key);
  }
  async function flush() {
    if ((await config()).readOnly) return;
    const rank = { state: 0, history: 1, archive: 2 };
    let waiting = false;
    while (true) {
      const ready = await SyncStore.readyOutbox(Date.now(), 100);
      if (!ready.length) return waiting;
      for (const op of ready.sort((a, b) => rank[a.kind] - rank[b.kind])) {
        try { await upload(op); }
        catch (error) {
          if (error?.code === "rate_limited" || error?.code === "server_error") {
            const attempt = (op.attempt || 0) + 1;
            await SyncStore.enqueue({ ...op, attempt, nextAt: Date.now() + (error.retryAfter || SyncModel.retryDelay(attempt)) });
            waiting = true; continue;
          }
          throw error;
        }
      }
    }
  }
  function failure(error) {
    if (error instanceof TypeError || error?.code === "network_error") return setStatus("offline");
    if (error?.code === "unauthorized" || error?.code === "auth_failed") return setStatus("auth");
    if (error?.code === "forbidden") {
      const value = String(error.reason || "").toLowerCase();
      const reason = /accessnotconfigured|notconfigured|disabled/.test(value) ? "drive_disabled" : /quota|limit|rate/.test(value) ? "quota" : "policy";
      return setStatus("blocked", { reason });
    }
    if (error?.code === "rate_limited" || error?.code === "server_error") return setStatus("waiting");
    return setStatus("error");
  }
  async function syncOnce(reason) {
    const saved = await config();
    if (!saved.connected || saved.clearRunning) return status();
    try {
      await setStatus("syncing", { reason });
      await pull(); const waiting = await flush();
      const readOnly = (await config()).readOnly;
      return setStatus(readOnly ? "schema" : waiting ? "waiting" : "idle", { lastSuccessAt: Date.now(), reason: undefined });
    } catch (error) { return failure(error); }
  }
  const wake = (reason) => serialize(() => syncOnce(reason));
  async function connect() {
    try { await Drive.connect(true); await saveConfig({ connected: true, readOnly: false }); return wake("connect"); }
    catch (error) { return failure(error); }
  }
  async function runNow(reason = "manual") { if (!(await config()).connected) return connect(); return wake(reason); }
  async function runForExport() { return (await config()).connected ? wake("export") : status(); }
  async function clearCache(connected = false) {
    await SyncStore.deleteMeta("pageToken"); await SyncStore.deleteMeta("remoteStates");
    await SyncStore.iterate("files", (file) => forget(file.fileId));
    const { pageToken, stateFileId, ...saved } = await config();
    await chrome.storage.local.set({ [CONFIG]: { ...saved, connected } });
  }
  async function disconnectNow() { await Drive.disconnect(); await clearCache(false); return setStatus("idle"); }
  const disconnect = () => serialize(disconnectNow);
  async function clearRemoteNow() {
    const saved = await config(), offset = saved.clearRunning ? Number(saved.clearProgress) || 0 : 0;
    await saveConfig({ clearRunning: true, clearProgress: offset });
    await Drive.clearAll(async (progress) => saveConfig({ clearProgress: offset + progress }));
    await disconnectNow(); await saveConfig({ clearRunning: false });
  }
  const clearRemote = () => serialize(clearRemoteNow);
  async function status() {
    const value = (await chrome.storage.local.get({ [STATUS]: {} }))[STATUS] || {};
    return { state: value.state || "idle", lastSuccessAt: value.lastSuccessAt, pending: await SyncStore.countOutbox(),
      errorCount: value.errorCount || errorCount, reason: value.reason, readOnly: !!(await config()).readOnly };
  }
  async function resolve(kind, id) {
    const record = await (kind === "history" ? SyncStore.getHistory(id) : SyncStore.getArchive(id));
    if (!record || record.text != null || !record.fileId) return record;
    try {
      const body = await Drive.download(record.fileId), props = kind === "history" ? { id, device: record.deviceId } : { id };
      if (!await validBody(kind, body, props)) throw { code: "invalid_response" };
      const merged = { ...record, ...body, fileId: record.fileId };
      await (kind === "history" ? SyncStore.putHistory(merged) : SyncStore.putArchive(merged));
      return merged;
    } catch (error) { if (error?.code === "not_found" || error?.status === 404) await forget(record.fileId); throw error; }
  }
  function init() {
    chrome.alarms.create("ams-sync", { periodInMinutes: 15 });
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "ams-sync") wake("alarm"); });
    chrome.runtime.onStartup.addListener(() => wake("startup"));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || applyingRemote || !Object.keys(changes).some((key) => own(LOCAL_KEYS, key))) return;
      Data.noteStorageChanges(changes).then((state) => {
        if (!state) return;
        clearTimeout(localTimer); localTimer = setTimeout(() => wake("local-change"), 3000);
      }).catch(failure);
    });
  }
  if (chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || msg.source !== "AMS_SYNC" || !own({ status: 1, connect: 1, syncNow: 1, disconnect: 1, clearRemote: 1, wake: 1 }, msg.action)) return;
    const actions = { status, connect, syncNow: () => runNow(msg.reason), disconnect, clearRemote, wake: () => wake(msg.reason) };
    actions[msg.action]().then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, code: error?.code || "sync_failed" }));
    return true;
  });
  return { init, wake, connect, runNow, runForExport, disconnect, clearRemote, status, resolveHistory: (id) => resolve("history", id), resolveArchive: (id) => resolve("archive", id) };
})();
SyncEngine.init();
