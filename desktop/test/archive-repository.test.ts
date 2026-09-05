import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { isArchiveRecord } from "../src/shared/archive";
import { archiveFixture } from "./fixtures";

test("a stored archive row that no longer satisfies the current validator is still listed", () => {
  // 存量记录是按当年的校验入库的；读路径若再跑一遍今天的 isArchiveRecord，校验一收紧记录就静默消失。
  const directory = mkdtempSync(join(tmpdir(), "polyask-legacy-archive-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    first.archives.put(archiveFixture(), false);
    first.close();
    const legacy = { ...archiveFixture(), results: [{ host: "claude.ai", label: "L".repeat(300), text: "Rayleigh scattering." }] };
    assert.equal(isArchiveRecord(legacy), false, "夹具必须真的不合今天的校验，否则这条断言没在测任何东西");
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE archives SET body = ? WHERE id = ?").run(JSON.stringify(legacy), legacy.id);
    raw.close();
    const reopened = DesktopDatabase.open(path);
    assert.deepEqual(reopened.archives.list().map((record) => record.id), [legacy.id]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
