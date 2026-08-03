// bg/sync.js — Drive 同步串行状态机
const SyncEngine = (() => {
  const CONFIG = "amsSyncConfig", STATUS = "amsSyncStatus", suppressed = new Map();
  let chain = Promise.resolve(), localTimer = null, errorCount = 0;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const coded = (code) => Object.assign(new Error(code), { code });
  const LOCAL_KEYS = { amsLang: 1, amsTheme: 1, displayMode: 1, amsAutoRaise: 1, amsConsole: 1, amsTemplates: 1, amsGroups: 1 };
  const serialize = (task) => { const run = chain.then(task, task); chain = run.catch(() => {}); return run; };
  function suppressProjection(values) {
    const added = [];
    for (const [key, value] of Object.entries(values)) { const token = { value: JSON.stringify(value) }, queue = suppressed.get(key) || [];
      queue.push(token); suppressed.set(key, queue); added.push([key, token]); }
    return () => {
      for (const [key, token] of added) {
        const queue = suppressed.get(key) || [], at = queue.indexOf(token);
        if (at >= 0) queue.splice(at, 1); if (!queue.length) suppressed.delete(key);
      }
    };
  }
  function unsuppressed(changes) {
    const out = {};
    for (const [key, change] of Object.entries(changes)) { const queue = suppressed.get(key) || [], at = queue.findIndex((token) => token.value === JSON.stringify(change.newValue));
      if (at < 0) out[key] = change; else { queue.splice(at, 1); if (!queue.length) suppressed.delete(key); } }
    return out;
  }
  const config = async () => (await chrome.storage.local.get({ [CONFIG]: {} }))[CONFIG] || {};
  const saveConfig = async (patch) => { const value = { ...(await config()), ...patch };
    await chrome.storage.local.set({ [CONFIG]: value }); return value; };
  async function setStatus(state, extra = {}) {
    const old = (await chrome.storage.local.get({ [STATUS]: {} }))[STATUS] || {};
    const value = { ...old, ...extra, state, errorCount };
    if (!own(extra, "reason")) delete value.reason;
    value.pending = await SyncStore.countOutbox();
    await chrome.storage.local.set({ [STATUS]: value });
    return value;
  }
  const logicalKey = (file) => { const props = file.appProperties || {}, kind = props.kind, id = props.id; if (!id || kind === "history" && !props.device) return null;
    return kind === "state" ? `state:${id}` : kind === "history" ? `history:${id}:${props.device || ""}` :
      kind === "archive" ? `archive:${id}` : null; };
  async function forget(fileId, logicalHint) {
    if (!fileId) return;
    const indexed = SyncStore.getFile ? await SyncStore.getFile(fileId) : null;
    await SyncStore.deleteFile(fileId);
    const logical = indexed?.logicalKey || logicalHint, match = logical?.match(/^(history|archive):([^:]+)/);
    if (match && SyncStore.setEntityFile) { const alternative = await SyncStore.findFile(logical);
      await SyncStore.setEntityFile(match[1], match[2], alternative?.fileId, fileId); }
  }
  async function invalidate(fileId, seenAt, logicalHint) { await forget(fileId, logicalHint); if (seenAt) await SyncStore.markFile(fileId, seenAt); }
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const validTime = SyncModel.validTime || ((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const validVersion = (value) => object(value) && validTime(value.updatedAt) && (!Object.hasOwn(value, "deletedAt") || validTime(value.deletedAt));
  async function validBody(kind, body, props) {
    if (!object(body) || Number(body.schema) !== SyncModel.SCHEMA) return false;
    if (kind === "state") return body.deviceId === props.id && ["settings", "templates", "groups"].every((key) => body[key] == null || object(body[key])) &&
      Object.values(body.settings || {}).every(validVersion) && ["templates", "groups"].every((key) => Object.values(body[key] || {}).every((item) => item?.id && validVersion(item)));
    if (kind === "history") return body.id === props.id && body.textHash === props.id && body.deviceId === props.device && typeof body.text === "string" &&
      validTime(body.createdAt) && validTime(body.lastUsedAt) && await SyncModel.hashText(body.text) === body.textHash;
    return kind === "archive" && body.id === props.id && validTime(body.createdAt) &&
      (!Object.hasOwn(body, "updatedAt") || validTime(body.updatedAt)) &&
      (Object.hasOwn(body, "deletedAt") ? validTime(body.deletedAt) : typeof body.text === "string" && Array.isArray(body.results));
  }
  async function readFile(file, collected, seenAt) {
    if (file.removed) { collected.removedStates.push(file.fileId); collected.futureFiles.delete(file.fileId); return forget(file.fileId); }
    if (file.appProperties?.app !== "polyask") return;
    const id = file.id || file.fileId; if (seenAt && id) await SyncStore.markFile(id, seenAt);
    if (Number(file.appProperties.schema) > SyncModel.SCHEMA) { collected.futureFiles.add(id); collected.removedStates.push(id); await saveConfig({ readOnly: true }); await invalidate(id, seenAt, logicalKey(file)); return; }
    const kind = file.appProperties.kind;
    if (!Object.hasOwn({ state: 1, history: 1, archive: 1 }, kind) || !file.appProperties.id || kind === "history" && !file.appProperties.device || Number(file.appProperties.schema) !== SyncModel.SCHEMA) { errorCount++; await invalidate(id, seenAt); return; }
    try {
      const body = await Drive.download(id);
      if (Number(body?.schema) > SyncModel.SCHEMA) { collected.futureFiles.add(id); collected.removedStates.push(id); await saveConfig({ readOnly: true }); await invalidate(id, seenAt, logicalKey(file)); return; }
      if (!await validBody(kind, body, file.appProperties)) { errorCount++; await invalidate(id, seenAt, logicalKey(file)); return; }
      const key = logicalKey(file);
      if (key) await SyncStore.putFile({ fileId: id, logicalKey: key, ...(seenAt ? { seenAt } : {}) });
      if (kind === "state") collected.states.push({ fileId: id, body });
      if (kind === "history") await Data.importRecords({ history: [{ ...body, fileId: id }] });
      if (kind === "archive") await Data.importRecords({ archives: [{ ...body, fileId: id }] });
    } catch (error) {
      if (error?.code === "not_found" || error?.status === 404) { if (kind === "state") collected.removedStates.push(id); await invalidate(id, seenAt, logicalKey(file)); return; }
      if (error?.code === "invalid_response") { errorCount++; await invalidate(id, seenAt, logicalKey(file)); return; }
      throw error;
    }
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
    if (state.materialized) await SyncStore.putMeta("materializedState", state.materialized);
    errorCount += state.corrupt || 0;
    if (state.readOnly) await saveConfig({ readOnly: true });
    if (Object.keys(remoteStates).length || collected.removedStates.length) await Data.applyRemoteState(state, suppressProjection);
    await SyncStore.trimBodies?.(200, 50);
  }
  async function saveToken(token) { await SyncStore.putMeta("pageToken", token); await saveConfig({ pageToken: token }); }
  async function visitFiles(visit) { if (Drive.visitFiles) return Drive.visitFiles(visit);
    for (const file of await Drive.listFiles()) await visit(file); }
  async function visitChanges(token, visit) {
    if (Drive.visitChanges) return Drive.visitChanges(token, visit);
    const result = await Drive.listChanges(token); for (const change of result.changes || []) await visit(change); return result;
  }
  async function changesSince(token) {
    const later = { states: [], removedStates: [], futureFiles: new Set() };
    const changes = await visitChanges(token, (change) => readFile(change.file || change, later));
    await applyCollected(later);
    await saveToken(changes.newStartPageToken || token);
  }
  const stamp = (item) => ({ ...item, updatedAt: Math.max(Number(item.updatedAt) || 0, Number(item.deletedAt) || 0, Number(item.createdAt) || 0) });
  function mergeBucket(a = {}, b = {}) { const out = { ...a }; for (const [id, item] of Object.entries(b)) if (!out[id] || SyncModel.compareVersion(stamp(out[id]), stamp(item)) < 0) out[id] = item; return out; }
  async function fullScan(token, firstConnect) {
    const collected = { states: [], removedStates: [], futureFiles: new Set() }, scanId = `${Date.now()}-${Math.random()}`;
    let cloudCount = 0;
    await visitFiles(async (file) => {
      if (file.appProperties?.app === "polyask") cloudCount++;
      await readFile(file, collected, scanId);
    });
    const changes = await visitChanges(token, async (change) => {
      if (change.removed && (await SyncStore.getFile(change.fileId))?.seenAt === scanId) cloudCount = Math.max(0, cloudCount - 1);
      else if (change.file?.appProperties?.app === "polyask" && (await SyncStore.getFile(change.file.id))?.seenAt !== scanId) cloudCount++;
      await readFile(change.file || change, collected, scanId);
    });
    await SyncStore.iterate("files", async (file) => { if (file.seenAt !== scanId) await forget(file.fileId); });
    const cloudEmpty = cloudCount === 0;
    if (firstConnect) await Data.seedState(cloudEmpty);
    const localState = await Data.deviceState();
    if (firstConnect && !cloudEmpty) {
      const states = stateMap({}, collected, new Set(collected.states.map((item) => item.fileId)));
      const mine = Object.values(states).filter((body) => body.deviceId === localState.deviceId);
      if (mine.length) for (const body of mine) { localState.settings = mergeBucket(localState.settings, body.settings); localState.templates = mergeBucket(localState.templates, body.templates); localState.groups = mergeBucket(localState.groups, body.groups); }
      else localState.settings = {};
      await SyncStore.putMeta("deviceState", localState);
    }
    await applyCollected(collected, true, new Set(collected.states.map((item) => item.fileId)));
    await saveConfig({ readOnly: collected.futureFiles.size > 0 });
    await saveToken(changes.newStartPageToken || token);
  }
  async function pull() {
    const token = await SyncStore.getMeta("pageToken") || (await config()).pageToken;
    try { return await (token ? changesSince(token) : fullScan(await Drive.getStartToken(), true)); }
    catch (error) { if (error?.status === 410) return fullScan(await Drive.getStartToken(), false); throw error; }
  }
  async function upload(op) {
    const id = await Data.deviceId(); let key = op.key, existing;
    let name, props, body, record;
    if (op.kind === "state") {
      key = `state:${id}`; existing = await SyncStore.findFile(key) || { fileId: (await config()).stateFileId };
      name = `state-${id}.json`; props = { app: "polyask", schema: "1", kind: "state", id };
      body = await Data.deviceState();
    } else if (op.kind === "history") {
      existing = await SyncStore.findFile(key);
      record = await Data.getHistory(op.entityId); if (!record) return SyncStore.completeOutbox(op.key, op.revision);
      name = `history-${record.textHash}-${id}.json`;
      props = { app: "polyask", schema: "1", kind: "history", id: record.textHash, device: id, preview: SyncModel.utf8Preview(record.text) };
      body = { ...record, deviceId: id }; delete body.fileId;
    } else if (op.kind === "archive") {
      existing = await SyncStore.findFile(key);
      record = await Data.getArchive(op.entityId); if (!record) return SyncStore.completeOutbox(op.key, op.revision);
      name = `archive-${record.id}.json`;
      props = { app: "polyask", schema: "1", kind: "archive", id: record.id, deleted: Object.hasOwn(record, "deletedAt") ? "1" : "0", preview: SyncModel.utf8Preview(record.text) };
      body = record;
    } else return SyncStore.completeOutbox(op.key, op.revision);
    const saved = await Drive.upsert(existing?.fileId, name, props, body);
    await SyncStore.putFile({ fileId: saved.id, logicalKey: key });
    const canonical = await SyncStore.findFile(key), fileId = canonical?.fileId || saved.id;
    if (op.kind === "state") await saveConfig({ stateFileId: fileId });
    if (record && SyncStore.setEntityFile) await SyncStore.setEntityFile(op.kind, op.entityId, fileId, undefined, op.kind === "history" ? id : undefined);
    else if (record) { const latest = await (op.kind === "history" ? Data.getHistory(op.entityId) : Data.getArchive(op.entityId));
      if (latest) await (op.kind === "history" ? SyncStore.putHistory({ ...latest, fileId, deviceId: id }) : SyncStore.putArchive({ ...latest, fileId })); }
    await SyncStore.completeOutbox(op.key, op.revision);
  }
  async function flush() {
    if ((await config()).readOnly) return;
    const rank = { state: 0, history: 1, archive: 2 };
    let waiting = false;
    while (true) {
      const ready = await SyncStore.readyOutbox(Date.now(), 100);
      if (!ready.length) { await SyncStore.trimBodies?.(200, 50); return waiting; }
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
    if (error?.code === "forbidden") { const value = String(error.reason || "").toLowerCase();
      const reason = /accessnotconfigured|notconfigured|disabled/.test(value) ? "drive_disabled" : /quota|limit|rate/.test(value) ? "quota" : "policy";
      return setStatus("blocked", { reason }); }
    if (error?.code === "rate_limited" || error?.code === "server_error") return setStatus("waiting");
    return setStatus("error");
  }
  async function syncOnce(reason) {
    const saved = await config();
    if (!saved.connected || saved.clearRunning) return status();
    try { await setStatus("syncing", { reason }); await pull(); const waiting = await flush();
      const readOnly = (await config()).readOnly;
      return setStatus(readOnly ? "schema" : waiting ? "waiting" : "idle", { lastSuccessAt: Date.now(), reason: undefined }); }
    catch (error) { return failure(error); }
  }
  const wake = (reason) => serialize(() => syncOnce(reason));
  async function exportOnce() {
    const saved = await config();
    if (saved.readOnly) { await setStatus("schema"); throw coded("schema"); }
    if (!saved.connected || saved.clearRunning) return status();
    try { await setStatus("syncing", { reason: "export" }); await pull(); const waiting = await flush();
      if ((await config()).readOnly) throw coded("schema");
      return setStatus(waiting ? "waiting" : "idle", { lastSuccessAt: Date.now(), reason: undefined }); }
    catch (error) { if (error?.code === "schema") await setStatus("schema"); else await failure(error); throw error; }
  }
  async function connect() { try { await Drive.connect(true); await saveConfig({ connected: true }); return wake("connect"); }
    catch (error) { return failure(error); } }
  async function runNow(reason = "manual") { if (!(await config()).connected) return connect(); return wake(reason); }
  const runForExport = () => serialize(exportOnce);
  const finishImport = async () => (await config()).connected ? wake("import") : status();
  async function projectImportedState(state) { await Data.projectState(state, suppressProjection); }
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
    const current = (await chrome.storage.local.get({ [STATUS]: {} }))[STATUS] || {};
    if (saved.clearRunning && current.state === "auth") await Drive.connect(true);
    await saveConfig({ clearRunning: true, clearProgress: offset });
    await Drive.clearAll(async (progress) => saveConfig({ clearProgress: offset + progress }));
    await disconnectNow(); await saveConfig({ clearRunning: false, readOnly: false });
  }
  const clearRemote = () => serialize(async () => { try { return await clearRemoteNow(); }
    catch (error) { await failure(error); throw error; } });
  async function status() {
    const value = (await chrome.storage.local.get({ [STATUS]: {} }))[STATUS] || {};
    return { state: value.state || "idle", lastSuccessAt: value.lastSuccessAt, pending: await SyncStore.countOutbox(),
      errorCount: value.errorCount || errorCount, reason: value.reason, readOnly: !!(await config()).readOnly };
  }
  async function resolve(kind, id) { let staleReads = 0;
    for (;;) {
      const record = await (kind === "history" ? SyncStore.getHistory(id) : SyncStore.getArchive(id));
      if (!record || record.text != null || !record.fileId || kind === "archive" && Object.hasOwn(record, "deletedAt")) return record;
      try { const body = await Drive.download(record.fileId), props = kind === "history" ? { id, device: record.deviceId } : { id };
        if (!await validBody(kind, body, props)) throw { code: "invalid_response" };
        const hydrated = await SyncStore.hydrateEntity(kind, id, record, body), latest = hydrated.record;
        if (hydrated.hydrated || !latest || latest.text != null || !latest.fileId || kind === "archive" && Object.hasOwn(latest, "deletedAt")) return latest;
        if (++staleReads >= 2) throw coded("stale_body");
      } catch (error) {
        if (error?.code !== "not_found" && error?.status !== 404) throw error;
        await forget(record.fileId, kind === "history" ? `history:${id}:${record.deviceId}` : `archive:${id}`);
        const replacement = await (kind === "history" ? SyncStore.getHistory(id) : SyncStore.getArchive(id));
        if (!replacement?.fileId || replacement.fileId === record.fileId) throw error;
      }
    }
  }
  function scheduleLocal() { clearTimeout(localTimer); localTimer = setTimeout(() => { localTimer = null; wake("local-change"); }, 3000); }
  function init() {
    chrome.alarms.create("ams-sync", { periodInMinutes: 15 });
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "ams-sync") wake("alarm"); });
    chrome.runtime.onStartup.addListener(() => wake("startup"));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const localChanges = unsuppressed(changes);
      if (!Object.keys(localChanges).some((key) => own(LOCAL_KEYS, key))) return;
      Data.noteStorageChanges(localChanges).then((state) => {
        if (!state) return;
        scheduleLocal();
      }).catch(failure);
    });
  }
  if (chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || msg.source !== "AMS_SYNC" || !own({ status: 1, connect: 1, syncNow: 1, disconnect: 1, clearRemote: 1, wake: 1 }, msg.action)) return;
    const actions = { status, connect, syncNow: () => runNow(msg.reason), disconnect, clearRemote, wake: () => wake(msg.reason) };
    actions[msg.action]().then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, code: error?.code || "sync_failed" }));
    return true;
  });
  return { init, wake, connect, runNow, runForExport, finishImport, projectImportedState, scheduleLocal,
    disconnect, clearRemote, status, resolveHistory: (id) => resolve("history", id), resolveArchive: (id) => resolve("archive", id) };
})();
SyncEngine.init();
