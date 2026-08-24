import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
  type WebFrameMain
} from "electron";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import { getCopy } from "../shared/copy";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  parseDisplayPreferences,
  type DisplayPreferences
} from "../shared/display";
import {
  parseBroadcastRequest,
  type LayoutState,
  type SiteResponseEnvelope,
  type SiteStatus
} from "../shared/protocol";
import { BroadcastCoordinator } from "./broadcast";
import { isTrustedShellUrl } from "./security";
import { SITES } from "./sites";
import { statusForResult } from "./status";
import { ViewManager } from "./view-manager";

const coordinator = new BroadcastCoordinator();
let mainWindow: BrowserWindow | null = null;
let viewManager: ViewManager | null = null;

if (app.isPackaged) app.commandLine.removeSwitch("remote-debugging-port");

interface ShellIpcEvent {
  readonly sender: WebContents;
  readonly senderFrame: WebFrameMain | null;
}

function sendToShell(channel: string, payload: SiteStatus | LayoutState | DisplayPreferences): void {
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

function registerIpc(window: BrowserWindow, manager: ViewManager): void {
  const trustedShell = (event: ShellIpcEvent) =>
    event.sender.id === window.webContents.id &&
    event.senderFrame?.parent === null &&
    isTrustedShellUrl(event.senderFrame.url, MAIN_WINDOW_WEBPACK_ENTRY);

  ipcMain.handle("polyask:bootstrap", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return {
      sites: SITES,
      statuses: manager.getStatuses(),
      layout: manager.getLayout(),
      display: manager.getDisplayPreferences()
    };
  });
  ipcMain.handle("polyask:set-display", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const display = parseDisplayPreferences(value);
    if (!display) throw new Error("invalid_display_preferences");
    return applyDisplayPreferences(manager, display);
  });
  ipcMain.handle("polyask:broadcast", async (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const request = parseBroadcastRequest(value);
    if (!request) throw new Error("invalid_broadcast_request");
    for (const site of request.sites) manager.markStatus({ site, phase: "sending" });
    return coordinator.send(
      request,
      (site, command, signal) => manager.sendCommand(site, command, signal),
      44_000,
      (result) => manager.markStatus(statusForResult(result.site, result))
    );
  });
  ipcMain.on("polyask:cancel", (event) => {
    if (trustedShell(event)) coordinator.cancel();
  });
  ipcMain.on("polyask:set-layout", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") return;
    const candidate = value as { mode?: unknown; focused?: unknown };
    if (candidate.mode !== "overview" && candidate.mode !== "focus") return;
    if (typeof candidate.focused !== "string" || !SITE_KEYS.includes(candidate.focused as SiteKey)) return;
    manager.setLayout(candidate.mode, candidate.focused as SiteKey);
  });
  ipcMain.on("polyask:reload-site", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "string") return;
    if (SITE_KEYS.includes(value as SiteKey)) manager.reload(value as SiteKey);
  });
  ipcMain.on("polyask:site-response", (event, envelope: SiteResponseEnvelope) => {
    if (manager.owns(event.sender)) manager.receiveResponse(event.sender, envelope);
  });
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
  mainWindow = window;
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, MAIN_WINDOW_WEBPACK_ENTRY)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const manager = new ViewManager(
    window,
    (status) => sendToShell("polyask:site-status", status),
    (layout) => sendToShell("polyask:layout", layout)
  );
  viewManager = manager;
  createMenu();
  registerIpc(window, manager);
  window.once("ready-to-show", () => window.show());
  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  window.on("closed", () => {
    ipcMain.removeHandler("polyask:bootstrap");
    ipcMain.removeHandler("polyask:set-display");
    ipcMain.removeHandler("polyask:broadcast");
    ipcMain.removeAllListeners("polyask:cancel");
    ipcMain.removeAllListeners("polyask:set-layout");
    ipcMain.removeAllListeners("polyask:reload-site");
    ipcMain.removeAllListeners("polyask:site-response");
    mainWindow = null;
    viewManager = null;
  });
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
  void app.whenReady().then(async () => {
    createMenu();
    await createWindow();
    app.on("activate", () => { if (!mainWindow) void createWindow(); });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
