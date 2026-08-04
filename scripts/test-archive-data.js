#!/usr/bin/env node
"use strict";
const assert = require("node:assert"), fs = require("node:fs"), vm = require("node:vm");

const archives = new Map(), outbox = new Map(), meta = new Map();
const SyncStore = {
  getArchive: async (id) => archives.get(id),
  putArchive: async (row) => (archives.set(row.id, row), row),
  enqueue: async (row) => (outbox.set(row.key, row), row),
  trimBodies: async () => {},
  searchArchives: async (_cursor, limit, accept) => {
    const items = [...archives.values()].sort((a, b) => b.createdAt - a.createdAt).filter(accept).slice(0, limit);
    return { items, nextCursor: null };
  },
  iterate: async (kind, visit) => { if (kind === "archives") for (const row of archives.values()) await visit(row); },
  getMeta: async (key) => meta.get(key),
  putMeta: async (key, value) => meta.set(key, value),
};
const chrome = { storage: { local: { get: async (defaults) => defaults, set: async () => {} } } };
const scope = vm.createContext({ SyncStore, SyncModel: { SCHEMA: 1, utf8Preview: (text) => text }, chrome,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" }, Date });
vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8") + ";this.model=ArchiveModel", scope);
vm.runInContext(fs.readFileSync("bg/data.js", "utf8") + ";this.data=Data", scope);

async function main() {
  const data = scope.data;
  const added = await data.addArchive({ text: "Prompt", task: "Question", results: [{ host: "a", label: "A", text: "Answer" }] });
  assert.equal(added.schema, 1);
  assert.equal(added.preview, "Prompt");
  const changed = await data.updateArchive(added.id, { favorite: true, tags: ["work"], note: "keep", winnerHost: "a" });
  assert.equal(changed.favorite, true);
  assert.equal(outbox.get(`archive:${added.id}`).kind, "archive");
  const page = await data.searchArchives(null, 50, { query: "keep", favorite: true, tag: "work" });
  assert.deepEqual(page.items.map((item) => item.id), [added.id]);
  assert.deepEqual(await data.archiveTags(), ["work"]);
  console.log("archive-data tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
