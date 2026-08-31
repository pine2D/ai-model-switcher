import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";
import { PromptLibraryService } from "../src/main/prompt-library-service";
import { SyncRepository } from "../src/main/sync-repository";
import {
  createPromptTemplate,
  isStoredPromptTemplate,
  promptTemplatesToStateFragment,
  tombstonePromptTemplate
} from "../src/shared/prompt-library";

test("prompt templates use the existing synchronized template bucket", () => {
  const template = createPromptTemplate(
    { id: "review", name: "Review", text: "Review this change" },
    { now: 10, deviceId: "device-a" }
  );
  assert.deepEqual(promptTemplatesToStateFragment([template], "device-a")[template.id], template);
  const deleted = tombstonePromptTemplate(template, 20, "device-a");
  assert.equal(deleted.deletedAt, 20);
  assert.equal("text" in deleted, false);
});

test("prompt library persists templates, tombstones and recent history", () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "device-a");
  const history = new HistoryService(database.history, { deviceId: () => "device-a", now: () => 5 });
  history.record("Earlier question");
  let now = 10;
  const service = new PromptLibraryService(database.state, database.meta, history, {
    now: () => now,
    createId: () => "template-a"
  });
  try {
    const saved = service.save({ name: "Review", text: "Review this change" });
    assert.equal(saved.id, "template-a");
    assert.deepEqual(service.getState().history.map((item) => item.text), ["Earlier question"]);
    now = 20;
    service.delete(saved.id);
    assert.equal(service.getState().templates.length, 0);
    assert.equal(database.state.get<{ deletedAt: number }>("template:template-a")?.deletedAt, 20);
  } finally { database.close(); }
});

test("prompt template validation rejects empty and oversized content", () => {
  assert.throws(() => createPromptTemplate(
    { id: "x", name: "", text: "text" },
    { now: 1, deviceId: "device-a" }
  ), /invalid_prompt_template/);
  assert.throws(() => createPromptTemplate(
    { id: "x", name: "Name", text: "x".repeat(100_001) },
    { now: 1, deviceId: "device-a" }
  ), /invalid_prompt_template/);
});

test("prompt template ingestion accepts an unnamed or overlong-named template (F212)", () => {
  // The extension's own save path has no name length/empty guard (console/compose.js),
  // so a template synced in from another device may carry an empty or 80+ code point
  // name. isStoredPromptTemplate is the sole gate main/sync-repository.ts uses when
  // merging remote templates in: rejecting on name alone made the whole record vanish
  // from this device forever. createPromptTemplate() below keeps its stricter,
  // 80-code-point local-creation guard untouched.
  assert.equal(isStoredPromptTemplate({
    id: "unnamed", name: "", text: "Untitled prompt", updatedAt: 1, deviceId: "extension-device"
  }), true);
  assert.equal(isStoredPromptTemplate({
    id: "long-name", name: "x".repeat(81), text: "Prompt", updatedAt: 1, deviceId: "extension-device"
  }), true);
  assert.throws(() => createPromptTemplate(
    { id: "x", name: "", text: "text" },
    { now: 1, deviceId: "device-a" }
  ), /invalid_prompt_template/);
});

test("prompt library keeps a synced template with no display name (F212)", () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const history = new HistoryService(database.history, { deviceId: () => "desktop-device" });
  const service = new PromptLibraryService(database.state, database.meta, history, {
    now: () => 10,
    createId: () => "local"
  });
  const repository = new SyncRepository(database);
  try {
    repository.applyStateFragments({
      remote: {
        schema: 1,
        deviceId: "extension-device",
        settings: {},
        groups: {},
        templates: {
          unnamed: { id: "unnamed", name: "", text: "Untitled prompt", updatedAt: 20, deviceId: "extension-device" }
        }
      }
    });
    assert.equal(service.getState().templates.some((item) => item.id === "unnamed"), true);
  } finally { database.close(); }
});

test("desktop templates round-trip through the existing schema 1 templates bucket", () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const history = new HistoryService(database.history, { deviceId: () => "desktop-device" });
  const service = new PromptLibraryService(database.state, database.meta, history, {
    now: () => 10,
    createId: () => "local"
  });
  const repository = new SyncRepository(database);
  try {
    service.save({ name: "Local", text: "Local prompt" });
    assert.equal((repository.localStateFragment().templates.local as { name?: string })?.name, "Local");
    repository.applyStateFragments({
      remote: {
        schema: 1,
        deviceId: "extension-device",
        settings: {},
        groups: {},
        templates: {
          shared: { id: "shared", name: "Shared", text: "Shared prompt", updatedAt: 20, deviceId: "extension-device" }
        }
      }
    });
    assert.equal(service.getState().templates.some((item) => item.id === "shared"), true);
  } finally { database.close(); }
});
