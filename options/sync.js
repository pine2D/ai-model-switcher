applyI18n();
document.title = `PolyAsk · ${t("sync_title")}`;
const byId = (id) => document.getElementById(id);
const controls = [...document.querySelectorAll("[data-sync-control]")];
let config = {}, status = {}, busy = false, notice = "", clearTimer = null;

function call(action, extra = {}) {
  return chrome.runtime.sendMessage({ source: "AMS_SYNC", action, ...extra }).then((result) => {
    if (!result?.ok) throw new Error(result?.code || "sync_failed");
    return result.value;
  });
}

function setBusy(value) {
  busy = value;
  controls.forEach((el) => { el.disabled = value || el.id === "export"; });
  byId("import-file").disabled = true;
}

function statusKey() {
  if (notice) return notice;
  if (config.clearRunning) return "sync_syncing";
  if (!config.connected) return "sync_disconnected";
  return `sync_${["idle", "syncing", "offline", "auth", "blocked", "waiting", "schema", "error"].includes(status.state) ? status.state : "error"}`;
}

function renderStatus() {
  byId("status-title").textContent = t(statusKey());
  const detail = [];
  if (config.clearRunning) detail.push(t("sync_clearProgress", config.clearProgress || 0));
  if (config.connected && status.lastSuccessAt) detail.push(t("sync_lastSuccess", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(status.lastSuccessAt)));
  if (config.connected && status.pending) detail.push(t("sync_pending", status.pending));
  byId("status-detail").textContent = detail.join(" · ");
  const connected = !!config.connected && !config.clearRunning;
  byId("connect").hidden = connected || !!config.clearRunning;
  byId("sync-now").hidden = !connected;
  byId("disconnect").hidden = !connected;
  byId("clear-confirmation").hidden = !config.clearRunning && !byId("clear-confirmation").dataset.open;
  byId("clear-remote").hidden = !config.connected || !!config.clearRunning;
}

async function refresh() {
  const [response, local] = await Promise.all([call("status"), chrome.storage.local.get({ amsSyncConfig: {} })]);
  status = response || {}; config = local.amsSyncConfig || {}; renderStatus();
}

function refreshDuringClear() {
  clearTimer = setInterval(() => refresh().catch(() => {}), 800);
}

async function run(action) {
  notice = ""; setBusy(true);
  if (action === "clearRemote") refreshDuringClear();
  try {
    await call(action);
    if (action === "clearRemote") { notice = "sync_clearDone"; delete byId("clear-confirmation").dataset.open; }
  } catch (error) {
    status = { state: "error" };
  } finally {
    if (clearTimer) { clearInterval(clearTimer); clearTimer = null; }
    setBusy(false);
    await refresh().catch(() => renderStatus());
  }
}

byId("connect").addEventListener("click", () => run("connect"));
byId("sync-now").addEventListener("click", () => run("syncNow"));
byId("disconnect").addEventListener("click", () => run("disconnect"));
byId("clear-remote").addEventListener("click", () => {
  byId("clear-confirmation").dataset.open = "true";
  byId("clear-confirmation").hidden = false;
  byId("clear-continue").focus();
});
byId("clear-continue").addEventListener("click", () => run("clearRemote"));
document.addEventListener("i18n:changed", () => { document.title = `PolyAsk · ${t("sync_title")}`; renderStatus(); });

refresh().catch(() => { status = { state: "error" }; renderStatus(); });
