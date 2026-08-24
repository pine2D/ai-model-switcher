import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shell segmented controls expose state and site changes use a live region", () => {
  const source = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(source, /aria-pressed=/);
  assert.match(source, /aria-live="polite"/);
});

test("production cancel recreates only the pending site view", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const sitePreload = readFileSync("src/preload/site.ts", "utf8");
  assert.match(manager, /removeChildView\(/);
  assert.match(manager, /webContents\.close\(\)/);
  assert.doesNotMatch(manager, /forcefullyCrashRenderer\(\)/);
  assert.doesNotMatch(sitePreload, /location\.reload\(\)/);
});

test("focus action transfers keyboard focus to the native site view", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  assert.match(manager, /webContents\.focus\(\)/);
});

test("cancel keeps the current run locked until its promise settles", () => {
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(renderer, /setRunState\("cancelling"\)/);
  assert.doesNotMatch(renderer, /window\.polyask\.cancel\(\);\s*setSending\(false\)/);
});

test("application menu offers a keyboard route back to the prompt", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(main, /polyask:focus-prompt/);
  assert.match(main, /CmdOrCtrl\+Shift\+P/);
  assert.match(renderer, /onFocusPrompt/);
});

test("CI runs desktop tests and TypeScript checks", () => {
  const workflow = readFileSync("../.github/workflows/ci.yml", "utf8");
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run typecheck/);
});

test("shell navigation and IPC trust both lock to the local top frame", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /senderFrame/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /removeSwitch\("remote-debugging-port"\)/);
});
