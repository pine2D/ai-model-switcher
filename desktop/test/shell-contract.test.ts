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

test("site views grant an explicit permission allowlist and no more", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const allowlist = manager.slice(
    manager.indexOf("const SITE_PERMISSION_ALLOWLIST"),
    manager.indexOf("interface ViewManagerOptions")
  );
  for (const permission of ["clipboard-sanitized-write", "fullscreen", "pointerLock"]) {
    assert.match(allowlist, new RegExp(`"${permission}"`));
  }
  for (const denied of ["media", "geolocation", "midi", "notifications", "clipboard-read", "window-management"]) {
    assert.doesNotMatch(allowlist, new RegExp(`"${denied}"`));
  }
  assert.match(manager, /setPermissionCheckHandler\(\s*\(_contents, permission\) => SITE_PERMISSION_ALLOWLIST\.has\(permission\)/);
  assert.match(manager, /setPermissionRequestHandler\(\(_contents, permission, callback\) =>\s*callback\(SITE_PERMISSION_ALLOWLIST\.has\(permission\)\)\)/);
});

test("site popups never raise a login page from an embedded frame", () => {
  const siteView = readFileSync("src/main/site-view.ts", "utf8");
  const handler = siteView.slice(siteView.indexOf("contents.setWindowOpenHandler("));
  assert.match(handler, /const rewrite = disposition === "auth" && onSite/);
  assert.match(handler, /navigationDisposition\(site, contents\.getURL\(\)\) === "site"/);
  assert.match(handler, /authRecovery\.observe\(disposition, rewrite\)/);
  assert.doesNotMatch(handler, /authRecovery\.observe\(disposition, true\)/);
  assert.doesNotMatch(handler, /disposition === "site" \|\| disposition === "auth"/);
  assert.match(handler, /action: "deny"/);
});

test("site view security is read back from the live view and rate-limits dialogs", () => {
  const siteView = readFileSync("src/main/site-view.ts", "utf8");
  const diagnostics = readFileSync("src/main/diagnostics.ts", "utf8");
  assert.match(siteView, /getLastWebPreferences/);
  assert.match(siteView, /sandbox: prefs\.sandbox === true/);
  assert.match(siteView, /contextIsolation: prefs\.contextIsolation === true/);
  assert.match(siteView, /nodeIntegration: prefs\.nodeIntegration === true/);
  assert.match(siteView, /webSecurity: prefs\.webSecurity !== false/);
  assert.doesNotMatch(siteView, /sandbox: SITE_VIEW_SECURITY\.sandbox/);
  assert.match(diagnostics, /site\.webSecurity === false/);
  assert.match(diagnostics, /safeDialogs: true/);
  assert.doesNotMatch(diagnostics, /disableDialogs: true/);
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

test("answer generation monitoring is run-scoped and never changes navigation", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const preload = readFileSync("src/preload/site.ts", "utf8");
  assert.match(ipc, /manager\.beginGenerationRun\(request\.runId, request\.sites\)/);
  assert.match(ipc, /watchGeneration\(request\.runId, result\.site\)/);
  assert.match(ipc, /cancelGenerationRun\(\)/);
  assert.match(manager, /cmd: "generation"/);
  assert.match(preload, /parseGenerationState/);
  assert.doesNotMatch(manager, /generation[\s\S]{0,500}(loadURL|reload\(|focus\()/);
});

test("a retried run keeps watching the sites that are still generating", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const collectionRun = ipc.indexOf("collection.beginRun(request.runId");
  const generationRun = ipc.indexOf("manager.beginGenerationRun(request.runId");
  assert.ok(collectionRun >= 0 && collectionRun < generationRun);
  const begin = manager.slice(
    manager.indexOf("beginGenerationRun(runId: string"),
    manager.indexOf("watchGeneration(runId: string")
  );
  assert.match(begin, /const resumed = this\.generation\.begin\(runId, sites\)/);
  assert.match(begin, /if \(resumed\) for \(const site of sites\) this\.clearGenerationTracking\(site\)/);
  assert.doesNotMatch(begin, /cancelGenerationRun\(\)/);
});

test("navigation retires generation monitoring for that site only", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const navigate = manager.slice(
    manager.indexOf("async navigate(site: SiteKey"),
    manager.indexOf("markStatus(status: SiteStatus)")
  );
  assert.match(navigate, /this\.invalidateGeneration\(site\)/);
  assert.doesNotMatch(navigate, /cancelGenerationRun/);
  assert.match(manager, /invalidateGeneration\(site: SiteKey\): void \{\s*this\.generation\.forget\(site\)/);
});

test("one unreadable generation probe never ends the watch", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const probe = manager.slice(
    manager.indexOf("private async probeGeneration("),
    manager.indexOf("private replaceView(")
  );
  assert.match(probe, /if \(state === null\) \{\s*this\.scheduleGenerationProbe\(runId, site, false\);/);
  assert.match(probe, /if \(!reachable \|\| !view\) \{\s*this\.scheduleGenerationProbe\(runId, site, false\);/);
  assert.match(probe, /if \(phase === "complete"\) return;/);
  assert.match(probe, /misses >= GENERATION_MISS_LIMIT/);
  assert.doesNotMatch(probe, /state === null\) return;/);
});

test("completion is debounced across probes and never inferred from unchanged text", () => {
  const monitor = readFileSync("src/main/generation-monitor.ts", "utf8");
  assert.match(monitor, /COMPLETE_CONFIRMATIONS = 3/);
  assert.match(monitor, /entry\.completeStreak \+= 1/);
  assert.match(monitor, /entry\.completeStreak >= COMPLETE_CONFIRMATIONS/);
  assert.doesNotMatch(monitor, /\.length/);
});

test("commands refuse to reach a crashed or failed page instead of guessing", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const send = manager.slice(
    manager.indexOf("sendCommand(site: SiteKey"),
    manager.indexOf("collect(site: SiteKey")
  );
  const collect = manager.slice(
    manager.indexOf("collect(site: SiteKey"),
    manager.indexOf("private async checkSiteHealth(")
  );
  assert.match(send, /const pageFailure = this\.pageFailureCode\(site\)/);
  assert.match(collect, /const pageFailure = this\.pageFailureCode\(site\)/);
  assert.match(manager, /if \(phase === "crashed"\) return "renderer_crashed"/);
  assert.match(manager, /if \(phase === "failed"\) return "load_failed"/);
  assert.doesNotMatch(send, /reload\(/);
});

test("assisted synthesis dispatches through its own coordinator and cancel reaches both", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  assert.match(main, /const synthesisCoordinator = new BroadcastCoordinator\(\)/);
  assert.match(main, /return synthesisCoordinator\.send\(/);
  assert.match(main, /synthesisCoordinator,/);
  const cancel = ipc.slice(ipc.indexOf('ipcMain.on("polyask:cancel"'), ipc.indexOf('ipcMain.on("polyask:set-composer-expanded"'));
  assert.match(cancel, /coordinator\.cancel\(\)/);
  assert.match(cancel, /synthesisCoordinator\.cancel\(\)/);
  assert.match(cancel, /manager\.cancelGenerationRun\(\)/);
  assert.match(cancel, /synthesis\.cancel\(\)/);
});

test("workspace surfaces detach site views without destroying their web contents", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const start = manager.indexOf("setSurface(");
  const end = manager.indexOf("\n  focusRelative", start);
  const implementation = manager.slice(start, end);
  const detach = manager.slice(manager.indexOf("private detach("), manager.indexOf("\n  private dispose"));
  assert.match(implementation, /this\.detach/);
  assert.match(implementation, /this\.reconcileViews/);
  assert.match(detach, /removeChildView/);
  assert.doesNotMatch(implementation, /webContents\.close/);
  assert.match(readFileSync("src/shared/protocol.ts", "utf8"), /"commands"/);
  assert.match(readFileSync("src/main/shell-ipc.ts", "utf8"), /"commands"/);
});

test("site health and guarded reload cross the trusted typed bridge", () => {
  const healthIpc = readFileSync("src/main/site-health-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const sitePreload = readFileSync("src/preload/site.ts", "utf8");
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  assert.match(healthIpc, /polyask:site-health/);
  assert.match(healthIpc, /polyask:reload-site/);
  assert.match(healthIpc, /options\.trusted\(event\)/);
  assert.match(preload, /checkSiteHealth/);
  assert.match(preload, /reloadSite\(site: SiteKey\): Promise<boolean>/);
  assert.match(sitePreload, /cmd === "diagnose"/);
  assert.match(manager, /siteReloadAllowed/);
  assert.match(manager, /this\.pageStatus\.get\(site\)/);
  assert.match(manager, /this\.runStatus\.get\(site\)/);
});

test("every main-process IPC handler guards its own sender", () => {
  for (const file of ["src/main/site-health-ipc.ts", "src/main/sync-ipc.ts"]) {
    const source = readFileSync(file, "utf8");
    const handlers = source.match(/ipcMain\.handle\(/g) ?? [];
    const guards = source.match(/options\.trusted\(event\)/g) ?? [];
    assert.ok(handlers.length > 0, file);
    assert.equal(guards.length, handlers.length, file);
  }
  const shell = readFileSync("src/main/shell-ipc.ts", "utf8");
  const shellHandlers = shell.match(/ipcMain\.handle\(/g) ?? [];
  const shellGuards = shell.match(/trustedShell\(event\)/g) ?? [];
  assert.ok(shellHandlers.length > 0);
  assert.ok(shellGuards.length >= shellHandlers.length);
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
  assert.match(ipc, /history\.record\(request\.text\)/);
  assert.doesNotMatch(ipc, /historyRecorded/);
  const record = ipc.indexOf("history.record(request.text)");
  const dispatch = ipc.indexOf("await coordinator.send(");
  const imageGuard = ipc.indexOf("image_sites_unsupported");
  assert.ok(imageGuard >= 0 && imageGuard < record && record < dispatch);
  assert.match(preload, /searchArchives/);
  assert.match(preload, /updateArchive/);
  assert.match(preload, /archiveMarkdown/);
});

test("prompt templates and recent history use a trusted synchronized library bridge", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(ipc, /polyask:prompt-template-save/);
  assert.match(ipc, /polyask:prompt-template-delete/);
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(preload, /savePromptTemplate/);
  assert.match(preload, /deletePromptTemplate/);
  assert.match(preload, /onPromptLibrary/);
  assert.match(main, /PromptLibraryService/);
});

test("completion notifications are boolean-only and update checks open the official release page", () => {
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(ipc, /polyask:set-completion-notifications/);
  assert.match(ipc, /typeof value !== "boolean"/);
  assert.match(preload, /setCompletionNotifications/);
  assert.match(main, /CompletionNotifier/);
  assert.match(renderer, /github\.com\/pine2D\/polyask\/releases\/latest/);
  assert.match(renderer, /nextSiteForStatus/);
  assert.doesNotMatch(main, /autoUpdater/);
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

test("Drive diagnostics use the existing trusted sync bridge", () => {
  const ipc = readFileSync("src/main/sync-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(ipc, /polyask:sync-diagnostics/);
  assert.match(ipc, /options\.trusted\(event\)/);
  assert.match(preload, /syncDiagnostics\(\): Promise<SyncDiagnosticSnapshot>/);
  assert.match(preload, /polyask:sync-diagnostics/);
});

test("Drive diagnostics command opens and targets the settings diagnostic section", () => {
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(renderer, /"open-drive-diagnostics": \(\) =>/);
  assert.match(renderer, /setSettingsSection\("drive-diagnostics"\)/);
  assert.match(renderer, /initialSection=\{settingsSection\}/);
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
