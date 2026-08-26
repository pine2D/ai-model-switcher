import assert from "node:assert/strict";
import test from "node:test";

import {
  computeViewLayout,
  paginateSiteKeys,
  resolveSitePage,
  resolveLayoutMode,
  scaleBounds,
  swapFocusedSite
} from "../src/main/layout";
import { resolveFocusedSite } from "../src/shared/site-pages";
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

test("selected sites form stable pages of at most six in product order", () => {
  assert.deepEqual(paginateSiteKeys([]), [[]]);
  assert.deepEqual(paginateSiteKeys(keys.slice(0, 6)), [keys.slice(0, 6)]);
  assert.deepEqual(paginateSiteKeys(keys.slice(0, 7)), [keys.slice(0, 6), keys.slice(6, 7)]);
  assert.deepEqual(paginateSiteKeys(keys), [keys.slice(0, 6), keys.slice(6, 9)]);
});

test("requested pages clamp without changing selected-site order", () => {
  assert.deepEqual(resolveSitePage(keys, 0), {
    page: 0,
    pageCount: 2,
    keys: keys.slice(0, 6)
  });
  assert.deepEqual(resolveSitePage(keys, 9), {
    page: 1,
    pageCount: 2,
    keys: keys.slice(6, 9)
  });
  assert.deepEqual(resolveSitePage([], 4), { page: 0, pageCount: 1, keys: [] });
});

test("focus memory never restores a site outside the active page", () => {
  assert.equal(resolveFocusedSite(["gemini", "doubao"], "gemini", "doubao"), "gemini");
  assert.equal(resolveFocusedSite(["gemini", "doubao"], "claude", "doubao"), "doubao");
  assert.equal(resolveFocusedSite(["gemini", "doubao"], "claude", "chatgpt"), "gemini");
  assert.equal(resolveFocusedSite([], "claude", "chatgpt"), "claude");
});

test("overview uses readable dynamic geometry for one through six selected sites", () => {
  const expected = [
    [{ x: 0, y: 0, width: 1200, height: 600 }],
    [{ x: 0, y: 0, width: 598, height: 600 }, { x: 602, y: 0, width: 598, height: 600 }],
    [{ x: 0, y: 0, width: 398, height: 600 }, { x: 402, y: 0, width: 397, height: 600 }, { x: 803, y: 0, width: 397, height: 600 }],
    [{ x: 0, y: 0, width: 598, height: 298 }, { x: 602, y: 0, width: 598, height: 298 }, { x: 0, y: 302, width: 598, height: 298 }, { x: 602, y: 302, width: 598, height: 298 }],
    [{ x: 0, y: 0, width: 598, height: 298 }, { x: 602, y: 0, width: 598, height: 298 }, { x: 0, y: 302, width: 398, height: 298 }, { x: 402, y: 302, width: 397, height: 298 }, { x: 803, y: 302, width: 397, height: 298 }],
    [{ x: 0, y: 0, width: 398, height: 298 }, { x: 402, y: 0, width: 397, height: 298 }, { x: 803, y: 0, width: 397, height: 298 }, { x: 0, y: 302, width: 398, height: 298 }, { x: 402, y: 302, width: 397, height: 298 }, { x: 803, y: 302, width: 397, height: 298 }]
  ];

  for (let count = 1; count <= 6; count += 1) {
    const layout = computeViewLayout(keys.slice(0, count), { x: 0, y: 0, width: 1200, height: 600 }, { mode: "overview", gap: 4 });
    assert.deepEqual(layout.map((item) => item.bounds), expected[count - 1], `${count} sites`);
  }
});

test("overview keeps every active-page view visible and non-overlapping", () => {
  const layout = computeViewLayout(keys.slice(0, 6), area, { mode: "overview", gap: 8 });

  assert.equal(layout.length, 6);
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

test("focus fills the page with one primary and up to five readable secondary views", () => {
  const layout = computeViewLayout(keys.slice(0, 6), { x: 0, y: 0, width: 1200, height: 600 }, {
    mode: "focus",
    focused: "claude",
    gap: 4
  });

  assert.deepEqual(layout.find((item) => item.key === "claude")?.bounds, {
    x: 0,
    y: 0,
    width: 799,
    height: 399
  });
  assert.deepEqual(layout.filter((item) => item.key !== "claude").map((item) => item.bounds), [
    { x: 803, y: 0, width: 397, height: 198 },
    { x: 803, y: 202, width: 397, height: 197 },
    { x: 0, y: 403, width: 398, height: 197 },
    { x: 402, y: 403, width: 397, height: 197 },
    { x: 803, y: 403, width: 397, height: 197 }
  ]);
});

test("focus gives one selected site the full available page", () => {
  assert.deepEqual(
    computeViewLayout(["claude"], { x: 0, y: 0, width: 1200, height: 600 }, { mode: "focus", focused: "claude", gap: 4 }),
    [{ key: "claude", bounds: { x: 0, y: 0, width: 1200, height: 600 } }]
  );
});

test("overview requires every tile to meet width and height floors", () => {
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1147, height: 900 }, 4, 6),
    "focus"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1148, height: 900 }, 4, 6),
    "overview"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 423 }, 4, 6),
    "focus"
  );
  assert.equal(
    resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 424 }, 4, 6),
    "overview"
  );
  assert.equal(resolveLayoutMode("overview", { x: 0, y: 0, width: 764, height: 424 }, 4, 4), "overview");
  assert.equal(resolveLayoutMode("focus", area, 4, 6), "focus");
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
  const placements = computeViewLayout(keys.slice(0, 6), reserved, { mode: "overview", gap: 4 });

  assert.deepEqual(reserved, { x: 280, y: 0, width: 1160, height: 900 });
  assert.ok(placements.every((item) => item.bounds.x >= 280));
  assert.ok(placements.every((item) => item.bounds.width > 0));
  assert.deepEqual(reserveWorkspaceArea(area, 0), area);
});
