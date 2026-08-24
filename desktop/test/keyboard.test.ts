import assert from "node:assert/strict";
import test from "node:test";

import { commandKeyAction } from "../src/renderer/keyboard";

test("prompt shortcuts submit or collapse outside IME composition", () => {
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: false }), "submit");
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: false, metaKey: true, isComposing: false }), "submit");
  assert.equal(commandKeyAction({ key: "Escape", ctrlKey: false, metaKey: false, isComposing: false }), "collapse");
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: false, metaKey: false, isComposing: false }), null);
});

test("IME composition never submits or collapses the prompt", () => {
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: true }), null);
  assert.equal(commandKeyAction({ key: "Escape", ctrlKey: false, metaKey: false, isComposing: true }), null);
});
