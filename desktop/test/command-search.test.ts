import assert from "node:assert/strict";
import test from "node:test";

import { searchCommands } from "../src/renderer/command-search";
import { COMMANDS } from "../src/shared/commands";
import { getCopy } from "../src/shared/copy";
import type { ActiveWorkspaceGroup } from "../src/shared/workspace";

const groups: readonly ActiveWorkspaceGroup[] = [{
  id: "writing",
  name: "写作搭档",
  sites: ["claude", "chatgpt", "gemini"],
  updatedAt: 1,
  deviceId: "test"
}];

test("command search is localized and keeps registry order", () => {
  assert.deepEqual(
    searchCommands("drive", COMMANDS, getCopy("en")).map((item) => item.id),
    ["open-drive-diagnostics"]
  );
  assert.deepEqual(
    searchCommands("站点状态", COMMANDS, getCopy("zh-CN")).map((item) => item.id),
    ["open-site-health"]
  );
  assert.deepEqual(
    searchCommands("显示", COMMANDS, getCopy("zh-CN")).map((item) => item.id),
    ["show-page-1", "show-page-2", "show-page-3"]
  );
});

test("saved groups participate as dynamic commands", () => {
  const result = searchCommands("写作搭档", COMMANDS, getCopy("zh-CN"), { groups });
  assert.deepEqual(result.map((item) => item.id), ["apply-group:writing"]);
  assert.equal(result[0]?.groupId, "writing");
  assert.match(result[0]?.label ?? "", /写作搭档/);
});

test("command search matches accelerators and aliases without reordering", () => {
  const copy = getCopy("en");
  assert.deepEqual(
    searchCommands("alt+k", COMMANDS, copy).map((item) => item.id),
    ["open-command-palette"]
  );
  assert.deepEqual(
    searchCommands("f1", COMMANDS, copy).map((item) => item.id),
    ["open-command-palette"]
  );
});
