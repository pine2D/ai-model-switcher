import assert from "node:assert/strict";
import test from "node:test";

import { reconcileVisibleSiteKeys } from "../src/main/view-visibility";
import type { DesktopSurface } from "../src/shared/protocol";

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
  const surface: DesktopSurface = "commands";
  assert.equal(surface, "commands");
});
