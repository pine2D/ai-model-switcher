// bg/data-admin.js — 本机数据批量清理；云端删除由 SyncEngine 单独负责。
const DataAdmin = (() => {
  let resetUntil = 0;
  const LOCAL_KEYS = ["amsLang", "amsTheme", "displayMode", "amsAutoRaise", "amsConsole", "amsConsolePrompt",
    "amsConsolePrefill", "amsTemplates", "amsGroups", "amsHistory", "amsArchive", "amsSyncConfig", "amsSyncStatus"];
  const SESSION_KEYS = ["amsComposeContext", "amsComposeContextError", "amsComposeDispatchUntil", "amsLastRun",
    "amsPendingRun", "amsPendingSynthesis", "amsComposeSynthesis"];
  const liveIds = async (kind) => {
    const ids = [];
    await (SyncStore.scanAll || SyncStore.iterate)(kind, (record) => { if (!Object.hasOwn(record, "deletedAt")) ids.push(record.id); });
    return ids;
  };
  async function clearHistory() {
    const ids = await liveIds("history");
    for (const id of ids) await Data.deleteHistory(id);
    return ids.length;
  }
  async function clearArchives() {
    const ids = await liveIds("archives");
    for (const id of ids) await Data.deleteArchive(id);
    return ids.length;
  }
  async function resetLocal() {
    await SyncEngine.disconnect();
    await SyncStore.clearLocalData();
    Data.resetDeviceId();
    resetUntil = Date.now() + 1000;
    await Promise.all([chrome.storage.local.remove(LOCAL_KEYS), chrome.storage.session.remove(SESSION_KEYS)]);
  }
  return { clearHistory, clearArchives, resetLocal, resetting: () => Date.now() < resetUntil };
})();
globalThis.DataAdmin = DataAdmin;

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.source !== "AMS_DATA_ADMIN" || !Object.hasOwn({ clearHistory: 1, clearArchives: 1, resetLocal: 1 }, msg.action)) return;
  const action = msg.action;
  DataAdmin[action]().then((count) => {
    respond({ ok: true, ...(typeof count === "number" ? { count } : {}) });
    if (action !== "clearArchives") chrome.runtime.sendMessage({ source: "AMS_DATA", type: "historyChanged" }, () => void chrome.runtime.lastError);
    if (action !== "clearHistory") chrome.runtime.sendMessage({ source: "AMS_DATA", type: "archiveChanged" }, () => void chrome.runtime.lastError);
  }, (error) => respond({ ok: false, code: error?.code || "local_write_failed" }));
  return true;
});
