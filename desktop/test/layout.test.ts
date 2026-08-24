import assert from "node:assert/strict";
import test from "node:test";

import {
  computeViewLayout,
  resolveLayoutMode,
  scaleBounds,
  swapFocusedSite
} from "../src/main/layout";
import { SITES } from "../src/main/sites";
import { reserveWorkspaceArea } from "../src/main/workspace-layout";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const keys = SITES.map((site) => site.key);

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

test("overview lays out nine visible non-overlapping views", () => {
  const layout = computeViewLayout(keys, area, { mode: "overview", gap: 8 });

  assert.equal(layout.length, 9);
  for (const item of layout) {
    assert.ok(item.bounds.width > 0 && item.bounds.height > 0);
    assert.ok(item.bounds.x >= area.x && item.bounds.y >= area.y);
    assert.ok(item.bounds.x + item.bounds.width <= area.width);
    assert.ok(item.bounds.y + item.bounds.height <= area.height);
  }
  for (let left = 0; left < layout.length; left += 1) {
    for (let right = left + 1; right < layout.length; right += 1) {
      assert.equal(overlaps(layout[left].bounds, layout[right].bounds), false);
    }
  }
});

test("wide focus uses a four by three mosaic with a two by two primary", () => {
  const layout = computeViewLayout(keys, { x: 0, y: 0, width: 1600, height: 900 }, {
    mode: "focus",
    focused: "claude",
    gap: 4
  });
  const primary = layout.find((item) => item.key === "claude");
  const secondary = layout.filter((item) => item.key !== "claude");

  assert.equal(layout.length, 9);
  assert.deepEqual(primary?.bounds, { x: 0, y: 0, width: 798, height: 599 });
  assert.equal(secondary.length, 8);
  assert.deepEqual(secondary.map((item) => item.bounds), [
    { x: 802, y: 0, width: 397, height: 298 },
    { x: 1203, y: 0, width: 397, height: 298 },
    { x: 802, y: 302, width: 397, height: 297 },
    { x: 1203, y: 302, width: 397, height: 297 },
    { x: 0, y: 603, width: 397, height: 297 },
    { x: 401, y: 603, width: 397, height: 297 },
    { x: 802, y: 603, width: 397, height: 297 },
    { x: 1203, y: 603, width: 397, height: 297 }
  ]);
});

test("narrow focus uses a three by four mosaic", () => {
  const layout = computeViewLayout(keys, { x: 0, y: 0, width: 1200, height: 800 }, {
    mode: "focus",
    focused: "claude",
    gap: 4
  });

  assert.deepEqual(layout.find((item) => item.key === "claude")?.bounds, {
    x: 0,
    y: 0,
    width: 799,
    height: 398
  });
  assert.deepEqual(layout.filter((item) => item.key !== "claude").map((item) => item.bounds), [
    { x: 803, y: 0, width: 397, height: 197 },
    { x: 803, y: 201, width: 397, height: 197 },
    { x: 0, y: 402, width: 398, height: 197 },
    { x: 402, y: 402, width: 397, height: 197 },
    { x: 803, y: 402, width: 397, height: 197 },
    { x: 0, y: 603, width: 398, height: 197 },
    { x: 402, y: 603, width: 397, height: 197 },
    { x: 803, y: 603, width: 397, height: 197 }
  ]);
});

test("overview requires every tile to meet width and height floors", () => {
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1147, height: 900 }, 4),
    "focus"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1148, height: 900 }, 4),
    "overview"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 620 }, 4),
    "focus"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 638 }, 4),
    "overview"
  );
  assert.equal(resolveLayoutMode("focus", area, 4), "focus");
});

test("focus changes swap only the current and requested sites", () => {
  assert.deepEqual(
    swapFocusedSite(keys, "claude", "gemini"),
    ["gemini", "chatgpt", "claude", "doubao", "deepseek", "qianwen", "kimi", "yuanbao", "chatglm"]
  );
});

test("shell zoom converts CSS layout coordinates back to native DIP bounds", () => {
  assert.deepEqual(
    scaleBounds({ x: 10, y: 20, width: 101, height: 51 }, 1.25),
    { x: 13, y: 25, width: 126, height: 64 }
  );
});

test("opening the scope drawer reserves width instead of covering site views", () => {
  const reserved = reserveWorkspaceArea(area, 280);
  const placements = computeViewLayout(keys, reserved, { mode: "overview", gap: 4 });

  assert.deepEqual(reserved, { x: 280, y: 0, width: 1160, height: 900 });
  assert.ok(placements.every((item) => item.bounds.x >= 280));
  assert.ok(placements.every((item) => item.bounds.width > 0));
  assert.deepEqual(reserveWorkspaceArea(area, 0), area);
});
