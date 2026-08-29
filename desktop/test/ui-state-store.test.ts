import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { UiStateStore } from "../src/main/ui-state-store";

test("UI state store writes atomically and loads the saved local value", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-ui-state-"));
  const path = join(directory, "desktop-ui-state.json");
  try {
    const store = new UiStateStore(path);
    const state = {
      windowBounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: true,
      layoutMode: "focus" as const,
      currentPage: 1,
      focusedByPage: { 0: "claude" as const, 1: "deepseek" as const }
    };
    store.save(state);

    assert.deepEqual(store.load(), state);
    store.save({ ...state, maximized: false });
    assert.deepEqual(store.load(), { ...state, maximized: false });
    assert.equal(existsSync(path), true);
    assert.deepEqual(readdirSync(directory), ["desktop-ui-state.json"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("UI state store ignores malformed or unreadable content", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-ui-state-"));
  const path = join(directory, "desktop-ui-state.json");
  try {
    const store = new UiStateStore(path);
    assert.equal(store.load(), null);
    writeFileSync(path, "{not json", "utf8");
    assert.equal(store.load(), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an immediate UI state save supersedes an older debounced value", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-ui-state-"));
  const path = join(directory, "desktop-ui-state.json");
  try {
    const store = new UiStateStore(path);
    const base = {
      maximized: false,
      layoutMode: "overview" as const,
      currentPage: 0,
      focusedByPage: { 0: "claude" as const }
    };
    store.schedule({ ...base, currentPage: 1 }, 10_000);
    store.save(base);
    store.dispose();

    assert.deepEqual(store.load(), base);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
