import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeWorkspacePanel,
  openWorkspacePanel,
  scopeDisplayName,
  showWorkspaceDetail
} from "../src/renderer/workspace-panel-state";
import type { ActiveWorkspaceGroup } from "../src/shared/workspace";

const groups: readonly ActiveWorkspaceGroup[] = [{
  id: "writing",
  name: "Writing",
  sites: ["claude", "chatgpt", "gemini"],
  updatedAt: 1,
  deviceId: "device-a"
}];

test("scope display uses an exact group name, custom count, and empty selection", () => {
  const labels = { selectSites: "Select sites", customScope: "Custom" };
  assert.equal(scopeDisplayName(["gemini", "claude", "chatgpt"], groups, labels), "Writing · 3");
  assert.equal(scopeDisplayName(["claude", "gemini"], groups, labels), "Custom · 2");
  assert.equal(scopeDisplayName([], groups, labels), "Select sites");
});

test("workspace panel retains input method and Escape returns through one panel", () => {
  const opened = openWorkspacePanel("health", "keyboard");
  assert.deepEqual(opened, { tab: "health", detail: null, inputMethod: "keyboard" });
  const detail = showWorkspaceDetail(opened, "gemini");
  assert.equal(escapeWorkspacePanel(detail)?.detail, null);
  assert.equal(escapeWorkspacePanel(opened), null);
});
