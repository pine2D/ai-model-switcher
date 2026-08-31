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
      "deepseek",
      "doubao",
      "qianwen",
      "kimi",
      "yuanbao",
      "chatglm"
    ]
  );
});

test("site capabilities support scope presets without renderer-owned host lists", () => {
  assert.deepEqual(
    SITES.filter((site) => site.image).map((site) => site.key),
    ["claude", "chatgpt", "deepseek", "doubao", "kimi", "yuanbao"]
  );
  assert.deepEqual(
    SITES.filter((site) => site.intl).map((site) => site.key),
    ["claude", "chatgpt", "gemini"]
  );
});
