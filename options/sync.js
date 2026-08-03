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

function transfer(action, extra = {}) {
  return chrome.runtime.sendMessage({ source: "AMS_TRANSFER", action, ...extra }).then((result) => {
    if (!result?.ok) throw Object.assign(new Error(result?.code || "import_failed"), { code: result?.code });
    return result.value;
  });
}

function setBusy(value) {
  busy = value;
  controls.forEach((el) => { el.disabled = value || !!config.clearRunning; });
  byId("import-file").disabled = value || !!config.clearRunning;
}

function statusKey() {
  if (notice) return notice;
  if (config.clearRunning) return "sync_syncing";
  if (!config.connected) return "sync_disconnected";
  return `sync_${["idle", "syncing", "offline", "auth", "blocked", "waiting", "schema", "error"].includes(status.state) ? status.state : "error"}`;
}

function renderStatus() {
  setBusy(busy);
  byId("status-title").textContent = t(statusKey());
  const detail = [];
  if (config.clearRunning) detail.push(t("sync_clearProgress", config.clearProgress || 0));
  if (config.connected && status.lastSuccessAt) detail.push(t("sync_lastSuccess", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(status.lastSuccessAt)));
  if (config.connected && status.pending) detail.push(t("sync_pending", status.pending));
  byId("status-detail").textContent = detail.join(" · ");
  const reconnect = !!config.connected && !config.clearRunning && status.state === "auth";
  const connected = !!config.connected && !config.clearRunning && !reconnect;
  byId("connect").hidden = connected || !!config.clearRunning;
  byId("connect").textContent = t(reconnect ? "sync_auth" : "sync_connect");
  byId("sync-now").hidden = !connected;
  byId("disconnect").hidden = !config.connected || !!config.clearRunning;
  byId("clear-confirmation").hidden = !config.clearRunning && !byId("clear-confirmation").dataset.open;
  byId("clear-remote").hidden = !config.connected || !!config.clearRunning || reconnect;
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

async function readJsonLines(file, onRow) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value = "", done } = await reader.read();
    buffer += value;
    const lines = buffer.split("\n"); buffer = lines.pop();
    for (const line of lines) if (line.trim()) await onRow(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) await onRow(JSON.parse(buffer));
}

async function batches(file, visit) {
  let header, rows = [], sent = false;
  const flush = async () => { if (rows.length) { await visit(header, rows); rows = []; sent = true; } };
  await readJsonLines(file, async (row) => { if (!header) header = row; else { rows.push(row); if (rows.length === 100) await flush(); } });
  if (!header) throw Object.assign(new Error("invalid_header"), { code: "invalid_header" });
  await flush();
  if (!sent) await visit(header, []);
}

function writeTransfer(handle) {
  const port = chrome.runtime.connect({ name: "ams-transfer" });
  return new Promise((resolve, reject) => {
    let writable, finished = false, queue = Promise.resolve();
    const abort = async (error) => {
      if (finished) return;
      finished = true;
      try { if (writable) await writable.abort(); } catch (_) {}
      try { port.disconnect(); } catch (_) {}
      reject(error);
    };
    port.onMessage.addListener((message) => {
      queue = queue.then(async () => {
        if (message?.error) throw Object.assign(new Error(message.error), { code: message.error });
        if (message?.line == null) {
          if (message?.done) { if (writable) await writable.close(); finished = true; port.disconnect(); resolve(); }
          return;
        }
        if (!writable) writable = await handle.createWritable();
        await writable.write(`${message.line}\n`);
        port.postMessage({ ack: message.seq });
      }).catch(abort);
    });
    port.onDisconnect.addListener(() => { if (!finished) abort(Object.assign(new Error("export_cancelled"), { code: "export_cancelled" })); });
  });
}

byId("export").addEventListener("click", async () => {
  const picker = window.showSaveFilePicker({
    suggestedName: `polyask-${new Date().toISOString().slice(0, 10)}.polyask.jsonl`,
    types: [{ description: "PolyAsk transfer", accept: { "application/x-ndjson": [".jsonl"] } }],
  });
  try {
    const handle = await picker;
    notice = ""; setBusy(true); await writeTransfer(handle);
  } catch (error) {
    if (error?.name !== "AbortError") notice = error?.code === "reconnect_required" ? "sync_reconnectExport" : "sync_exportError";
  } finally { setBusy(false); renderStatus(); }
});

byId("import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  notice = ""; setBusy(true);
  try {
    await batches(file, (header, records) => transfer("validateImport", { header, records }));
    await batches(file, (_header, records) => transfer("importBatch", { records }));
    notice = "sync_importDone";
  } catch (_) { notice = "sync_importError"; }
  finally { event.target.value = ""; setBusy(false); await refresh().catch(() => renderStatus()); }
});

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
