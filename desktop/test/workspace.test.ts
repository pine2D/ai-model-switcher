import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceGroup,
  normalizeSelection,
  tombstoneWorkspaceGroup
} from "../src/shared/workspace";

test("workspace selection accepts known sites only and keeps product order", () => {
  assert.deepEqual(
    normalizeSelection(["kimi", "claude", "unknown", "kimi"]),
    ["claude", "kimi"]
  );
  assert.deepEqual(normalizeSelection(null), []);
});

test("workspace groups normalize names and keep deletion tombstones", () => {
  const group = createWorkspaceGroup(
    { id: "research", name: "  Research  ", sites: ["kimi", "claude"] },
    { now: 1_000, deviceId: "device-a" }
  );
  assert.equal(group.name, "Research");
  assert.deepEqual(group.sites, ["claude", "kimi"]);

  const deleted = tombstoneWorkspaceGroup(group, 2_000, "device-b");
  assert.deepEqual(deleted, {
    id: "research",
    updatedAt: 2_000,
    deletedAt: 2_000,
    deviceId: "device-b"
  });
});

test("workspace groups reject empty, oversized or empty-site values", () => {
  assert.throws(
    () => createWorkspaceGroup({ id: "empty", name: " ", sites: ["claude"] }, { now: 1, deviceId: "d" }),
    /invalid_group_name/
  );
  assert.throws(
    () => createWorkspaceGroup({ id: "long", name: "a".repeat(81), sites: ["claude"] }, { now: 1, deviceId: "d" }),
    /invalid_group_name/
  );
  assert.throws(
    () => createWorkspaceGroup({ id: "none", name: "None", sites: [] }, { now: 1, deviceId: "d" }),
    /invalid_group_sites/
  );
});
