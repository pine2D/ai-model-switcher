// bg/store.js — 同步数据的本地 IndexedDB 存储层
const SyncStore = (() => {
  const DB_NAME = "polyask", DB_VERSION = 1;
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
      req.onupgradeneeded = () => {
        const db = req.result;
        const history = db.createObjectStore("history", { keyPath: "id" });
        history.createIndex("lastUsed", ["lastUsedAt", "id"]);
        const archives = db.createObjectStore("archives", { keyPath: "id" });
        archives.createIndex("created", ["createdAt", "id"]);
        const outbox = db.createObjectStore("outbox", { keyPath: "key" });
        outbox.createIndex("next", ["nextAt", "key"]);
        const files = db.createObjectStore("files", { keyPath: "fileId" });
        files.createIndex("logicalKey", "logicalKey", { unique: true });
        db.createObjectStore("meta", { keyPath: "key" });
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
    const db = await open(), tx = db.transaction(kind), values = await request(tx.objectStore(kind).getAll());
    for (const value of values) await visit(value);
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
    return request(tx.objectStore("files").index("logicalKey").get(logicalKey));
  }
  async function trimBodies(historyLimit = 200, archiveLimit = 50) {
    const db = await open(), tx = db.transaction(["history", "archives", "outbox"], "readwrite");
    const pending = new Set((await request(tx.objectStore("outbox").getAll()))
      .map((op) => `${op.kind}:${op.entityId}`));
    const trim = (store, index, limit, fields) => new Promise((resolve, reject) => {
      let kept = 0, req = tx.objectStore(store).index(index).openCursor(null, "prev");
      req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
      req.onsuccess = () => {
        const row = req.result;
        if (!row) return resolve();
        const value = row.value;
        if (kept++ >= limit && value.fileId && !pending.has(`${store === "history" ? "history" : "archive"}:${value.id}`)) {
          for (const field of fields) delete value[field];
          row.update(value);
        }
        row.continue();
      };
    });
    await trim("history", "lastUsed", historyLimit, ["text"]);
    await trim("archives", "created", archiveLimit, ["text", "results"]);
    await done(tx);
  }

  return {
    open, getMeta: (key) => read("meta", key).then((row) => row && row.value), putMeta: (key, value) => write("meta", { key, value }),
    putHistory: (record) => write("history", record), getHistory: (id) => read("history", id), pageHistory: (cursor, limit) => page("history", "lastUsed", cursor, limit),
    putArchive: (record) => write("archives", record), getArchive: (id) => read("archives", id), pageArchives: (cursor, limit) => page("archives", "created", cursor, limit, (value) => !value.deletedAt),
    enqueue: (op) => write("outbox", op), readyOutbox, completeOutbox: (key) => erase("outbox", key), countOutbox,
    putFile: (file) => write("files", file), findFile, deleteFile: (fileId) => erase("files", fileId), trimBodies, iterate,
  };
})();
