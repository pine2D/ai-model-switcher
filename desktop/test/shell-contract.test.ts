import assert from "node:assert/strict";

import { SiteNavigationPolicy } from "../src/main/navigation-guard";
import { SITES } from "../src/main/sites";

const chatgptSite = SITES.find((s) => s.key === "chatgpt")!;
import test from "node:test";
import { readSource } from "./fixtures";

test("shell segmented controls expose state and site changes use a live region", () => {
  const app = readSource("src/renderer/index.tsx");
  const commandBar = readSource("src/renderer/command-bar.tsx");
  assert.match(commandBar, /aria-pressed=/);
  assert.match(app, /aria-live="polite"/);
});

test("production cancel recreates only the pending site view", () => {
  const manager = readSource("src/main/view-manager.ts");
  const sitePreload = readSource("src/preload/site.ts");
  assert.match(manager, /removeChildView\(/);
  assert.match(manager, /webContents\.close\(\)/);
  assert.doesNotMatch(manager, /forcefullyCrashRenderer\(\)/);
  assert.doesNotMatch(sitePreload, /location\.reload\(\)/);
});

test("focus action transfers keyboard focus to the native site view", () => {
  const manager = readSource("src/main/view-manager.ts");
  assert.match(manager, /webContents\.focus\(\)/);
});

test("application menu offers a keyboard route back to the prompt", () => {
  const main = readSource("src/main/index.ts");
  const commands = readSource("src/shared/commands.ts");
  const preload = readSource("src/preload/shell.ts");
  const renderer = readSource("src/renderer/index.tsx");
  assert.match(main, /commandAccelerator/);
  assert.match(main, /polyask:command/);
  assert.match(main, /before-input-event/);
  assert.match(preload, /onCommand/);
  assert.match(renderer, /onCommand/);
  assert.match(commands, /Alt\+Q/);
  // 翻页/换焦点的加速器登记在 COMMANDS 表里（菜单与快捷键速查同源），不再在菜单模板里手写
  assert.match(commands, /CmdOrCtrl\+Shift\+PageDown/);
  assert.match(commands, /CmdOrCtrl\+Shift\+PageUp/);
  assert.match(commands, /CmdOrCtrl\+PageDown/);
  assert.match(commands, /CmdOrCtrl\+PageUp/);
  assert.match(main, /pageRelative/);
  assert.match(main, /focusRelative/);
  assert.match(commands, /Alt\+1/);
  assert.match(commands, /Alt\+2/);
  assert.match(commands, /Alt\+3/);
  assert.match(main, /pageDirect\(page\)/);
});

// 快捷键速查只渲染 COMMANDS 表，而菜单曾另外手写过四条加速器 —— 速查因此漏掉它们，
// 却仍写着「集中查看当前可用的应用快捷键」。这条钉死「菜单不得再手写加速器」。
// 层序靠「重挂即提升」，不靠全拆重挂——后者实测会让被聚焦站点的渲染进程丢焦点（blur）。
// 这条钉死 attach() 不得退回 detach-then-attach。
test("view attach relies on reordering, never on a full detach-and-reattach", () => {
  const manager = readSource("src/main/view-manager.ts");
  const attach = manager.slice(manager.indexOf("private attach("), manager.indexOf("private detach("));
  const reconcile = manager.slice(manager.indexOf("private reconcileViews("), manager.indexOf("private attach("));

  assert.match(attach, /addChildView/);
  assert.ok(!/removeChildView|this\.detach\(/.test(attach), "attach() 里不得出现 detach");
  assert.ok(!/\[\.\.\.this\.attached\]\) this\.detach/.test(reconcile),
    "reconcileViews() 不得整栈拆挂——会丢焦点，且 addChildView 本就能原地提升层序");
});

// 上一轮只钉了「模板里不得手写 accelerator」，漏掉了菜单里 role 项自带的那批（Ctrl+R / F11 /
// Ctrl+C / Ctrl+Q…）——它们不写在模板里，测试扫不到，于是速查仍然缺一大截却全绿。
// 这条钉死速查必须从**真实菜单**读，而不是再维护第二张表。
test("the shortcut reference reads the real application menu", () => {
  const main = readSource("src/main/menu-shortcuts.ts");
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const palette = readSource("src/renderer/command-palette.tsx");
  const renderer = readSource("src/renderer/index.tsx");

  assert.match(main, /Menu\.getApplicationMenu\(\)/);
  assert.match(ipc, /polyask:menu-shortcuts/);
  assert.match(preload, /polyask:menu-shortcuts/);
  assert.match(renderer, /menuShortcuts\(\)/);
  assert.match(palette, /menuShortcutItems/);
});

test("every menu accelerator comes from the shared command table", () => {
  const main = readSource("src/main/index.ts");
  const template = main.slice(main.indexOf("function createMenu"), main.indexOf("Menu.setApplicationMenu"));
  const handWritten = [...template.matchAll(/accelerator:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(handWritten, [],
    `菜单模板里不得手写 accelerator（发现 ${handWritten.join(", ")}）——` +
    "登记到 src/shared/commands.ts 的 COMMANDS，菜单与快捷键速查才会同源");
});

test("every navigation command a menu exposes is reachable from the renderer", () => {
  const renderer = readSource("src/renderer/index.tsx");
  const main = readSource("src/main/index.ts");

  // 命令面板与快捷键速查都按「渲染层是否给了动作」过滤（index.tsx 的 availableCommands），
  // 所以纯主进程处理的命令必须同时有渲染层入口，否则用户在速查里根本看不到它。
  for (const id of ["next-page", "previous-page", "next-site", "previous-site"]) {
    assert.ok(renderer.includes(`"${id}"`), `${id} 缺少渲染层动作，快捷键速查会漏掉它`);
    assert.ok(main.includes(`"${id}"`), `${id} 缺少主进程分发`);
  }
});

test("CI tests and packages desktop on Linux, Windows and macOS", () => {
  const workflow = readSource("../.github/workflows/ci.yml");
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
  const main = readSource("src/main/index.ts") + readSource("src/main/shell-ipc.ts");
  assert.match(main, /senderFrame/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /removeSwitch\("remote-debugging-port"\)/);
});

test("site views grant an explicit permission allowlist and no more", () => {
  const manager = readSource("src/main/view-manager.ts");
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

test("site view wires split navigation guards, a commit signal and deny-only popups", () => {
  const siteView = readSource("src/main/site-view.ts");
  assert.match(siteView, /contents\.on\("will-navigate", guardNavigation\(false\)\)/);
  assert.match(siteView, /contents\.on\("will-redirect", guardNavigation\(true\)\)/);
  assert.match(siteView, /contents\.on\("did-navigate", \(_event, url\) => policy\.commit\(url\)\)/);
  const handler = siteView.slice(siteView.indexOf("contents.setWindowOpenHandler("));
  assert.match(handler, /policy\.handleWindowOpen\(url, contents\.getURL\(\)\)/);
  assert.doesNotMatch(handler, /action: "allow"/);
  assert.match(handler, /action: "deny"/);
});

test("navigation policy behavior: renderer external blocked, server redirect flows, flow arms on commit", () => {
  const policy = new SiteNavigationPolicy(chatgptSite);
  // 流外：任何 external 都拦
  assert.equal(policy.handleNavigation("https://evil.example.com/", true, true).allow, false);
  // 提交进 auth 流后：服务端 302(external) 放行，渲染端 external 仍拦
  policy.commit("https://auth.openai.com/authorize");
  assert.equal(policy.authFlowActive, true);
  assert.equal(policy.handleNavigation("https://verify.example/step", true, true).allow, true);
  assert.equal(policy.handleNavigation("https://evil.example.com/", true, false).allow, false);
  // 回本站提交清零流
  policy.commit("https://chatgpt.com/");
  assert.equal(policy.authFlowActive, false);
  // window.open 恒不放真窗口：external 拒、跨站同站目标拒
  assert.equal(policy.handleWindowOpen("https://evil.example.com/", "https://chatgpt.com/").rewrite, false);
  assert.equal(policy.handleWindowOpen("https://chatgpt.com/logout", "https://evil.example.com/").rewrite, false);
});

test("site view security is read back from the live view and rate-limits dialogs", () => {
  const siteView = readSource("src/main/site-view.ts");
  const diagnostics = readSource("src/main/diagnostics.ts");
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
  const main = readSource("src/main/index.ts");
  const ipc = readSource("src/main/shell-ipc.ts");
  assert.match(main, /const runtimeInfo: RuntimeInfo/);
  assert.match(main, /runtime: runtimeInfo/);
  assert.match(ipc, /runtime: options\.runtime/);
});

test("a copied profile receives a distinct sync device identity before services start", () => {
  const main = readSource("src/main/index.ts");
  const databaseOpen = main.indexOf("DesktopDatabase.open");
  const resetIdentity = main.indexOf("applyPortableImportIdentity", databaseOpen);
  const createWindow = main.indexOf("await createWindow()", databaseOpen);
  assert.ok(databaseOpen >= 0 && databaseOpen < resetIdentity && resetIdentity < createWindow);
  assert.match(main, /desktopDatabase!\.adoptImportedProfile\(deviceId\)/);
});

test("portable setup failures localize without calling app.getLocale before ready", () => {
  const main = readSource("src/main/index.ts");
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
  const main = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  assert.match(main, /polyask:set-display/);
  assert.match(main, /trustedShell\(event\)/);
  assert.match(preload, /setDisplayPreferences/);
  assert.match(preload, /onDisplayPreferences/);
});

test("composer expansion crosses a boolean-only trusted shell bridge", () => {
  const main = readSource("src/main/shell-ipc.ts");
  const manager = readSource("src/main/view-manager.ts");
  const preload = readSource("src/preload/shell.ts");
  assert.match(main, /polyask:set-composer-expanded/);
  assert.match(main, /typeof value !== "boolean"/);
  assert.match(manager, /setComposerExpanded/);
  assert.match(preload, /setComposerExpanded/);
});

test("workspace mutations cross the trusted shell bridge and the drawer reserves native bounds", () => {
  const main = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const manager = readSource("src/main/view-manager.ts");
  const workspaceLayout = readSource("src/main/workspace-layout.ts");
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
  const main = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  assert.match(main, /polyask:set-page/);
  assert.match(main, /parsePageIndex/);
  assert.match(main, /manager\.setSelection/);
  assert.match(preload, /setPage/);
});

test("image IPC rejects unsupported sites before native view dispatch", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  assert.match(ipc, /unsupportedImageSites/);
  assert.match(ipc, /image_sites_unsupported/);
});

test("answer collection uses the trusted shell and the existing read-only adapter hook", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const sitePreload = readSource("src/preload/site.ts");
  assert.match(ipc, /polyask:collect/);
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(preload, /collectAnswers/);
  assert.match(sitePreload, /collectAnswer/);
});

test("answer generation monitoring is run-scoped and never changes navigation", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const manager = readSource("src/main/view-manager.ts");
  const preload = readSource("src/preload/site.ts");
  assert.match(ipc, /manager\.beginGenerationRun\(request\.runId, request\.sites\)/);
  assert.match(ipc, /watchGeneration\(request\.runId, result\.site\)/);
  assert.match(ipc, /cancelGenerationRun\(\)/);
  assert.match(manager, /cmd: "generation"/);
  assert.match(preload, /parseGenerationState/);
  assert.doesNotMatch(manager, /generation[\s\S]{0,500}(loadURL|reload\(|focus\()/);
});

test("a retried run keeps watching the sites that are still generating", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const manager = readSource("src/main/view-manager.ts");
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
  const manager = readSource("src/main/view-manager.ts");
  const navigate = manager.slice(
    manager.indexOf("async navigate(site: SiteKey"),
    manager.indexOf("markStatus(status: SiteStatus)")
  );
  assert.match(navigate, /this\.invalidateGeneration\(site\)/);
  assert.doesNotMatch(navigate, /cancelGenerationRun/);
  assert.match(manager, /invalidateGeneration\(site: SiteKey\): void \{\s*this\.generation\.forget\(site\)/);
});

test("one unreadable generation probe never ends the watch", () => {
  const manager = readSource("src/main/view-manager.ts");
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
  const monitor = readSource("src/main/generation-monitor.ts");
  assert.match(monitor, /COMPLETE_CONFIRMATIONS = 3/);
  assert.match(monitor, /entry\.completeStreak \+= 1/);
  assert.match(monitor, /entry\.completeStreak >= COMPLETE_CONFIRMATIONS/);
  assert.doesNotMatch(monitor, /\.length/);
});

test("commands refuse to reach a crashed or failed page instead of guessing", () => {
  const manager = readSource("src/main/view-manager.ts");
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
  const main = readSource("src/main/index.ts");
  const ipc = readSource("src/main/shell-ipc.ts");
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
  const manager = readSource("src/main/view-manager.ts");
  const start = manager.indexOf("setSurface(");
  const end = manager.indexOf("\n  focusRelative", start);
  const implementation = manager.slice(start, end);
  const detach = manager.slice(manager.indexOf("private detach("), manager.indexOf("\n  private dispose"));
  assert.match(implementation, /this\.detach/);
  assert.match(implementation, /this\.reconcileViews/);
  assert.match(detach, /removeChildView/);
  assert.doesNotMatch(implementation, /webContents\.close/);
  assert.match(readSource("src/shared/protocol.ts"), /"commands"/);
  assert.match(readSource("src/main/shell-ipc.ts"), /"commands"/);
});

test("site health and guarded reload cross the trusted typed bridge", () => {
  const healthIpc = readSource("src/main/site-health-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const sitePreload = readSource("src/preload/site.ts");
  const manager = readSource("src/main/view-manager.ts");
  assert.match(healthIpc, /polyask:site-health/);
  assert.match(healthIpc, /polyask:reload-site/);
  assert.match(healthIpc, /options\.trusted\(event\)/);
  assert.match(preload, /checkSiteHealth/);
  assert.match(preload, /reloadSite\(site: SiteKey, ignoreCache\?: boolean\): Promise<boolean>/);
  assert.match(sitePreload, /cmd === "diagnose"/);
  assert.match(manager, /siteReloadAllowed/);
  assert.match(manager, /this\.pageStatus\.get\(site\)/);
  assert.match(manager, /this\.runStatus\.get\(site\)/);
});

test("hard reload and clear-site-data self-rescue actions cross the trusted typed bridge", () => {
  const healthIpc = readSource("src/main/site-health-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const manager = readSource("src/main/view-manager.ts");
  assert.match(healthIpc, /polyask:clear-site-data/);
  const reloadHandler = healthIpc.slice(
    healthIpc.indexOf('ipcMain.handle("polyask:reload-site"'),
    healthIpc.indexOf('ipcMain.handle("polyask:clear-site-data"')
  );
  assert.match(reloadHandler, /options\.trusted\(event\)/);
  assert.match(reloadHandler, /throw new Error\("untrusted_sender"\)/);
  assert.match(reloadHandler, /SITE_KEYS\.includes\(value as SiteKey\)/);
  assert.match(reloadHandler, /throw new Error\("invalid_site"\)/);
  assert.match(reloadHandler, /manager\.reload\(value as SiteKey, ignoreCache === true\)/);
  const clearHandler = healthIpc.slice(healthIpc.indexOf('ipcMain.handle("polyask:clear-site-data"'));
  assert.match(clearHandler, /options\.trusted\(event\)/);
  assert.match(clearHandler, /throw new Error\("untrusted_sender"\)/);
  assert.match(clearHandler, /SITE_KEYS\.includes\(value as SiteKey\)/);
  assert.match(clearHandler, /throw new Error\("invalid_site"\)/);
  assert.match(clearHandler, /manager\.clearSiteData\(value as SiteKey\)/);
  assert.match(healthIpc, /removeHandler\("polyask:clear-site-data"\)/);
  assert.match(preload, /clearSiteData\(site: SiteKey\): Promise<boolean>/);
  assert.match(preload, /\binvoke\("polyask:clear-site-data", site\)/);
  assert.match(manager, /reload\(site: SiteKey, ignoreCache = false\): boolean/);
  assert.match(manager, /reloadIgnoringCache\(\)/);
  const clearSiteData = manager.slice(
    manager.indexOf("async clearSiteData(site: SiteKey)"),
    manager.indexOf("checkHealth(sites: readonly SiteKey[])")
  );
  assert.match(clearSiteData, /siteReloadAllowed\(this\.currentStatus\(site\)\.phase\)/);
  assert.match(clearSiteData, /clearStorageData\(\{/);
  assert.match(clearSiteData, /storages: \["cachestorage", "serviceworkers"\]/);
  assert.doesNotMatch(clearSiteData, /"cookies"/);
  assert.match(clearSiteData, /reloadIgnoringCache\(\)/);
});

test("every main-process IPC handler guards its own sender", () => {
  for (const file of ["src/main/site-health-ipc.ts", "src/main/sync-ipc.ts"]) {
    const source = readSource(file);
    const handlers = source.match(/ipcMain\.handle\(/g) ?? [];
    const guards = source.match(/options\.trusted\(event\)/g) ?? [];
    assert.ok(handlers.length > 0, file);
    assert.equal(guards.length, handlers.length, file);
  }
  const shell = readSource("src/main/shell-ipc.ts");
  const shellHandlers = shell.match(/ipcMain\.handle\(/g) ?? [];
  const shellGuards = shell.match(/trustedShell\(event\)/g) ?? [];
  assert.ok(shellHandlers.length > 0);
  assert.ok(shellGuards.length >= shellHandlers.length);
});

test("archive mutations and history persistence stay behind trusted main-process IPC", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
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
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const main = readSource("src/main/index.ts");
  assert.match(ipc, /polyask:prompt-template-save/);
  assert.match(ipc, /polyask:prompt-template-delete/);
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(preload, /savePromptTemplate/);
  assert.match(preload, /deletePromptTemplate/);
  assert.match(preload, /onPromptLibrary/);
  assert.match(main, /PromptLibraryService/);
});

test("completion notifications are boolean-only and update checks open the official release page", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const renderer = readSource("src/renderer/index.tsx");
  const main = readSource("src/main/index.ts");
  assert.match(ipc, /polyask:set-completion-notifications/);
  assert.match(ipc, /typeof value !== "boolean"/);
  assert.match(preload, /setCompletionNotifications/);
  assert.match(main, /CompletionNotifier/);
  assert.match(renderer, /github\.com\/pine2D\/polyask\/releases\/latest/);
  assert.match(renderer, /nextSiteForStatus/);
  assert.doesNotMatch(main, /autoUpdater/);
});

test("assisted synthesis state and mutations stay behind the trusted shell bridge", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  for (const channel of ["polyask:synthesis-send", "polyask:synthesis-collect", "polyask:synthesis-save"]) {
    assert.match(ipc, new RegExp(channel));
  }
  assert.match(ipc, /pendingSynthesis: synthesis\.getPending\(\)/);
  assert.match(preload, /sendSynthesis/);
  assert.match(preload, /collectSynthesis/);
  assert.match(preload, /saveSynthesis/);
});

test("Drive sync uses a trusted typed bridge and protects destructive cloud clearing", () => {
  const ipc = readSource("src/main/sync-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  const protocol = readSource("src/shared/protocol.ts");
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
  const ipc = readSource("src/main/sync-ipc.ts");
  const preload = readSource("src/preload/shell.ts");
  assert.match(ipc, /polyask:sync-diagnostics/);
  assert.match(ipc, /options\.trusted\(event\)/);
  assert.match(preload, /syncDiagnostics\(\): Promise<SyncDiagnosticSnapshot>/);
  assert.match(preload, /polyask:sync-diagnostics/);
});

test("Drive diagnostics command opens and targets the settings diagnostic section", () => {
  const renderer = readSource("src/renderer/index.tsx");
  assert.match(renderer, /"open-drive-diagnostics": \(\) =>/);
  assert.match(renderer, /setSettingsSection\("drive-diagnostics"\)/);
  assert.match(renderer, /initialSection=\{settingsSection\}/);
});

test("windows and linux auto-hide the native menu bar", () => {
  const main = readSource("src/main/index.ts");
  assert.match(main, /setAutoHideMenuBar\(true\)/);
  assert.match(main, /setMenuBarVisibility\(false\)/);
});

test("desktop UI state restores before window creation and remains local to the profile", () => {
  const main = readSource("src/main/index.ts");
  const manager = readSource("src/main/view-manager.ts");
  const store = readSource("src/main/ui-state-store.ts");
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

test("workspace popup menus stay in trusted native UI", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const native = readSource("src/main/native-menus.ts");
  const preload = readSource("src/preload/shell.ts");

  // 分组/命令菜单是定位到指针的弹出菜单，仍走原生。
  for (const channel of ["polyask:show-group-menu", "polyask:show-command-menu"]) {
    assert.match(ipc, new RegExp(channel));
  }
  assert.match(ipc, /trustedShell\(event\)/);
  assert.match(native, /Menu\.buildFromTemplate/);
  assert.match(preload, /showGroupMenu/);
  assert.match(preload, /showCommandMenu/);
});

// 新建会话的确认改在应用内画：原生 dialog.showMessageBox 用的是各平台系统外观，与本应用
// 其余部分格格不入。这不是安全回退——外壳本身就是受信任来源（isTrustedShellUrl 守着导航），
// 站点视图是独立 WebContentsView 画不到外壳上；外壳若被攻陷，它本来就可以干脆不调用确认。
test("the new-session confirmation is drawn in-app, with no native dialog left behind", () => {
  const ipc = readSource("src/main/shell-ipc.ts");
  const native = readSource("src/main/native-menus.ts");
  const preload = readSource("src/preload/shell.ts");
  const dialog = readSource("src/renderer/confirm-dialog.tsx");
  const renderer = readSource("src/renderer/index.tsx");

  // 旧通道必须整条拆掉，留着就还有第二条路径，两边会漂
  assert.ok(!/confirm-new-session|confirmNewSession/.test(ipc + native + preload),
    "原生确认通道必须完全移除，不能只是不再调用");
  assert.ok(!/dialog\.showMessageBox/.test(native), "native-menus 不该再有系统弹框");

  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/,
    "默认焦点必须落在取消上——这个动作会离开当前对话，误触代价不对称");
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/, "焦点要圈在弹层内，Tab 跑出去就回不来");
  assert.match(renderer, /ConfirmDialog/);
  assert.match(renderer, /newSessionConfirmAction/);
});
