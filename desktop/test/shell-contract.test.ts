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
  const main = readFileSync("src/main/index.ts", "utf8") + readFileSync("src/main/shell-ipc.ts", "utf8");
  assert.match(main, /senderFrame/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /removeSwitch\("remote-debugging-port"\)/);
});

test("display preferences cross only the trusted shell bridge", () => {
  const main = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(main, /polyask:set-display/);
  assert.match(main, /trustedShell\(event\)/);
  assert.match(preload, /setDisplayPreferences/);
  assert.match(preload, /onDisplayPreferences/);
});

test("composer expansion crosses a boolean-only trusted shell bridge", () => {
  const main = readFileSync("src/main/shell-ipc.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(main, /polyask:set-composer-expanded/);
  assert.match(main, /typeof value !== "boolean"/);
  assert.match(manager, /setComposerExpanded/);
  assert.match(preload, /setComposerExpanded/);
});

test("workspace mutations cross the trusted shell bridge and the drawer reserves native bounds", () => {
  const main = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const workspaceLayout = readFileSync("src/main/workspace-layout.ts", "utf8");
  for (const channel of [
    "polyask:set-selection",
    "polyask:set-tier",
    "polyask:save-group",
    "polyask:delete-group",
    "polyask:new-session"
  ]) {
    assert.match(main, new RegExp(channel));
  }
  assert.match(main, /trustedShell\(event\)/);
  assert.match(preload, /onWorkspaceState/);
  assert.match(preload, /setDrawerOpen/);
  assert.match(manager, /computeWorkspaceLayout/);
  assert.match(workspaceLayout, /reserveWorkspaceArea/);
});

test("image IPC rejects unsupported sites before native view dispatch", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  assert.match(ipc, /unsupportedImageSites/);
  assert.match(ipc, /image_sites_unsupported/);
});

test("answer collection uses the trusted shell and the existing read-only adapter hook", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const sitePreload = readFileSync("src/preload/site.ts", "utf8");
  assert.match(ipc, /polyask:collect/);
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(preload, /collectAnswers/);
  assert.match(sitePreload, /collectAnswer/);
});

test("archive surface detaches site views without destroying their web contents", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const start = manager.indexOf("setSurface(");
  const end = manager.indexOf("\n  focusRelative", start);
  const implementation = manager.slice(start, end);
  assert.match(implementation, /removeChildView/);
  assert.match(implementation, /addChildView/);
  assert.doesNotMatch(implementation, /webContents\.close/);
});

test("archive mutations and history persistence stay behind trusted main-process IPC", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  for (const channel of [
    "polyask:archive-search",
    "polyask:archive-add",
    "polyask:archive-update",
    "polyask:archive-delete",
    "polyask:archive-markdown"
  ]) assert.match(ipc, new RegExp(channel));
  assert.match(ipc, /result\.ok && !historyRecorded/);
  assert.match(ipc, /history\.record\(request\.text\)/);
  assert.match(preload, /searchArchives/);
  assert.match(preload, /updateArchive/);
  assert.match(preload, /archiveMarkdown/);
});

test("assisted synthesis state and mutations stay behind the trusted shell bridge", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  for (const channel of ["polyask:synthesis-send", "polyask:synthesis-collect", "polyask:synthesis-save"]) {
    assert.match(ipc, new RegExp(channel));
  }
  assert.match(ipc, /pendingSynthesis: synthesis\.getPending\(\)/);
  assert.match(preload, /sendSynthesis/);
  assert.match(preload, /collectSynthesis/);
  assert.match(preload, /saveSynthesis/);
});

test("Drive sync uses a trusted typed bridge and protects destructive cloud clearing", () => {
  const ipc = readFileSync("src/main/sync-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const protocol = readFileSync("src/shared/protocol.ts", "utf8");
  for (const channel of ["polyask:sync-connect", "polyask:sync-now", "polyask:sync-disconnect", "polyask:sync-clear"]) {
    assert.match(ipc, new RegExp(channel));
  }
  assert.match(ipc, /options\.trusted\(event\)/);
  assert.match(ipc, /CLEAR_REMOTE_CONFIRMATION/);
  assert.match(preload, /onSyncStatus/);
  assert.match(protocol, /readonly sync: SyncStatus/);
});

test("windows and linux auto-hide the native menu bar", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /setAutoHideMenuBar\(true\)/);
  assert.match(main, /setMenuBarVisibility\(false\)/);
});
