import assert from "node:assert/strict";
import test from "node:test";

import { parseDesktopUiState } from "../src/shared/desktop-ui-state";

const display = [{ x: 0, y: 0, width: 1920, height: 1080 }];
const selected = ["claude", "chatgpt", "gemini"] as const;

test("restored UI state centers off-screen bounds and resets a stale page", () => {
  const state = parseDesktopUiState({
    windowBounds: { x: 9000, y: 9000, width: 1400, height: 900 },
    maximized: false,
    layoutMode: "focus",
    currentPage: 9,
    focusedByPage: { 9: "gemini" }
  }, display, selected);

  assert.deepEqual(state.windowBounds, { x: 260, y: 90, width: 1400, height: 900 });
  assert.equal(state.currentPage, 0);
  assert.equal(state.focusedByPage[0], "claude");
  assert.equal(state.layoutMode, "focus");
});

test("restored bounds and focus are clamped to current displays and selection", () => {
  const state = parseDesktopUiState({
    windowBounds: { x: -100, y: -50, width: 500, height: 400 },
    maximized: "yes",
    layoutMode: "unknown",
    currentPage: 0,
    focusedByPage: { 0: "deepseek" }
  }, display, selected);

  assert.deepEqual(state.windowBounds, { x: 0, y: 0, width: 960, height: 680 });
  assert.equal(state.maximized, false);
  assert.equal(state.layoutMode, "overview");
  assert.deepEqual(state.focusedByPage, { 0: "claude" });
});

test("restored focus memory follows balanced page membership", () => {
  const state = parseDesktopUiState({
    currentPage: 1,
    focusedByPage: { 0: "gemini", 1: "deepseek", 2: "chatglm" }
  }, display, ["claude", "chatgpt", "gemini", "doubao", "deepseek"]);

  assert.equal(state.currentPage, 1);
  assert.deepEqual(state.focusedByPage, { 0: "gemini", 1: "deepseek" });
});

test("restored bounds retain a larger window on the matching secondary display", () => {
  const state = parseDesktopUiState({
    windowBounds: { x: 2000, y: 100, width: 2200, height: 1200 }
  }, [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 }
  ], selected);

  assert.deepEqual(state.windowBounds, { x: 2000, y: 100, width: 2200, height: 1200 });
});
