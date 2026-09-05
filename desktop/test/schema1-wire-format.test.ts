import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import type { DriveFile } from "../src/main/drive-client";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";

// Drive schema 1 线格式真源：fixtures/schema1-*.json 由扩展侧实现生成（见 fixtures/README.md）。
// 这里把全部样本喂给同步下行链路，要求逐条接收、零 corrupt。任何一次校验收紧命中存量形状，先红在这里。

interface WireFixture { readonly file: DriveFile; readonly body: unknown }

function loadFixtures(): Map<string, WireFixture> {
  const directory = path.join(__dirname, "fixtures");
  const names = readdirSync(directory).filter((name) => /^schema1-.*\.json$/.test(name)).sort();
  assert.ok(names.length >= 7, `fixtures/ 下 schema1-*.json 只找到 ${names.length} 个`);
  return new Map(names.map((name) => [name, JSON.parse(readFileSync(path.join(directory, name), "utf8")) as WireFixture]));
}

const auth = (): SyncAuth => ({ configured: () => true, securePersistence: () => true, connect: async () => undefined, disconnect: async () => undefined });

test("every frozen schema 1 record from the extension era is imported without being counted corrupt", async () => {
  const fixtures = loadFixtures();
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  const files = [...fixtures.values()].map((fixture) => fixture.file);
  const bodies = new Map([...fixtures.values()].map((fixture) => [fixture.file.id, fixture.body]));
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => files,
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async (fileId) => bodies.get(fileId),
    upsert: async (_id, name, appProperties) => ({ id: `uploaded-${name}`, appProperties }),
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth() }).syncNow();
    assert.equal(status.state, "idle");
    assert.equal(status.readOnly, false);
    for (const [name, fixture] of fixtures) {
      assert.ok(repository.driveFile(fixture.file.id), `${name} 被当成 corrupt 拒收（Drive 索引里没有它）：校验收紧命中了存量线格式`);
    }
    assert.equal(repository.config().errorCount, 0, "有样本被当成 corrupt：校验收紧命中了存量线格式");
    const props = (name: string) => fixtures.get(name)!.file.appProperties!;
    // 结果库：混合结果（no_window / no_answer / timeout、state 与 code 为 null）与 update 过的记录都要原样落库
    const mixed = repository.archive(props("schema1-archive-mixed.json").id);
    assert.ok(mixed && !("deletedAt" in mixed));
    assert.deepEqual(mixed.results.map((result) => result.code ?? null), [null, "no_window", "no_answer", null, "timeout"]);
    const updated = repository.archive(props("schema1-archive-updated.json").id);
    assert.ok(updated && !("deletedAt" in updated));
    assert.deepEqual(updated.tags, ["物理", "光学"]);
    assert.equal(updated.winnerHost, "claude.ai");
    assert.equal(updated.synthesis?.instruction, "指出分歧");
    assert.equal(updated.source?.kind, "page");
    // 边界样本：线格式允许的上限（host/label 256、state/code 64、text 空串）必须原样接收
    const bounds = repository.archive(props("schema1-archive-bounds.json").id);
    assert.ok(bounds && !("deletedAt" in bounds));
    assert.equal(bounds.results[0].label.length, 256);
    assert.equal(bounds.results[1].code?.length, 64);
    assert.equal(bounds.results[2].text, "");
    const gone = repository.archive(props("schema1-archive-tombstone.json").id);
    assert.ok(gone && "deletedAt" in gone);
    assert.deepEqual(database.archives.list().map((record) => record.id).sort(), [bounds.id, mixed.id, updated.id].sort());
    // 历史：正文 sha256 对得上 textHash 才会被收；tombstone 也要落
    const live = repository.history(props("schema1-history.json").id);
    assert.ok(live && !("deletedAt" in live) && live.text.length > 0);
    const deleted = repository.history(props("schema1-history-tombstone.json").id);
    assert.ok(deleted && "deletedAt" in deleted);
    // state fragment：amsConsole.selected → 工作区勾选；带 hosts 的 group → 本机分组；模板落库，tombstone 不出现
    const workspace = database.state.get<{ selectedSites: string[]; tier: string | null }>("workspace");
    assert.deepEqual([...(workspace?.selectedSites ?? [])].sort(), ["claude", "deepseek", "kimi"]);
    assert.equal(workspace?.tier, "think");
    const group = database.state.get<{ id: string; name: string; sites: string[] }>("group:grp-cn");
    assert.equal(group?.name, "国内三家");
    assert.deepEqual([...(group?.sites ?? [])].sort(), ["deepseek", "kimi", "yuanbao"]);
    // 删除一律 tombstone：远端删掉的 group/template 以 deletedAt 落库，列表里不出现
    assert.ok("deletedAt" in (database.state.get<object>("group:grp-gone") ?? {}));
    assert.deepEqual(database.state.list<{ id: string }>("group:").filter((item) => !("deletedAt" in item)).map((item) => item.id), ["grp-cn"]);
    assert.equal(database.state.get<{ name: string }>("template:tpl-summarize")?.name, "总结");
    assert.ok("deletedAt" in (database.state.get<object>("template:tpl-gone") ?? {}));
    assert.deepEqual(database.state.list<{ id: string }>("template:").filter((item) => !("deletedAt" in item)).map((item) => item.id), ["tpl-summarize"]);
  } finally { database.close(); }
});
