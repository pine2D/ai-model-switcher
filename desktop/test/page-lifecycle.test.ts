import assert from "node:assert/strict";
import test from "node:test";

import { PageLifecycle } from "../src/main/page-lifecycle";

test("a finished main-frame load reports ready", () => {
  const page = new PageLifecycle();

  assert.equal(page.startNavigation(true, false), "loading");
  assert.equal(page.finishLoad(), "ready");
  assert.equal(page.current(), "ready");
});

test("a subframe inserted after load never drags the page back to loading", () => {
  const page = new PageLifecycle();
  page.startNavigation(true, false);
  page.finishLoad();

  // Claude 的 hCaptcha / isolated-segment 与 ChatGPT 的 about:blank 都走这条路；
  // 旧实现用 did-start-loading，会把 phase 永久钉死在 loading。
  assert.equal(page.startNavigation(false, false), null);
  assert.equal(page.current(), "ready");
});

test("same-document navigation does not restart the page", () => {
  const page = new PageLifecycle();
  page.startNavigation(true, false);
  page.finishLoad();

  assert.equal(page.startNavigation(true, true), null);
  assert.equal(page.current(), "ready");
});

test("a main-frame failure survives the did-finish-load that follows it", () => {
  const page = new PageLifecycle();
  page.startNavigation(true, false);

  assert.equal(page.failLoad(-102, true), "failed");
  // 实测事件序：did-fail-load → did-finish-load，间隔 1~2ms。
  assert.equal(page.finishLoad(), null);
  assert.equal(page.current(), "failed");
});

test("the next main-frame navigation clears a previous failure", () => {
  const page = new PageLifecycle();
  page.failLoad(-102, true);

  assert.equal(page.startNavigation(true, false), "loading");
  assert.equal(page.finishLoad(), "ready");
});

test("aborted and subframe failures leave the phase untouched", () => {
  const page = new PageLifecycle();
  page.startNavigation(true, false);
  page.finishLoad();

  assert.equal(page.failLoad(PageLifecycle.ABORTED, true), null);
  assert.equal(page.failLoad(-102, false), null);
  assert.equal(page.current(), "ready");
});
