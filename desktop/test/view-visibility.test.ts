import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { reconcileVisibleSiteKeys } from "../src/main/view-visibility";

test("view reconciliation detaches inactive pages and attaches only newly visible sites", () => {
  assert.deepEqual(
    reconcileVisibleSiteKeys(
      ["claude", "chatgpt", "gemini", "doubao", "deepseek", "qianwen"],
      ["kimi", "yuanbao", "chatglm"]
    ),
    {
      attach: ["kimi", "yuanbao", "chatglm"],
      detach: ["claude", "chatgpt", "gemini", "doubao", "deepseek", "qianwen"]
    }
  );
  assert.deepEqual(
    reconcileVisibleSiteKeys(["claude", "chatgpt"], ["chatgpt", "gemini"]),
    { attach: ["gemini"], detach: ["claude"] }
  );
});

test("commands is a supported shell surface", () => {
  const protocol = readFileSync("src/shared/protocol.ts", "utf8");
  assert.match(protocol, /export type DesktopSurface =[^\n]*"commands"/);
});

test("unread badges are only cleared while the site surface is showing", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const clear = manager.slice(
    manager.indexOf("private clearVisibleUnread("),
    manager.indexOf("private isSiteVisible(")
  );
  assert.ok(clear.length > 0);
  assert.match(clear, /this\.surface !== "sites"[\s\S]{0,20}return;/);
});

test("restored focus prefers the site remembered for the restored page", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const constructor = manager.slice(
    manager.indexOf("const initial = options.initialUiState;"),
    manager.indexOf("setPermissionCheckHandler")
  );
  assert.match(
    constructor,
    /resolveFocusedSite\(\s*current\.keys,\s*this\.focusedByPage\.get\(current\.page\) \?\? this\.focused,\s*this\.focused\s*\)/
  );
});
