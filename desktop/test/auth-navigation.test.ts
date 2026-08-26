import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PostAuthReloadTracker } from "../src/main/auth-navigation";

test("Gemini reloads once after returning from an authentication host", () => {
  const tracker = new PostAuthReloadTracker(true);

  assert.equal(tracker.shouldReload("site"), false);
  tracker.observe("auth", true);
  assert.equal(tracker.shouldReload("auth"), false);
  assert.equal(tracker.shouldReload("site"), true);
  assert.equal(tracker.shouldReload("site"), false);
});

test("a later authentication cycle can arm one new reload", () => {
  const tracker = new PostAuthReloadTracker(true);

  tracker.observe("auth", true);
  assert.equal(tracker.shouldReload("site"), true);
  tracker.observe("auth", true);
  assert.equal(tracker.shouldReload("site"), true);
});

test("sites without the recovery remain untouched", () => {
  const tracker = new PostAuthReloadTracker(false);

  tracker.observe("auth", true);
  assert.equal(tracker.shouldReload("site"), false);
});

test("Gemini ignores authentication redirects from an embedded frame", () => {
  const tracker = new PostAuthReloadTracker(true);

  tracker.observe("auth", false);

  assert.equal(tracker.shouldReload("site"), false);
});

test("site views use Electron navigation details to identify the main frame", () => {
  const source = readFileSync("src/main/site-view.ts", "utf8");
  assert.match(source, /authRecovery\.observe\(disposition, event\.isMainFrame\)/);
});
