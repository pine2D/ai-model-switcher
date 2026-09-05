import {
  ipcMain,
  shell as electronShell,
  type BrowserWindow,
  type WebContents,
  type WebFrameMain
} from "electron";

import { applicationMenuShortcuts } from "./menu-shortcuts";
import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { ArchiveFilters, ArchiveInput, ArchivePatch } from "../shared/archive";
import { parseDisplayPreferences, type DisplayPreferences } from "../shared/display";
import type { RuntimeInfo } from "../shared/runtime";
import { unsupportedImageSites } from "../shared/images";
import {
  parseBroadcastRequest,
  parseCollectionRequest,
  parsePageIndex,
  type DesktopSurface,
  type SiteResponseEnvelope
} from "../shared/protocol";
import { BroadcastCoordinator } from "./broadcast";
import { ArchiveService } from "./archive-service";
import { CollectionService } from "./collection-service";
import type { DataAdminService } from "./data-admin-service";
import { registerDataAdminIpc } from "./data-admin-ipc";
import { HistoryService } from "./history-service";
import { PromptLibraryService } from "./prompt-library-service";
import { SynthesisService } from "./synthesis-service";
import { SyncEngine } from "./sync-engine";
import { registerSyncIpc } from "./sync-ipc";
import { registerSiteHealthIpc } from "./site-health-ipc";
import { isTrustedShellUrl, safeExternalUrl } from "./security";
import { showCommandMenu, showGroupMenu } from "./native-menus";
import { SITES } from "./sites";
import { statusForResult } from "./status";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

interface ShellIpcEvent {
  readonly sender: WebContents;
  readonly senderFrame: WebFrameMain | null;
}

interface ShellIpcOptions {
  readonly runtime: RuntimeInfo;
  readonly copy: DesktopCopy;
  readonly window: BrowserWindow;
  readonly manager: ViewManager;
  readonly workspace: WorkspaceService;
  readonly coordinator: BroadcastCoordinator;
  // Assisted synthesis dispatches through its own coordinator so that opening the
  // archive and sending a synthesis prompt cannot abort an in-flight broadcast.
  readonly synthesisCoordinator: BroadcastCoordinator;
  readonly collection: CollectionService;
  readonly archives: ArchiveService;
  readonly history: HistoryService;
  readonly promptLibrary: PromptLibraryService;
  readonly synthesis: SynthesisService;
  readonly sync: SyncEngine;
  readonly dataAdmin: DataAdminService;
  readonly shellEntry: string;
  readonly applyDisplay: (value: DisplayPreferences) => DisplayPreferences;
  readonly setCompletionNotifications: (enabled: boolean) => void;
}

const HANDLERS = [
  "polyask:bootstrap",
  "polyask:menu-shortcuts",
  "polyask:site-history-state",
  "polyask:set-display",
  "polyask:broadcast",
  "polyask:collect",
  "polyask:archive-search",
  "polyask:archive-get",
  "polyask:archive-add",
  "polyask:archive-update",
  "polyask:archive-delete",
  "polyask:archive-markdown",
  "polyask:synthesis-send",
  "polyask:synthesis-collect",
  "polyask:synthesis-save",
  "polyask:open-external",
  "polyask:set-selection",
  "polyask:set-tier",
  "polyask:save-group",
  "polyask:delete-group",
  "polyask:new-session",
  "polyask:show-group-menu",
  "polyask:show-command-menu",
  "polyask:prompt-template-save",
  "polyask:prompt-template-delete"
] as const;

const LISTENERS = [
  "polyask:cancel",
  "polyask:set-composer-expanded",
  "polyask:set-drawer-open",
  "polyask:set-surface",
  "polyask:set-layout",
  "polyask:set-page",
  "polyask:step-page",
  "polyask:step-site",
  "polyask:step-history",
  "polyask:set-completion-notifications",
  "polyask:site-response"
] as const;

function strictId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new Error("invalid_id");
  return value;
}

export function registerShellIpc(options: ShellIpcOptions): () => void {
  const { window, manager, workspace, coordinator, synthesisCoordinator, collection, archives, history, promptLibrary, synthesis, sync } = options;
  const trustedShell = (event: ShellIpcEvent) =>
    event.sender.id === window.webContents.id &&
    event.senderFrame?.parent === null &&
    isTrustedShellUrl(event.senderFrame.url, options.shellEntry);
  const publishWorkspace = () => {
    const state = workspace.getState();
    manager.setSelection(state.selectedSites);
    if (!window.isDestroyed()) window.webContents.send("polyask:workspace-state", state);
    return state;
  };
  const publishPromptLibrary = () => {
    const state = promptLibrary.getState();
    if (!window.isDestroyed()) window.webContents.send("polyask:prompt-library", state);
    return state;
  };
  const disposeSyncIpc = registerSyncIpc({ sync, runtime: options.runtime, trusted: trustedShell });
  const disposeSiteHealthIpc = registerSiteHealthIpc({ manager, trusted: trustedShell });
  const disposeDataAdminIpc = registerDataAdminIpc({
    admin: options.dataAdmin,
    trusted: trustedShell,
    afterHistoryChange: () => { publishPromptLibrary(); },
    afterReset: () => { publishWorkspace(); publishPromptLibrary(); }
  });

  // 速查面板按需拉取：菜单会随显示偏好重建，按需读永远是当前那一份。
  ipcMain.handle("polyask:menu-shortcuts", (event) =>
    trustedShell(event) ? applicationMenuShortcuts() : []);
  ipcMain.handle("polyask:bootstrap", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return {
      runtime: options.runtime,
      sites: SITES,
      statuses: manager.getStatuses(),
      layout: manager.getLayout(),
      display: manager.getDisplayPreferences(),
      workspace: workspace.getState(),
      promptLibrary: promptLibrary.getState(),
      pendingSynthesis: synthesis.getPending(),
      sync: sync.status()
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
    if (request.images.length && unsupportedImageSites(request.sites, SITES).length) {
      throw new Error("image_sites_unsupported");
    }
    // beginRun first: a stale retry throws before generation monitoring is touched.
    collection.beginRun(request.runId, request.sites);
    manager.beginGenerationRun(request.runId, request.sites);
    // Recorded before dispatch, matching the extension (console/console.js pushes
    // history ahead of sendAll): a question the user actually asked belongs in the
    // library even when every site fails.
    history.record(request.text);
    publishPromptLibrary();
    for (const site of request.sites) manager.markStatus({ site, phase: "sending" });
    const results = await coordinator.send(
      request,
      (site, command, signal) => manager.sendCommand(site, command, signal),
      request.images.length ? 90_000 : 44_000,
      (result) => {
        manager.markStatus(statusForResult(result.site, result));
        if (result.ok) manager.watchGeneration(request.runId, result.site);
      },
      { confirm: (site, command, signal) => manager.confirmSubmitted(site, command, signal) }
    );
    return results;
  });
  ipcMain.handle("polyask:collect", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const request = parseCollectionRequest(value);
    if (!request) throw new Error("invalid_collection_request");
    return collection.collect(request.sites, request.runId);
  });
  ipcMain.handle("polyask:archive-search", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return archives.search(value && typeof value === "object" ? value as ArchiveFilters : {});
  });
  ipcMain.handle("polyask:archive-get", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return archives.get(strictId(value));
  });
  ipcMain.handle("polyask:archive-add", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") throw new Error("invalid_archive");
    return archives.add(value as ArchiveInput);
  });
  ipcMain.handle("polyask:archive-update", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") throw new Error("invalid_archive_update");
    const input = value as { id?: unknown; patch?: unknown };
    if (!input.patch || typeof input.patch !== "object") throw new Error("invalid_archive_update");
    return archives.update(strictId(input.id), input.patch as ArchivePatch);
  });
  ipcMain.handle("polyask:archive-delete", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    archives.delete(strictId(value));
  });
  ipcMain.handle("polyask:archive-markdown", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") throw new Error("invalid_archive_export");
    const input = value as { id?: unknown; locale?: unknown };
    const locale = typeof input.locale === "string" && input.locale.length <= 32 ? input.locale : "en";
    return archives.exportMarkdown(strictId(input.id), locale);
  });
  ipcMain.handle("polyask:synthesis-send", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return synthesis.send(value);
  });
  ipcMain.handle("polyask:synthesis-collect", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return synthesis.collect();
  });
  ipcMain.handle("polyask:synthesis-save", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") throw new Error("invalid_synthesis_save");
    return synthesis.save(value);
  });
  ipcMain.handle("polyask:open-external", async (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const url = safeExternalUrl(value);
    if (!url) throw new Error("invalid_external_url");
    await electronShell.openExternal(url);
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
  ipcMain.handle("polyask:new-session", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return workspace.newSession(value);
  });
  ipcMain.handle("polyask:show-group-menu", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    const groups = workspace.getState().groups;
    return showGroupMenu(window, groups, options.copy);
  });
  ipcMain.handle("polyask:show-command-menu", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return showCommandMenu(window, value, options.copy);
  });
  ipcMain.handle("polyask:prompt-template-save", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    promptLibrary.save(value);
    return publishPromptLibrary();
  });
  ipcMain.handle("polyask:prompt-template-delete", (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    promptLibrary.delete(value);
    return publishPromptLibrary();
  });
  ipcMain.on("polyask:cancel", (event) => {
    if (trustedShell(event)) {
      coordinator.cancel();
      // Cancel reaches both dispatch paths; the synthesis coordinator is separate
      // from the broadcast one and would otherwise keep typing into a site.
      synthesisCoordinator.cancel();
      manager.cancelGenerationRun();
      synthesis.cancel();
    }
  });
  ipcMain.on("polyask:set-composer-expanded", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") return;
    manager.setComposerExpanded(value);
  });
  ipcMain.on("polyask:set-drawer-open", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") return;
    manager.setDrawerOpen(value);
  });
  ipcMain.on("polyask:set-surface", (event, value: unknown) => {
    if (!trustedShell(event) || !["sites", "archive", "settings", "commands"].includes(String(value))) return;
    manager.setSurface(value as DesktopSurface);
  });
  ipcMain.on("polyask:set-layout", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") return;
    const candidate = value as { mode?: unknown; focused?: unknown };
    if (candidate.mode !== "overview" && candidate.mode !== "focus") return;
    if (typeof candidate.focused !== "string" || !SITE_KEYS.includes(candidate.focused as SiteKey)) return;
    manager.setLayout(candidate.mode, candidate.focused as SiteKey);
  });
  ipcMain.on("polyask:set-page", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const page = parsePageIndex(value);
    if (page !== null) manager.setPage(page);
  });
  // 相对翻页/换焦点只认 ViewManager 的当前页与聚焦顺序——渲染层自己算会与主进程漂开。
  const step = (value: unknown): -1 | 1 | null => (value === 1 ? 1 : value === -1 ? -1 : null);
  ipcMain.on("polyask:step-page", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const offset = step(value);
    if (offset) manager.pageRelative(offset);
  });
  ipcMain.on("polyask:step-site", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const offset = step(value);
    if (offset) manager.focusRelative(offset);
  });
  // 站内后退/前进：作用于当前聚焦的站点视图，能不能退由 ViewManager 按真实导航历史判定。
  ipcMain.on("polyask:step-history", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const candidate = value as { site?: unknown; offset?: unknown } | null;
    const offset = step(candidate?.offset);
    const site = typeof candidate?.site === "string" && SITE_KEYS.includes(candidate.site as SiteKey)
      ? candidate.site as SiteKey
      : manager.getLayout().focused;
    if (offset) manager.navigateHistory(site, offset);
  });
  ipcMain.handle("polyask:site-history-state", (event) =>
    trustedShell(event) ? manager.historyState() : {});
  ipcMain.on("polyask:set-completion-notifications", (event, value: unknown) => {
    if (!trustedShell(event) || typeof value !== "boolean") return;
    options.setCompletionNotifications(value);
  });
  ipcMain.on("polyask:site-response", (event, envelope: SiteResponseEnvelope) => {
    // 只认站点视图的主帧：nodeIntegrationInSubFrames 默认关闭，preload 本就不进子帧，这里把默认值写成显式不变量。
    if (event.senderFrame?.parent !== null) return;
    if (manager.owns(event.sender)) manager.receiveResponse(event.sender, envelope);
  });

  return () => {
    disposeSyncIpc();
    disposeSiteHealthIpc();
    disposeDataAdminIpc();
    for (const channel of HANDLERS) ipcMain.removeHandler(channel);
    for (const channel of LISTENERS) ipcMain.removeAllListeners(channel);
  };
}
