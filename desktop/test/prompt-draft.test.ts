import assert from "node:assert/strict";
import test from "node:test";

import { clearDraft, loadDraft, parsePromptDraft, saveDraft } from "../src/renderer/prompt-draft";
import { readSource } from "./fixtures";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("prompt drafts remain local and survive renderer reload", () => {
  const storage = new MemoryStorage();
  saveDraft(storage, "local draft", 10);
  assert.equal(loadDraft(storage).text, "local draft");
  clearDraft(storage);
  assert.equal(loadDraft(storage).text, "");
});

test("malformed or oversized draft storage is ignored", () => {
  assert.deepEqual(parsePromptDraft("bad"), { text: "", updatedAt: 0 });
  assert.deepEqual(parsePromptDraft(JSON.stringify({ text: "x".repeat(100_001), updatedAt: 1 })), {
    text: "",
    updatedAt: 0
  });
});

test("the app restores drafts locally and clears only after a confirmed send", () => {
  const app = readSource("src/renderer/index.tsx");
  assert.match(app, /loadDraft\(window\.localStorage\)/);
  assert.match(app, /saveDraft\(window\.localStorage, text\)/);
  assert.match(app, /completed[\s\S]{0,300}result\.ok/);
  assert.match(app, /clearDraft\(window\.localStorage\)/);
});
