import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { SITES } from "../src/main/sites";
import { WorkspaceService } from "../src/main/workspace-service";

function fixture() {
  const database = DesktopDatabase.open(":memory:");
  const navigations: Array<readonly [string, string]> = [];
  let now = 1_000;
  let id = 0;
  const service = new WorkspaceService(
    database.state,
    database.meta,
    (site, url) => { navigations.push([site, url]); },
    {
      now: () => now,
      createId: () => `group-${++id}`,
      createDeviceId: () => "device-a"
    }
  );
  return { database, navigations, service, setNow: (value: number) => { now = value; } };
}

test("workspace defaults to all sites and persists strict selection and tier", () => {
  const { database, service } = fixture();
  try {
    assert.deepEqual(service.getState().selectedSites, SITES.map((site) => site.key));
    assert.deepEqual(service.setSelection(["kimi", "claude"]).selectedSites, ["claude", "kimi"]);
    assert.equal(service.setTier("think").tier, "think");
    assert.deepEqual(service.getState().selectedSites, ["claude", "kimi"]);
    assert.equal(service.getState().tier, "think");
    assert.throws(() => service.setSelection(["claude", "claude"]), /duplicate_site/);
    assert.throws(() => service.setSelection(["unknown"]), /unknown_site/);
    assert.throws(() => service.setTier("slow"), /invalid_tier/);
  } finally {
    database.close();
  }
});

test("workspace groups reject invalid values and deletion writes a tombstone", () => {
  const { database, service, setNow } = fixture();
  try {
    const saved = service.saveGroup({ name: "  Research  ", sites: ["kimi", "claude"] });
    assert.equal(saved.id, "group-1");
    assert.equal(saved.name, "Research");
    assert.deepEqual(saved.sites, ["claude", "kimi"]);
    assert.deepEqual(service.getState().groups, [saved]);

    assert.throws(() => service.saveGroup({ name: "Empty", sites: [] }), /invalid_group_sites/);
    assert.throws(() => service.saveGroup({ name: "Long".repeat(21), sites: ["claude"] }), /invalid_group_name/);
    assert.throws(() => service.saveGroup({ name: "Unknown", sites: ["unknown"] }), /unknown_site/);
    assert.throws(
      () => service.saveGroup({ name: "Built in", sites: SITES.filter((site) => site.image).map((site) => site.key) }),
      /reserved_group_sites/
    );
    assert.throws(
      () => service.saveGroup({ name: "Duplicate", sites: ["kimi", "claude"] }),
      /duplicate_group_sites/
    );

    setNow(2_000);
    const deleted = service.deleteGroup(saved.id);
    assert.deepEqual(deleted, {
      id: "group-1",
      updatedAt: 2_000,
      deletedAt: 2_000,
      deviceId: "device-a"
    });
    assert.deepEqual(service.getState().groups, []);
    assert.deepEqual(database.state.get(`group:${saved.id}`), deleted);
  } finally {
    database.close();
  }
});

test("new session returns canonical outcomes for every selected site", async () => {
  const { database, navigations, service } = fixture();
  try {
    const results = await service.newSession(["claude", "kimi"]);
    assert.deepEqual(results, [
      { site: "claude", ok: true },
      { site: "kimi", ok: true }
    ]);
    assert.deepEqual(navigations, [
      ["claude", "https://claude.ai/new"],
      ["kimi", "https://www.kimi.com/"]
    ]);
    await assert.rejects(() => service.newSession([]), /no_selected_sites/);
    await assert.rejects(() => service.newSession(["claude", "claude"]), /duplicate_site/);
  } finally {
    database.close();
  }
});

test("new session preserves all selected-site outcomes when one navigation fails", async () => {
  const database = DesktopDatabase.open(":memory:");
  const navigations: string[] = [];
  try {
    const service = new WorkspaceService(
      database.state,
      database.meta,
      async (site) => {
        navigations.push(site);
        if (site === "gemini") throw new Error("navigation failed");
      }
    );
    const results = await service.newSession(["deepseek", "claude", "kimi", "gemini", "chatgpt"]);
    assert.deepEqual(results, [
      { site: "claude", ok: true },
      { site: "chatgpt", ok: true },
      { site: "gemini", ok: false, code: "not_ready" },
      { site: "deepseek", ok: true },
      { site: "kimi", ok: true }
    ]);
    assert.deepEqual(navigations, ["claude", "chatgpt", "gemini", "deepseek", "kimi"]);
  } finally {
    database.close();
  }
});

test("new session invalidates only after accepting a normalized selection", async () => {
  const database = DesktopDatabase.open(":memory:");
  const invalidations: string[][] = [];
  try {
    const options = {
      onNewSession: (sites: readonly string[]) => { invalidations.push([...sites]); }
    };
    const service = new WorkspaceService(
      database.state,
      database.meta,
      () => undefined,
      options
    );
    await service.newSession(["kimi", "claude"]);
    assert.deepEqual(invalidations, [["claude", "kimi"]]);
    await assert.rejects(() => service.newSession([]), /no_selected_sites/);
    await assert.rejects(() => service.newSession(["claude", "claude"]), /duplicate_site/);
    await assert.rejects(() => service.newSession(["unknown"]), /unknown_site/);
    assert.deepEqual(invalidations, [["claude", "kimi"]]);
  } finally {
    database.close();
  }
});

test("new session invalidates the active run before the first navigation", async () => {
  const database = DesktopDatabase.open(":memory:");
  const events: string[] = [];
  try {
    const service = new WorkspaceService(
      database.state,
      database.meta,
      (site) => { events.push(`navigate:${site}`); },
      { onNewSession: (sites) => { events.push(`invalidate:${sites.join(",")}`); } }
    );

    await service.newSession(["kimi", "claude"]);

    assert.deepEqual(events, ["invalidate:claude,kimi", "navigate:claude", "navigate:kimi"]);
  } finally {
    database.close();
  }
});

test("state outbox keeps independent workspace entities", () => {
  const { database, service } = fixture();
  try {
    service.setSelection(["claude"]);
    service.saveGroup({ name: "Research", sites: ["claude"] });
    assert.equal(database.outbox.count(), 2);
  } finally {
    database.close();
  }
});
