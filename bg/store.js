// bg/store.js — 同步数据的本地 IndexedDB 存储层
const SyncStore = (() => {
  const DB_NAME = "polyask", DB_VERSION = 2;
  let opening;
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  });
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result, tx = req.transaction;
        if (event.oldVersion < 1) {
          const history = db.createObjectStore("history", { keyPath: "id" });
          history.createIndex("lastUsed", ["lastUsedAt", "id"]);
          const archives = db.createObjectStore("archives", { keyPath: "id" });
          archives.createIndex("created", ["createdAt", "id"]);
          const outbox = db.createObjectStore("outbox", { keyPath: "key" });
          outbox.createIndex("next", ["nextAt", "key"]);
          outbox.createIndex("entity", ["kind", "entityId"]);
          const files = db.createObjectStore("files", { keyPath: "fileId" });
          files.createIndex("logicalKey", "logicalKey", { unique: false });
          db.createObjectStore("meta", { keyPath: "key" });
        } else if (event.oldVersion < 2) {
          const files = tx.objectStore("files"), outbox = tx.objectStore("outbox");
          files.deleteIndex("logicalKey");
          files.createIndex("logicalKey", "logicalKey", { unique: false });
          outbox.createIndex("entity", ["kind", "entityId"]);
        }
      };
      req.onblocked = () => { opening = null; reject(new Error("IndexedDB open blocked")); };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = db.onversionchange = () => { opening = null; try { db.close(); } catch (e) { /* already closed */ } };
        resolve(db);
      };
      req.onerror = () => { opening = null; reject(req.error || new Error("IndexedDB open failed")); };
    });
    return opening;
  }

  async function read(store, key) {
    const db = await open(), tx = db.transaction(store), value = await request(tx.objectStore(store).get(key));
    return value;
  }
  async function write(store, value) {
    const db = await open(), tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await done(tx);
    return value;
  }
  async function erase(store, key) {
    const db = await open(), tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await done(tx);
  }
  async function page(store, index, cursor, limit, accept) {
    const db = await open(), tx = db.transaction(store), source = tx.objectStore(store).index(index);
    const range = cursor ? IDBKeyRange.upperBound(cursor, true) : undefined;
    const items = [];
    await new Promise((resolve, reject) => {
      const req = source.openCursor(range, "prev");
      req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
      req.onsuccess = () => {
        const row = req.result;
        if (!row || items.length >= limit) return resolve();
        if (!accept || accept(row.value)) items.push(row.value);
        row.continue();
      };
    });
    const last = items[items.length - 1];
    const time = store === "history" ? "lastUsedAt" : "createdAt";
    return { items, nextCursor: items.length === limit && last ? [last[time], last.id] : null };
  }
  async function searchArchives(cursor, limit, accept) {
    return page("archives", "created", cursor, limit, (value) =>
      !Object.hasOwn(value, "deletedAt") && (!accept || accept(value)));
  }
  async function iterate(kind, visit) {
    let after = null, item;
    while ((item = await next(kind, after))) { after = item.key; await visit(item.value); }
  }
  // 纯聚合扫描：单事务 + row.continue()，代价是 visit 必须同步（await 外部 promise 会让只读事务提前提交）。
  // 需要在扫描过程中跨事务写库的场景（forget/删除）仍用 iterate 的逐条新事务写法。
  async function scanAll(kind, visit) {
    const db = await open(), tx = db.transaction(kind);
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(kind).openCursor();
      req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
      req.onsuccess = () => { const row = req.result; if (!row) return resolve(); visit(row.value); row.continue(); };
    });
  }
  async function next(kind, after) {
    const db = await open(), tx = db.transaction(kind), store = tx.objectStore(kind);
    const range = after == null ? undefined : IDBKeyRange.lowerBound(after, true);
    const row = await request(store.openCursor(range));
    return row ? { key: row.primaryKey, value: row.value } : null;
  }

  async function readyOutbox(now, limit) {
    const db = await open(), tx = db.transaction("outbox"), source = tx.objectStore("outbox").index("next");
    const items = [];
    await new Promise((resolve, reject) => {
      const req = source.openCursor(IDBKeyRange.upperBound([now, "\uffff"]));
      req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
      req.onsuccess = () => {
        const row = req.result;
        if (!row || items.length >= limit) return resolve();
        items.push(row.value); row.continue();
      };
    });
    return items;
  }
  async function countOutbox() {
    const db = await open(), tx = db.transaction("outbox");
    return request(tx.objectStore("outbox").count());
  }
  async function findFile(logicalKey) {
    const db = await open(), tx = db.transaction("files");
    const row = await request(tx.objectStore("files").index("logicalKey").openCursor(IDBKeyRange.only(logicalKey)));
    return row?.value;
  }
  async function enqueue(op) {
    const db = await open(), tx = db.transaction("outbox", "readwrite"), store = tx.objectStore("outbox"), completion = done(tx);
    const current = await request(store.get(op.key)), value = { ...op, revision: (current?.revision || 0) + 1 };
    store.put(value); await completion; return value;
  }
  async function completeOutbox(key, revision) {
    const db = await open(), tx = db.transaction("outbox", "readwrite"), store = tx.objectStore("outbox"), completion = done(tx);
    const current = await request(store.get(key));
    if (current && (current.revision || 0) === (revision || 0)) store.delete(key);
    await completion;
  }
  async function setEntityFile(kind, id, fileId, expectedFileId, ownerId) {
    const name = kind === "history" ? "history" : "archives", db = await open();
    const tx = db.transaction(name, "readwrite"), store = tx.objectStore(name), completion = done(tx), value = await request(store.get(id));
    if (value && (expectedFileId === undefined || value.fileId === expectedFileId)) {
      const nextValue = { ...value };
      if (fileId) nextValue.fileId = fileId; else delete nextValue.fileId;
      if (ownerId) nextValue.deviceId = ownerId;
      store.put(nextValue);
    }
    await completion;
  }
  async function markFile(fileId, seenAt) {
    if (!fileId) return;
    const db = await open(), tx = db.transaction("files", "readwrite"), store = tx.objectStore("files"), completion = done(tx);
    const current = await request(store.get(fileId)); store.put({ ...current, fileId, seenAt });
    await completion;
  }
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  function sameEntityVersion(kind, current, expected) {
    if (!current || current.fileId !== expected.fileId || current.deviceId !== expected.deviceId) return false;
    if (kind === "history") return compareEntityVersion(kind, current, expected) === 0 && has(current, "deletedAt") === has(expected, "deletedAt");
    return current.updatedAt === expected.updatedAt && has(current, "deletedAt") === has(expected, "deletedAt") &&
      (!has(current, "deletedAt") || current.deletedAt === expected.deletedAt);
  }
  function compareEntityVersion(kind, left, right) {
    const time = (value) => kind === "history" ? Math.max(Number(value.updatedAt) || 0, Number(value.deletedAt) || 0, Number(value.lastUsedAt) || 0) :
      Math.max(Number(value.updatedAt) || 0, Number(value.deletedAt) || 0, Number(value.createdAt) || 0);
    const byTime = time(left) - time(right);
    if (byTime) return byTime;
    if (has(left, "deletedAt") !== has(right, "deletedAt")) return has(left, "deletedAt") ? 1 : -1;
    return String(left.deviceId || "").localeCompare(String(right.deviceId || ""));
  }
  async function hydrateEntity(kind, id, expected, body) {
    const name = kind === "history" ? "history" : "archives", db = await open();
    const tx = db.transaction(name, "readwrite"), store = tx.objectStore(name), completion = done(tx), current = await request(store.get(id));
    let result = { record: current, hydrated: false };
    if (sameEntityVersion(kind, current, expected) && current.text == null && !has(current, "deletedAt")) {
      const candidate = { ...body, deviceId: body.deviceId ?? current.deviceId };
      if (compareEntityVersion(kind, candidate, current) >= 0) {
        const newer = compareEntityVersion(kind, candidate, current) > 0;
        const next = newer ? { ...current, ...candidate, fileId: current.fileId } : { ...candidate, ...current, text: body.text };
        if (kind === "archive" && has(candidate, "deletedAt")) { delete next.text; delete next.results; }
        else if (kind === "archive") next.results = body.results;
        store.put(next); result = { record: next, hydrated: true };
      }
    }
    await completion; return result;
  }
  async function trimBodies(historyLimit = 200, archiveLimit = 50) {
    const db = await open(), tx = db.transaction(["history", "archives", "outbox"], "readwrite");
    const completion = done(tx), pending = tx.objectStore("outbox").index("entity");
    const trim = (store, index, kind, limit, fields) => new Promise((resolve, reject) => {
      let kept = 0, req = tx.objectStore(store).index(index).openCursor(null, "prev");
      req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
      req.onsuccess = () => {
        const row = req.result;
        if (!row) return resolve();
        const value = row.value, hasBody = fields.some((field) => value[field] != null);
        if (!hasBody || kept++ < limit || !value.fileId) return row.continue();
        const check = pending.get([kind, value.id]);
        check.onerror = () => reject(check.error || new Error("IndexedDB request failed"));
        check.onsuccess = () => {
          if (!check.result) { for (const field of fields) delete value[field]; row.update(value); }
          row.continue();
        };
      };
    });
    await Promise.all([
      trim("history", "lastUsed", "history", historyLimit, ["text"]),
      trim("archives", "created", "archive", archiveLimit, ["text", "results"]),
    ]);
    await completion;
  }
  async function clearLocalData() {
    const db = await open(), tx = db.transaction(["history", "archives", "outbox", "files", "meta"], "readwrite");
    for (const name of ["history", "archives", "outbox", "files", "meta"]) tx.objectStore(name).clear();
    await done(tx);
  }

  return {
    open, getMeta: (key) => read("meta", key).then((row) => row && row.value), putMeta: (key, value) => write("meta", { key, value }), deleteMeta: (key) => erase("meta", key),
    putHistory: (record) => write("history", record), getHistory: (id) => read("history", id), pageHistory: (cursor, limit) => page("history", "lastUsed", cursor, limit, (value) => !has(value, "deletedAt")),
    putArchive: (record) => write("archives", record), getArchive: (id) => read("archives", id), pageArchives: (cursor, limit) => searchArchives(cursor, limit), searchArchives,
    enqueue, readyOutbox, completeOutbox, countOutbox,
    putFile: (file) => write("files", file), getFile: (fileId) => read("files", fileId), findFile,
    deleteFile: (fileId) => erase("files", fileId),
    setEntityFile, markFile, hydrateEntity, trimBodies, clearLocalData, iterate, scanAll, next,
  };
})();
