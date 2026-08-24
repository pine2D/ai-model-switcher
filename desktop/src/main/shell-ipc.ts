import {
  ipcMain,
  type BrowserWindow,
  type WebContents,
  type WebFrameMain
} from "electron";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import { parseDisplayPreferences, type DisplayPreferences } from "../shared/display";
import { parseBroadcastRequest, type SiteResponseEnvelope } from "../shared/protocol";
import { BroadcastCoordinator } from "./broadcast";
import { isTrustedShellUrl } from "./security";
import { SITES } from "./sites";
import { statusForResult } from "./status";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

interface ShellIpcEvent {
  readonly sender: WebContents;
  readonly senderFrame: WebFrameMain | null;
}

interface ShellIpcOptions {
  readonly window: BrowserWindow;
  readonly manager: ViewManager;
  readonly workspace: WorkspaceService;
  readonly coordinator: BroadcastCoordinator;
  readonly shellEntry: string;
  readonly applyDisplay: (value: DisplayPreferences) => DisplayPreferences;
}

const HANDLERS = [
  "polyask:bootstrap",
  "polyask:set-display",
  "polyask:broadcast",
  "polyask:set-selection",
  "polyask:set-tier",
  "polyask:save-group",
  "polyask:delete-group",
  "polyask:new-session"
] as const;

const LISTENERS = [
  "polyask:cancel",
  "polyask:set-composer-expanded",
  "polyask:set-drawer-open",
  "polyask:set-layout",
  "polyask:reload-site",
  "polyask:site-response"
] as const;

export function registerShellIpc(options: ShellIpcOptions): () => void {
  const { window, manager, workspace, coordinator } = options;
  const trustedShell = (event: ShellIpcEvent) =>
    event.sender.id === window.webContents.id &&
    event.senderFrame?.parent === null &&
    isTrustedShellUrl(event.senderFrame.url, options.shellEntry);
  const publishWorkspace = () => {
    const state = workspace.getState();
    if (!window.isDestroyed()) window.webContents.send("polyask:workspace-state", state);
    return state;
  };

  ipcMain.handle("polyask:bootstrap", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return {
      sites: SITES,
      statuses: manager.getStatuses(),
      layout: manager.getLayout(),
      display: manager.getDisplayPreferences(),
      workspace: workspace.getState()
    };
  });
  ipcMain.handle("polyask:set-display", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const display = parseDisplayPreferences(value);
    if (!display) throw new Error("invalid_display_preferences");
    return options.applyDisplay(display);
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
  ipcMain.handle("polyask:set-selection", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    workspace.setSelection(value);
    return publishWorkspace();
  });
  ipcMain.handle("polyask:set-tier", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    workspace.setTier(value);
    return publishWorkspace();
  });
  ipcMain.handle("polyask:save-group", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    workspace.saveGroup(value && typeof value === "object" ? value : {});
    return publishWorkspace();
  });
  ipcMain.handle("polyask:delete-group", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    workspace.deleteGroup(value);
    return publishWorkspace();
  });
  ipcMain.handle("polyask:new-session", async (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    await workspace.newSession(value);
  });
  ipcMain.on("polyask:cancel", (event) => {
    if (trustedShell(event)) coordinator.cancel();
  });
  ipcMain.on("polyask:set-composer-expanded", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") return;
    manager.setComposerExpanded(value);
  });
  ipcMain.on("polyask:set-drawer-open", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") return;
    manager.setDrawerOpen(value);
  });
  ipcMain.on("polyask:set-layout", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") return;
    const candidate = value as { mode?: unknown; focused?: unknown };
    if (candidate.mode !== "overview" && candidate.mode !== "focus") return;
    if (typeof candidate.focused !== "string" || !SITE_KEYS.includes(candidate.focused as SiteKey)) return;
    manager.setLayout(candidate.mode, candidate.focused as SiteKey);
  });
  ipcMain.on("polyask:reload-site", (event, value: unknown) => {
    if (trustedShell(event) && typeof value === "string" && SITE_KEYS.includes(value as SiteKey)) {
      manager.reload(value as SiteKey);
    }
  });
  ipcMain.on("polyask:site-response", (event, envelope: SiteResponseEnvelope) => {
    if (manager.owns(event.sender)) manager.receiveResponse(event.sender, envelope);
  });

  return () => {
    for (const channel of HANDLERS) ipcMain.removeHandler(channel);
    for (const channel of LISTENERS) ipcMain.removeAllListeners(channel);
  };
}
