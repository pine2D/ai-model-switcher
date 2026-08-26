import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import { getCopy } from "../shared/copy";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type { LayoutState, SiteStatus } from "../shared/protocol";
import type { SyncStatus } from "../shared/sync";
import type { WorkspaceState } from "../shared/workspace";
import { ArchiveService } from "./archive-service";
import { BroadcastCoordinator } from "./broadcast";
import { CollectionService } from "./collection-service";
import { DesktopDatabase } from "./database";
import { HistoryService } from "./history-service";
import { isTrustedShellUrl } from "./security";
import { startRuntimeGates } from "./runtime-gates";
import { registerShellIpc } from "./shell-ipc";
import { SITES } from "./sites";
import { runStartup } from "./startup";
import { statusForResult } from "./status";
import { createSyncRuntime } from "./sync-runtime";
import { SynthesisService } from "./synthesis-service";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

if (squirrelStartup) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.squirrel.PolyAsk.PolyAsk");

const coordinator = new BroadcastCoordinator();
let mainWindow: BrowserWindow | null = null;
let viewManager: ViewManager | null = null;
let desktopDatabase: DesktopDatabase | null = null;

if (app.isPackaged) app.commandLine.removeSwitch("remote-debugging-port");

type ShellPayload = SiteStatus | LayoutState | DisplayPreferences | WorkspaceState | SyncStatus;

function sendToShell(channel: string, payload: ShellPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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
        {
          label: copy.focusPromptMenu,
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.webContents.focus();
            mainWindow.webContents.send("polyask:focus-prompt");
          }
        },
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
  const window = new BrowserWindow({
    title: copy.appTitle,
    width: 1600,
    height: 1050,
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
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, MAIN_WINDOW_WEBPACK_ENTRY)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const runtimeGates = startRuntimeGates(window);
  const manager = new ViewManager(
    window,
    (status) => sendToShell("polyask:site-status", status),
    (layout) => sendToShell("polyask:layout", layout),
    runtimeGates.record
  );
  viewManager = manager;
  if (!desktopDatabase) throw new Error("database_not_ready");
  const collection = new CollectionService(
    SITES,
    (site, deadline) => manager.collect(site, deadline)
  );
  const workspace = new WorkspaceService(
    desktopDatabase.state,
    desktopDatabase.meta,
    (site, url) => manager.navigate(site, url),
    { onNewSession: () => collection.clearRun() }
  );
  manager.setSelection(workspace.getState().selectedSites);
  const deviceId = () => {
    const stored = desktopDatabase?.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    if (!desktopDatabase) throw new Error("database_not_ready");
    return desktopDatabase.meta.put("deviceId", randomUUID());
  };
  deviceId();
  const archives = new ArchiveService(desktopDatabase.archives, { deviceId });
  const history = new HistoryService(desktopDatabase.history, { deviceId });
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
    database: desktopDatabase,
    workspace: () => workspace.getState(),
    onStatus: (status) => sendToShell("polyask:sync-status", status),
    onWorkspace: (state) => {
      manager.setSelection(state.selectedSites);
      sendToShell("polyask:workspace-state", state);
    }
  });
  createMenu();
  const disposeIpc = registerShellIpc({
    window,
    manager,
    workspace,
    coordinator,
    collection,
    archives,
    history,
    synthesis,
    sync,
    shellEntry: MAIN_WINDOW_WEBPACK_ENTRY,
    applyDisplay: (value) => applyDisplayPreferences(manager, value)
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  sync.start();
  runtimeGates.writeDiagnostic(manager);
  window.on("closed", () => {
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
    dialog.showErrorBox(copy.startupFailedTitle, copy.startupFailedMessage);
  } finally {
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.on("activate", () => {
    if (!mainWindow) void runStartup(createWindow, failStartup);
  });
  void app.whenReady().then(() => runStartup(async () => {
    desktopDatabase = DesktopDatabase.open(join(app.getPath("userData"), "polyask.sqlite"));
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
