import assert from "node:assert/strict";
import test from "node:test";

import { SITES } from "../src/main/sites";

test("desktop registers the same nine independent AI services", () => {
  assert.equal(SITES.length, 9);
  assert.equal(new Set(SITES.map((site) => site.key)).size, 9);
  assert.equal(new Set(SITES.map((site) => site.url)).size, 9);
  assert.ok(SITES.every((site) => site.url.startsWith("https://")));
});

test("desktop keeps the stable product order", () => {
  assert.deepEqual(
    SITES.map((site) => site.key),
    [
      "claude",
      "chatgpt",
      "gemini",
      "doubao",
      "deepseek",
      "qianwen",
      "kimi",
      "yuanbao",
      "chatglm"
    ]
  );
});
