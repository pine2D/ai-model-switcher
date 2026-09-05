import assert from "node:assert/strict";
import test from "node:test";

import { reconcileVisibleSiteKeys } from "../src/main/view-visibility";
import { readSource } from "./fixtures";

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
  const protocol = readSource("src/shared/protocol.ts");
  assert.match(protocol, /export type DesktopSurface =[^\n]*"commands"/);
});

test("unread badges are only cleared while the site surface is showing", () => {
  const manager = readSource("src/main/view-manager.ts");
  const clear = manager.slice(
    manager.indexOf("private clearVisibleUnread("),
    manager.indexOf("private isSiteVisible(")
  );
  assert.ok(clear.length > 0);
  assert.match(clear, /this\.surface !== "sites"[\s\S]{0,20}return;/);
});

test("restored focus prefers the site remembered for the restored page", () => {
  const manager = readSource("src/main/view-manager.ts");
  const constructor = manager.slice(
    manager.indexOf("const initial = options.initialUiState;"),
    manager.indexOf("setPermissionCheckHandler")
  );
  assert.match(
    constructor,
    /resolveFocusedSite\(\s*current\.keys,\s*this\.focusedByPage\.get\(current\.page\) \?\? this\.focused,\s*this\.focused\s*\)/
  );
});
