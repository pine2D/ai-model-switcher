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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
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
  async function iterate(kind, visit) {
    let after = null, item;
    while ((item = await next(kind, after))) { after = item.key; await visit(item.value); }
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

  return {
    open, getMeta: (key) => read("meta", key).then((row) => row && row.value), putMeta: (key, value) => write("meta", { key, value }), deleteMeta: (key) => erase("meta", key),
    putHistory: (record) => write("history", record), getHistory: (id) => read("history", id), pageHistory: (cursor, limit) => page("history", "lastUsed", cursor, limit),
    putArchive: (record) => write("archives", record), getArchive: (id) => read("archives", id), pageArchives: (cursor, limit) => page("archives", "created", cursor, limit, (value) => !Object.hasOwn(value, "deletedAt")),
    enqueue, readyOutbox, completeOutbox, countOutbox,
    putFile: (file) => write("files", file), getFile: (fileId) => read("files", fileId), findFile,
    deleteFile: (fileId) => erase("files", fileId),
    setEntityFile, trimBodies, iterate, next,
  };
})();
