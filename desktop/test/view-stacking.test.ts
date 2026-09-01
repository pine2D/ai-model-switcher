import assert from "node:assert/strict";
import test from "node:test";

import { SITE_KEYS } from "../src/shared/contracts";
import { reconcileVisibleSiteKeys, stackOrder } from "../src/main/view-visibility";

const all = [...SITE_KEYS];

test("stack order keeps every selected site attached with the active page on top", () => {
  const order = stackOrder(all, all.slice(0, 3));

  // 后台页在前（底层），当前页在后（顶层）：addChildView 后加的盖在上面。
  assert.deepEqual(order, [...all.slice(3), ...all.slice(0, 3)]);
  assert.equal(order.length, all.length);
});

test("stack order never attaches an unselected site", () => {
  const selected = all.slice(0, 5);
  const order = stackOrder(selected, selected.slice(3));

  assert.deepEqual(order, [...selected.slice(0, 3), ...selected.slice(3)]);
  assert.ok(order.every((site) => selected.includes(site)));
});

test("stack order preserves product order inside each layer", () => {
  const order = stackOrder(all, [all[8], all[0]]);

  assert.deepEqual(order, [...all.slice(1, 8), all[0], all[8]]);
});

test("stack order tolerates a visible key that is no longer selected", () => {
  const selected = all.slice(0, 4);
  const order = stackOrder(selected, [all[7]]);

  assert.deepEqual(order, selected);
});

// 生产里 reconcileViews 拿 this.selected 做集合对账（挂谁），拿 stackOrder 做层序（谁在上面）。
// 层序不靠 detach 实现：addChildView 对已在树里的子视图是原地提升到顶层（Electron 43.4.0 实测：
// 幂等、children 不增长、且不丢渲染进程焦点；全拆重挂则实测 blur 2 次、hasFocus 转 false）。
test("reconciling against the selection attaches background pages too", () => {
  const changes = reconcileVisibleSiteKeys(all.slice(0, 3), all);

  assert.deepEqual(changes.detach, []);
  assert.deepEqual(changes.attach, all.slice(3));
});

test("deselecting a site detaches it without disturbing the rest", () => {
  const kept = all.filter((site) => site !== all[4]);
  const changes = reconcileVisibleSiteKeys(all, kept);

  assert.deepEqual(changes.detach, [all[4]]);
  assert.deepEqual(changes.attach, []);
});
