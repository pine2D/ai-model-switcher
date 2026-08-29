import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  screen,
  type MenuItemConstructorOptions
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import {
  COMMANDS,
  commandAccelerator,
  commandAliasForInput,
  type CommandId
} from "../shared/commands";
import { formatCopy, getCopy } from "../shared/copy";
import { parseDesktopUiState } from "../shared/desktop-ui-state";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type { LayoutState, SiteStatus } from "../shared/protocol";
import type { SyncStatus } from "../shared/sync";
import type { RuntimeInfo } from "../shared/runtime";
import type { PromptLibraryState } from "../shared/prompt-library";
import type { WorkspaceState } from "../shared/workspace";
import { ArchiveService } from "./archive-service";
import { BroadcastCoordinator } from "./broadcast";
import { CollectionService } from "./collection-service";
import { CompletionNotifier } from "./completion-notifier";
import { DesktopDatabase } from "./database";
import { HistoryService } from "./history-service";
import { PromptLibraryService } from "./prompt-library-service";
import {
  applyPortableImportIdentity,
  finalizePortableDataImport,
  hasImportableLegacyData,
  initializePortableData,
  isPortableDataInitialized,
  resolveRuntimeProfile
} from "./portable-profile";
import { isTrustedShellUrl } from "./security";
import { startRuntimeGates } from "./runtime-gates";
import { registerShellIpc } from "./shell-ipc";
import { SITES } from "./sites";
import { runStartup } from "./startup";
import { statusForResult } from "./status";
import { createSyncRuntime } from "./sync-runtime";
import { SynthesisService } from "./synthesis-service";
import { UiStateStore } from "./ui-state-store";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

if (squirrelStartup) app.quit();
const startupLocale = (): string => {
  try { return app.getPreferredSystemLanguages()[0] ?? "en"; }
  catch { return "en"; }
};
const runtimeProfile = resolveRuntimeProfile({
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  defaultUserDataPath: app.getPath("userData"),
  version: app.getVersion()
});
const runtimeInfo: RuntimeInfo = {
  distribution: runtimeProfile.distribution,
  version: runtimeProfile.version
};
let profileReady = true;
let instanceLockHeld = false;
let legacyProfileLock = false;
let legacyDataAvailable = false;
if (runtimeProfile.distribution === "portable") {
  try {
    const portableDataInitialized = isPortableDataInitialized(runtimeProfile);
    if (!portableDataInitialized) legacyDataAvailable = hasImportableLegacyData(runtimeProfile);
    if (portableDataInitialized) {
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      instanceLockHeld = app.requestSingleInstanceLock();
      if (instanceLockHeld) finalizePortableDataImport(runtimeProfile);
    } else if (legacyDataAvailable) {
      legacyProfileLock = app.requestSingleInstanceLock();
      instanceLockHeld = legacyProfileLock;
      if (!legacyProfileLock) throw new Error("portable_legacy_in_use");
      finalizePortableDataImport(runtimeProfile);
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      if (isPortableDataInitialized(runtimeProfile)) {
        app.releaseSingleInstanceLock();
        legacyProfileLock = false;
        instanceLockHeld = app.requestSingleInstanceLock();
      }
    } else {
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      instanceLockHeld = app.requestSingleInstanceLock();
      if (instanceLockHeld) finalizePortableDataImport(runtimeProfile);
    }
  } catch (error) {
    profileReady = false;
    const copy = getCopy(startupLocale());
    const code = (error as { message?: string }).message;
    const failure = code === "portable_import_failed"
      ? [copy.portableImportFailedTitle, copy.portableImportFailedMessage]
      : code === "portable_data_unrecognized"
        ? [copy.portableDataConflictTitle, copy.portableDataConflictMessage]
        : code === "portable_legacy_in_use"
          ? [copy.portableLegacyInUseTitle, copy.portableLegacyInUseMessage]
          : [copy.portableStorageFailedTitle, copy.portableStorageFailedMessage];
    dialog.showErrorBox(failure[0], failure[1]);
    app.quit();
  }
}
if (process.platform === "win32") {
  app.setAppUserModelId(runtimeProfile.distribution === "portable"
    ? "com.pine2d.polyask.portable"
    : "com.squirrel.PolyAsk.PolyAsk");
}

const coordinator = new BroadcastCoordinator();
let mainWindow: BrowserWindow | null = null;
let viewManager: ViewManager | null = null;
let desktopDatabase: DesktopDatabase | null = null;

if (app.isPackaged) app.commandLine.removeSwitch("remote-debugging-port");

type ShellPayload = SiteStatus | LayoutState | DisplayPreferences | WorkspaceState | SyncStatus | PromptLibraryState;

function sendToShell(channel: string, payload: ShellPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function dispatchAppCommand(id: CommandId): void {
  const page = (["show-page-1", "show-page-2", "show-page-3"] as const).indexOf(
    id as "show-page-1" | "show-page-2" | "show-page-3"
  );
  if (page >= 0) {
    viewManager?.pageDirect(page);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (id === "focus-prompt") mainWindow.webContents.focus();
  mainWindow.webContents.send("polyask:command", id);
}

function applyDisplayPreferences(
  manager: ViewManager,
  value: DisplayPreferences
): DisplayPreferences {
  manager.setDisplayPreferences(value);
  createMenu();
  sendToShell("polyask:display-preferences", value);
  return value;
}

function createMenu(): void {
  const copy = getCopy(app.getLocale());
  const display = viewManager?.getDisplayPreferences() ?? DEFAULT_DISPLAY_PREFERENCES;
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ label: app.name, submenu: [{ role: "about" as const }, { type: "separator" as const }, { role: "quit" as const }] }]
      : []),
    {
      label: copy.fileMenu,
      submenu: [process.platform === "darwin" ? { role: "close" } : { role: "quit" }]
    },
    {
      label: copy.editMenu,
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
      ]
    },
    {
      label: copy.viewMenu,
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        {
          label: copy.densityMenu,
          submenu: [
            {
              label: copy.compactDensity,
              type: "radio",
              checked: display.density === "compact",
              click: () => {
                if (viewManager) applyDisplayPreferences(viewManager, { ...display, density: "compact" });
              }
            },
            {
              label: copy.comfortableDensity,
              type: "radio",
              checked: display.density === "comfortable",
              click: () => {
                if (viewManager) applyDisplayPreferences(viewManager, { ...display, density: "comfortable" });
              }
            }
          ]
        },
        {
          label: copy.siteScaleMenu,
          submenu: [
            {
              label: copy.fitSiteScale,
              type: "radio",
              checked: display.siteScale === 0.9,
              click: () => {
                if (viewManager) applyDisplayPreferences(viewManager, { ...display, siteScale: 0.9 });
              }
            },
            {
              label: copy.actualSiteScale,
              type: "radio",
              checked: display.siteScale === 1,
              click: () => {
                if (viewManager) applyDisplayPreferences(viewManager, { ...display, siteScale: 1 });
              }
            }
          ]
        },
        { type: "separator" },
        ...COMMANDS.filter((command) => !!commandAccelerator(command.id, process.platform))
          .map((command): MenuItemConstructorOptions => ({
            label: copy[command.labelKey],
            accelerator: commandAccelerator(command.id, process.platform),
            click: () => dispatchAppCommand(command.id)
          })),
        { type: "separator" },
        {
          label: copy.nextPageMenu,
          accelerator: "CmdOrCtrl+Shift+PageDown",
          click: () => viewManager?.pageRelative(1)
        },
        {
          label: copy.previousPageMenu,
          accelerator: "CmdOrCtrl+Shift+PageUp",
          click: () => viewManager?.pageRelative(-1)
        },
        {
          label: copy.nextSiteMenu,
          accelerator: "CmdOrCtrl+PageDown",
          click: () => viewManager?.focusRelative(1)
        },
        {
          label: copy.previousSiteMenu,
          accelerator: "CmdOrCtrl+PageUp",
          click: () => viewManager?.focusRelative(-1)
        },
        { type: "separator" }, { role: "togglefullscreen" }
      ]
    },
    { label: copy.windowMenu, submenu: [{ role: "minimize" }, { role: "close" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const copy = getCopy(app.getLocale());
  if (!desktopDatabase) throw new Error("database_not_ready");
  const database = desktopDatabase;
  let managerForWorkspace: ViewManager | null = null;
  let collectionForWorkspace: CollectionService | null = null;
  const workspace = new WorkspaceService(
    database.state,
    database.meta,
    (site, url) => {
      if (!managerForWorkspace) throw new Error("view_manager_not_ready");
      return managerForWorkspace.navigate(site, url);
    },
    { onNewSession: () => collectionForWorkspace?.clearRun() }
  );
  const workspaceState = workspace.getState();
  const uiStateStore = new UiStateStore(join(app.getPath("userData"), "desktop-ui-state.json"));
  const initialUiState = parseDesktopUiState(
    uiStateStore.load(),
    screen.getAllDisplays().map((display) => display.workArea),
    workspaceState.selectedSites
  );
  const bounds = initialUiState.windowBounds;
  const restorePosition = !(process.platform === "linux"
    && process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland");
  const window = new BrowserWindow({
    title: copy.appTitle,
    width: bounds?.width ?? 1600,
    height: bounds?.height ?? 1050,
    ...(bounds && restorePosition ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#f4f5f8",
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  if (process.platform !== "darwin") {
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  }
  mainWindow = window;
  const completionNotifier = new CompletionNotifier({
    copy: {
      title: copy.appTitle,
      complete: (site) => formatCopy(copy.completionNotificationComplete, { site }),
      failed: (site) => formatCopy(copy.completionNotificationFailed, { site })
    },
    focused: () => window.isFocused(),
    show: (notification) => {
      if (Notification.isSupported()) new Notification({ ...notification, silent: true }).show();
    }
  });
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, MAIN_WINDOW_WEBPACK_ENTRY)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const runtimeGates = startRuntimeGates(window);
  const manager = new ViewManager(
    window,
    (status) => {
      sendToShell("polyask:site-status", status);
      const site = SITES.find((candidate) => candidate.key === status.site);
      completionNotifier.accept(status, site?.label ?? status.site);
    },
    (layout) => sendToShell("polyask:layout", layout),
    runtimeGates.record,
    {
      initialUiState,
      selectedSites: workspaceState.selectedSites,
      onUiStateChange: (state) => uiStateStore.schedule(state)
    }
  );
  managerForWorkspace = manager;
  viewManager = manager;
  const collection = new CollectionService(
    SITES,
    (site, deadline) => manager.collect(site, deadline)
  );
  collectionForWorkspace = collection;
  const deviceId = () => {
    const stored = database.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    return database.meta.put("deviceId", randomUUID());
  };
  deviceId();
  const archives = new ArchiveService(database.archives, { deviceId });
  const history = new HistoryService(database.history, { deviceId });
  const promptLibrary = new PromptLibraryService(database.state, database.meta, history);
  const synthesis = new SynthesisService({
    sites: SITES,
    archives,
    navigate: (site, url) => manager.navigate(site, url),
    send: (request) => {
      for (const site of request.sites) manager.markStatus({ site, phase: "sending" });
      return coordinator.send(
        request,
        (site, command, signal) => manager.sendCommand(site, command, signal),
        44_000,
        (result) => manager.markStatus(statusForResult(result.site, result))
      );
    },
    collect: (sites, runId) => collection.collect(sites, runId),
    targetAvailable: (site) => workspace.getState().selectedSites.includes(site),
    beforeSend: () => collection.clearRun(),
    showTarget: (site) => {
      manager.setSurface("sites");
      manager.setLayout("focus", site);
    },
    recordHistory: (text) => history.record(text)
  });
  const sync = await createSyncRuntime({
    database,
    workspace: () => workspace.getState(),
    onStatus: (status) => sendToShell("polyask:sync-status", status),
    onWorkspace: (state) => {
      manager.setSelection(state.selectedSites);
      sendToShell("polyask:workspace-state", state);
      sendToShell("polyask:prompt-library", promptLibrary.getState());
    }
  });
  createMenu();
  const disposeIpc = registerShellIpc({
    runtime: runtimeInfo,
    copy,
    window,
    manager,
    workspace,
    coordinator,
    collection,
    archives,
    history,
    promptLibrary,
    synthesis,
    sync,
    shellEntry: MAIN_WINDOW_WEBPACK_ENTRY,
    applyDisplay: (value) => applyDisplayPreferences(manager, value),
    setCompletionNotifications: (enabled) => completionNotifier.setEnabled(enabled)
  });
  window.on("move", () => uiStateStore.schedule(manager.getUiState()));
  window.on("maximize", () => uiStateStore.schedule(manager.getUiState()));
  window.on("unmaximize", () => uiStateStore.schedule(manager.getUiState()));
  window.on("close", () => uiStateStore.save(manager.getUiState()));
  window.once("ready-to-show", () => {
    if (initialUiState.maximized) window.maximize();
    window.show();
  });
  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  sync.start();
  runtimeGates.writeDiagnostic(manager);
  window.on("closed", () => {
    uiStateStore.dispose();
    runtimeGates.dispose();
    sync.dispose();
    disposeIpc();
    mainWindow = null;
    viewManager = null;
  });
}

function failStartup(error: unknown): void {
  try {
    try {
      console.error("PolyAsk startup failed", error);
    } catch {
      // Continue to the visible failure path if diagnostic output is unavailable.
    }
    const copy = getCopy(app.getLocale());
    const code = (error as { message?: string }).message;
    const systemCode = (error as NodeJS.ErrnoException).code;
    const portableStorageFailed = runtimeProfile.distribution === "portable"
      && ["EACCES", "EPERM", "EROFS", "EIO"].includes(systemCode ?? "");
    const failure = code === "portable_import_failed"
      ? [copy.portableImportFailedTitle, copy.portableImportFailedMessage]
      : code === "portable_data_unrecognized"
        ? [copy.portableDataConflictTitle, copy.portableDataConflictMessage]
        : portableStorageFailed
          ? [copy.portableStorageFailedTitle, copy.portableStorageFailedMessage]
          : [copy.startupFailedTitle, copy.startupFailedMessage];
    dialog.showErrorBox(
      failure[0],
      failure[1]
    );
  } finally {
    app.quit();
  }
}

const gotLock = profileReady && (runtimeProfile.distribution === "portable"
  ? instanceLockHeld
  : app.requestSingleInstanceLock());
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("before-input-event", (event, input) => {
      const command = commandAliasForInput(input);
      if (!command) return;
      event.preventDefault();
      dispatchAppCommand(command);
    });
  });
  app.on("activate", () => {
    if (!mainWindow) void runStartup(createWindow, failStartup);
  });
  void app.whenReady().then(() => runStartup(async () => {
    const profileState = await initializePortableData(runtimeProfile, async () => {
      const copy = getCopy(app.getLocale());
      const result = await dialog.showMessageBox({
        type: "question",
        title: copy.portableImportTitle,
        message: copy.portableImportMessage,
        buttons: [copy.portableImport, copy.portableStartFresh],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      return result.response === 0;
    }, legacyDataAvailable);
    if (profileState === "import_staged") {
      app.relaunch();
      app.exit(0);
      return;
    }
    if (legacyProfileLock) {
      app.releaseSingleInstanceLock();
      legacyProfileLock = false;
      instanceLockHeld = app.requestSingleInstanceLock();
      if (!instanceLockHeld) {
        app.quit();
        return;
      }
    }
    desktopDatabase = DesktopDatabase.open(join(app.getPath("userData"), "polyask.sqlite"));
    applyPortableImportIdentity(runtimeProfile, (deviceId) => {
      desktopDatabase!.adoptImportedProfile(deviceId);
    });
    createMenu();
    await createWindow();
  }, failStartup));
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    desktopDatabase?.close();
    desktopDatabase = null;
  });
}
