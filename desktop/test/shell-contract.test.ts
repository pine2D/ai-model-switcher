import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shell segmented controls expose state and site changes use a live region", () => {
  const app = readFileSync("src/renderer/index.tsx", "utf8");
  const commandBar = readFileSync("src/renderer/command-bar.tsx", "utf8");
  assert.match(commandBar, /aria-pressed=/);
  assert.match(app, /aria-live="polite"/);
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

test("display preferences cross only the trusted shell bridge", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(main, /polyask:set-display/);
  assert.match(main, /trustedShell\(event\)/);
  assert.match(preload, /setDisplayPreferences/);
  assert.match(preload, /onDisplayPreferences/);
});

test("composer expansion crosses a boolean-only trusted shell bridge", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(main, /polyask:set-composer-expanded/);
  assert.match(main, /typeof value !== "boolean"/);
  assert.match(manager, /setComposerExpanded/);
  assert.match(preload, /setComposerExpanded/);
});

test("windows and linux auto-hide the native menu bar", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /setAutoHideMenuBar\(true\)/);
  assert.match(main, /setMenuBarVisibility\(false\)/);
});
