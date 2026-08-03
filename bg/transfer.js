// bg/transfer.js — JSONL 迁移包格式与背压导出
const Transfer = (() => {
  const FORMAT = "polyask-transfer", VERSION = 1;
  const KINDS = new Set(["setting", "template", "group", "history", "archive"]);
  const coded = (code) => Object.assign(new Error(code), { code });
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const text = (value, key) => typeof value[key] === "string" && value[key].length > 0;
  const time = (value, key) => Number.isFinite(Number(value[key]));
  function validateHeader(row) {
    if (row?.format !== FORMAT) throw coded("invalid_header");
    if (row.version > VERSION) throw coded("newer_format");
    if (row.version !== VERSION || !Date.parse(row.exportedAt)) throw coded("invalid_header");
    return true;
  }
  function validateKindValue(kind, value) {
    if (!object(value)) throw coded("invalid_record");
    const valid = kind === "setting" ? text(value, "key") && Object.hasOwn(value, "value") && time(value, "updatedAt") && text(value, "deviceId")
      : kind === "template" ? text(value, "id") && typeof value.text === "string" && time(value, "updatedAt")
      : kind === "group" ? text(value, "id") && text(value, "name") && Array.isArray(value.hosts) && time(value, "updatedAt")
      : kind === "history" ? text(value, "id") && text(value, "text") && text(value, "textHash") && time(value, "createdAt") && time(value, "lastUsedAt")
      : text(value, "id") && time(value, "createdAt") && (time(value, "deletedAt") || typeof value.text === "string" && Array.isArray(value.results));
    if (!valid) throw coded("invalid_record");
  }
  function validateRecord(row) {
    if (!KINDS.has(row?.kind)) throw coded("unknown_kind");
    validateKindValue(row.kind, row.value);
    return true;
  }
  function waitAck(port, seq, row) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect); };
      const onMessage = (message) => { if (message?.ack === seq) { cleanup(); resolve(); } };
      const onDisconnect = () => { cleanup(); reject(coded("export_cancelled")); };
      port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
      port.postMessage({ seq, line: JSON.stringify(row) });
    });
  }
  async function attachPort(port) {
    if (port.name !== "ams-transfer") return;
    try {
      await SyncEngine.runForExport();
      for await (const row of Data.exportRecords()) validateRecord(row);
      let seq = 0, count = 0;
      await waitAck(port, seq++, { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString() });
      for await (const row of Data.exportRecords()) { validateRecord(row); await waitAck(port, seq++, row); count++; }
      port.postMessage({ done: true, count });
    } catch (error) { try { port.postMessage({ error: error.code || "export_failed" }); } catch (_) {} }
  }
  return { FORMAT, VERSION, validateHeader, validateRecord, attachPort };
})();

if (globalThis.chrome?.runtime?.onConnect) chrome.runtime.onConnect.addListener(Transfer.attachPort);
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.source !== "AMS_TRANSFER" || !["validateImport", "importBatch"].includes(msg.action)) return;
  Promise.resolve().then(async () => {
    if (msg.action === "validateImport") {
      Transfer.validateHeader(msg.header);
      for (const row of msg.records || []) Transfer.validateRecord(row);
    } else {
      for (const row of msg.records || []) Transfer.validateRecord(row);
      await Data.importRecords(msg.records || []);
    }
    return {};
  }).then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, code: error.code || "import_failed" }));
  return true;
});
