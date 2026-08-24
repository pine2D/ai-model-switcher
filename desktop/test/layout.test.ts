import assert from "node:assert/strict";
import test from "node:test";

import { computeViewLayout, resolveLayoutMode, scaleBounds } from "../src/main/layout";
import { SITES } from "../src/main/sites";

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

test("focus gives the selected site the largest surface and keeps eight live", () => {
  const layout = computeViewLayout(keys, area, {
    mode: "focus",
    focused: "claude",
    gap: 8
  });
  const primary = layout.find((item) => item.key === "claude");
  const secondary = layout.filter((item) => item.key !== "claude");

  assert.equal(layout.length, 9);
  assert.ok(primary);
  assert.equal(secondary.length, 8);
  assert.ok(
    secondary.every(
      (item) =>
        primary.bounds.width * primary.bounds.height >
        item.bounds.width * item.bounds.height
    )
  );
});

test("narrow windows automatically use focus layout", () => {
  assert.equal(resolveLayoutMode("overview", 1199), "focus");
  assert.equal(resolveLayoutMode("overview", 1200), "overview");
  assert.equal(resolveLayoutMode("focus", 1600), "focus");
});

test("shell zoom converts CSS layout coordinates back to native DIP bounds", () => {
  assert.deepEqual(
    scaleBounds({ x: 10, y: 20, width: 101, height: 51 }, 1.25),
    { x: 13, y: 25, width: 126, height: 64 }
  );
});
