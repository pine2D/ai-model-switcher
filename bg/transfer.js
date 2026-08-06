// bg/transfer.js — JSONL 迁移包格式与背压导出
const Transfer = (() => {
  const FORMAT = "polyask-transfer", VERSION = 1;
  const KINDS = new Set(["setting", "template", "group", "history", "archive"]);
  const coded = (code) => Object.assign(new Error(code), { code });
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const text = (value, key) => typeof value[key] === "string" && value[key].length > 0;
  const validTime = SyncModel.validTime || ((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const time = (value, key) => validTime(value[key]);
  function validateHeader(row) {
    if (row?.format !== FORMAT) throw coded("invalid_header");
    if (row.version > VERSION) throw coded("newer_format");
    if (row.version !== VERSION || typeof row.exportedAt !== "string" || !validTime(Date.parse(row.exportedAt))) throw coded("invalid_header");
    return true;
  }
  function validateKindValue(kind, value) {
    if (!object(value)) throw coded("invalid_record");
    for (const key of ["createdAt", "lastUsedAt", "updatedAt", "deletedAt"])
      if (Object.hasOwn(value, key) && !time(value, key)) throw coded("invalid_record");
    const tombstone = value.deletedAt != null && time(value, "deletedAt");
    const valid = kind === "setting" ? text(value, "key") && Object.hasOwn(value, "value") && time(value, "updatedAt") && text(value, "deviceId")
      : kind === "template" ? text(value, "id") && time(value, "updatedAt") && (tombstone || typeof value.text === "string")
      : kind === "group" ? text(value, "id") && time(value, "updatedAt") && (tombstone || text(value, "name") && Array.isArray(value.hosts))
      : kind === "history" ? text(value, "id") && text(value, "textHash") && time(value, "createdAt") && time(value, "lastUsedAt") &&
        (tombstone ? time(value, "updatedAt") && text(value, "deviceId") && Number(value.schema) === SyncModel.SCHEMA : text(value, "text"))
      : text(value, "id") && time(value, "createdAt") && (time(value, "deletedAt") ||
        typeof value.text === "string" && Array.isArray(value.results) && ArchiveModel.validMetadata(value));
    if (!valid) throw coded("invalid_record");
  }
  function validateRecord(row) {
    if (!KINDS.has(row?.kind)) throw coded("unknown_kind");
    validateKindValue(row.kind, row.value);
    return true;
  }
  async function validateContent(row) {
    validateRecord(row);
    const value = row.value;
    if (row.kind === "history" && (value.id !== value.textHash || !Object.hasOwn(value, "deletedAt") && value.textHash !== await SyncModel.hashText(value.text))) throw coded("invalid_record");
    if (row.kind === "archive" && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) throw coded("invalid_record");
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
    let cancelled = false, iterator;
    const onDisconnect = () => { cancelled = true; };
    const live = () => { if (cancelled) throw coded("export_cancelled"); };
    port.onDisconnect.addListener(onDisconnect);
    try {
      live();
      await SyncEngine.runForExport();
      live();
      iterator = Data.exportRecords()[Symbol.asyncIterator]();
      for (;;) { live(); const next = await iterator.next(); live(); if (next.done) break; await validateContent(next.value); }
      let seq = 0, count = 0;
      live();
      await waitAck(port, seq++, { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString() });
      iterator = Data.exportRecords()[Symbol.asyncIterator]();
      for (;;) {
        live(); const next = await iterator.next(); live(); if (next.done) break;
        await validateContent(next.value); live(); await waitAck(port, seq++, next.value); count++;
      }
      live();
      port.postMessage({ done: true, count });
    } catch (error) { if (!cancelled) try { port.postMessage({ error: error.code || "export_failed" }); } catch (_) {} }
    finally { try { await iterator?.return?.(); } catch (_) {} port.onDisconnect.removeListener(onDisconnect); }
  }
  return { FORMAT, VERSION, validateHeader, validateRecord, validateContent, attachPort };
})();

if (globalThis.chrome?.runtime?.onConnect) chrome.runtime.onConnect.addListener(Transfer.attachPort);
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.source !== "AMS_TRANSFER" || !["validateImport", "importBatch", "finishImport"].includes(msg.action)) return;
  Promise.resolve().then(async () => {
    if (msg.action === "validateImport") {
      Transfer.validateHeader(msg.header);
      for (const row of msg.records || []) await Transfer.validateContent(row);
    } else {
      if (msg.action === "finishImport") await SyncEngine.finishImport();
      else {
        for (const row of msg.records || []) await Transfer.validateContent(row);
        const changed = await Data.importRecords(msg.records || []);
        if (changed?.histories) chrome.runtime.sendMessage({ source: "AMS_DATA", type: "historyChanged" });
        if (changed?.archives) chrome.runtime.sendMessage({ source: "AMS_DATA", type: "archiveChanged" });
      }
    }
    return {};
  }).then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, code: error.code || "import_failed" }));
  return true;
});
