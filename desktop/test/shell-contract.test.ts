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

test("application menu offers a keyboard route back to the prompt", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const commands = readFileSync("src/shared/commands.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(main, /commandAccelerator/);
  assert.match(main, /polyask:command/);
  assert.match(main, /before-input-event/);
  assert.match(preload, /onCommand/);
  assert.match(renderer, /onCommand/);
  assert.match(commands, /Alt\+Q/);
  assert.match(main, /CmdOrCtrl\+Shift\+PageDown/);
  assert.match(main, /CmdOrCtrl\+Shift\+PageUp/);
  assert.match(main, /pageRelative/);
  assert.match(commands, /Alt\+1/);
  assert.match(commands, /Alt\+2/);
  assert.match(commands, /Alt\+3/);
  assert.match(main, /pageDirect\(page\)/);
});

test("CI tests and packages desktop on Linux, Windows and macOS", () => {
  const workflow = readFileSync("../.github/workflows/ci.yml", "utf8");
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /npm run package/);
  assert.match(workflow, /archive-portable\.ps1/);
  assert.match(workflow, /chown root:root "out\/PolyAsk-linux-x64\/chrome-sandbox"/);
  assert.match(workflow, /chmod 4755 "out\/PolyAsk-linux-x64\/chrome-sandbox"/);
  assert.doesNotMatch(workflow, /--no-sandbox/);
});

test("shell navigation and IPC trust both lock to the local top frame", () => {
  const main = readFileSync("src/main/index.ts", "utf8") + readFileSync("src/main/shell-ipc.ts", "utf8");
  assert.match(main, /senderFrame/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /removeSwitch\("remote-debugging-port"\)/);
});

test("shell bootstrap exposes only sanitized runtime metadata", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  assert.match(main, /const runtimeInfo: RuntimeInfo/);
  assert.match(main, /runtime: runtimeInfo/);
  assert.match(ipc, /runtime: options\.runtime/);
});

test("a copied profile receives a distinct sync device identity before services start", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const databaseOpen = main.indexOf("DesktopDatabase.open");
  const resetIdentity = main.indexOf("applyPortableImportIdentity", databaseOpen);
  const createWindow = main.indexOf("await createWindow()", databaseOpen);
  assert.ok(databaseOpen >= 0 && databaseOpen < resetIdentity && resetIdentity < createWindow);
  assert.match(main, /desktopDatabase!\.adoptImportedProfile\(deviceId\)/);
});

test("portable setup failures localize without calling app.getLocale before ready", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /getPreferredSystemLanguages\(\)\[0\]/);
  const setup = main.slice(main.indexOf("let profileReady"), main.indexOf("const coordinator"));
  assert.ok(setup.indexOf("isPortableDataInitialized(runtimeProfile)")
    < setup.indexOf("hasImportableLegacyData(runtimeProfile)"));
  const legacyBranch = setup.slice(setup.indexOf("else if (legacyDataAvailable)"), setup.indexOf("} catch"));
  const legacyLock = legacyBranch.indexOf("legacyProfileLock = app.requestSingleInstanceLock()");
  const finalize = legacyBranch.indexOf("finalizePortableDataImport(runtimeProfile)");
  const portablePath = legacyBranch.indexOf('app.setPath("userData"');
  assert.ok(legacyLock >= 0 && legacyLock < finalize && finalize < portablePath);
  assert.doesNotMatch(setup, /app\.getLocale\(\)/);
  assert.match(setup, /legacyDataAvailable = hasImportableLegacyData\(runtimeProfile\)/);
  assert.match(main, /app\.releaseSingleInstanceLock\(\)/);
  assert.match(main, /instanceLockHeld = app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /\["EACCES", "EPERM", "EROFS", "EIO"\]/);
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

test("selected-site paging crosses a validated shell bridge", () => {
  const main = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(main, /polyask:set-page/);
  assert.match(main, /parsePageIndex/);
  assert.match(main, /manager\.setSelection/);
  assert.match(preload, /setPage/);
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
  const detach = manager.slice(manager.indexOf("private detach("), manager.indexOf("\n  private dispose"));
  assert.match(implementation, /this\.detach/);
  assert.match(implementation, /this\.reconcileViews/);
  assert.match(detach, /removeChildView/);
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
  assert.match(protocol, /readonly runtime: RuntimeInfo/);
});

test("windows and linux auto-hide the native menu bar", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /setAutoHideMenuBar\(true\)/);
  assert.match(main, /setMenuBarVisibility\(false\)/);
});

test("desktop UI state restores before window creation and remains local to the profile", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const store = readFileSync("src/main/ui-state-store.ts", "utf8");
  const load = main.indexOf("uiStateStore.load()");
  const create = main.indexOf("new BrowserWindow");

  assert.ok(load >= 0 && load < create);
  assert.match(main, /screen\.getAllDisplays/);
  assert.match(main, /XDG_SESSION_TYPE/);
  assert.match(main, /desktop-ui-state\.json/);
  assert.match(manager, /getUiState\(\)/);
  assert.match(manager, /initialUiState/);
  assert.match(store, /setTimeout/);
  assert.match(store, /250/);
  assert.doesNotMatch(store, /StateRepository|outbox|sync/);
});

test("workspace menus and new-session confirmation stay in trusted native UI", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const native = readFileSync("src/main/native-menus.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  for (const channel of [
    "polyask:show-group-menu",
    "polyask:show-command-menu",
    "polyask:confirm-new-session"
  ]) assert.match(ipc, new RegExp(channel));
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(native, /Menu\.buildFromTemplate/);
  assert.match(native, /dialog\.showMessageBox/);
  assert.match(preload, /showGroupMenu/);
  assert.match(preload, /showCommandMenu/);
  assert.match(preload, /confirmNewSession/);
});
