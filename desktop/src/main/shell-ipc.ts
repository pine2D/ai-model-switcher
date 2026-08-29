import {
  ipcMain,
  shell as electronShell,
  type BrowserWindow,
  type WebContents,
  type WebFrameMain
} from "electron";

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
  type SiteResponseEnvelope
} from "../shared/protocol";
import { BroadcastCoordinator } from "./broadcast";
import { ArchiveService } from "./archive-service";
import { CollectionService } from "./collection-service";
import { HistoryService } from "./history-service";
import { SynthesisService } from "./synthesis-service";
import { SyncEngine } from "./sync-engine";
import { registerSyncIpc } from "./sync-ipc";
import { isTrustedShellUrl, safeExternalUrl } from "./security";
import { confirmNewSession, showCommandMenu, showGroupMenu } from "./native-menus";
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
  readonly collection: CollectionService;
  readonly archives: ArchiveService;
  readonly history: HistoryService;
  readonly synthesis: SynthesisService;
  readonly sync: SyncEngine;
  readonly shellEntry: string;
  readonly applyDisplay: (value: DisplayPreferences) => DisplayPreferences;
}

const HANDLERS = [
  "polyask:bootstrap",
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
  "polyask:confirm-new-session"
] as const;

const LISTENERS = [
  "polyask:cancel",
  "polyask:set-composer-expanded",
  "polyask:set-drawer-open",
  "polyask:set-surface",
  "polyask:set-layout",
  "polyask:set-page",
  "polyask:reload-site",
  "polyask:site-response"
] as const;

function strictId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new Error("invalid_id");
  return value;
}

export function registerShellIpc(options: ShellIpcOptions): () => void {
  const { window, manager, workspace, coordinator, collection, archives, history, synthesis, sync } = options;
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
  const disposeSyncIpc = registerSyncIpc({ sync, trusted: trustedShell });

  ipcMain.handle("polyask:bootstrap", (event) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    return {
      runtime: options.runtime,
      sites: SITES,
      statuses: manager.getStatuses(),
      layout: manager.getLayout(),
      display: manager.getDisplayPreferences(),
      workspace: workspace.getState(),
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
    collection.beginRun(request.runId, request.sites);
    for (const site of request.sites) manager.markStatus({ site, phase: "sending" });
    let historyRecorded = false;
    const results = await coordinator.send(
      request,
      (site, command, signal) => manager.sendCommand(site, command, signal),
      request.images.length ? 90_000 : 44_000,
      (result) => {
        manager.markStatus(statusForResult(result.site, result));
        if (result.ok && !historyRecorded) {
          history.record(request.text);
          historyRecorded = true;
        }
      }
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
  ipcMain.handle("polyask:confirm-new-session", async (event, value: unknown) => {
    if (!trustedShell(event)) throw new Error("untrusted_sender");
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > SITE_KEYS.length) {
      throw new Error("invalid_site_count");
    }
    return confirmNewSession(window, Number(value), options.copy);
  });
  ipcMain.on("polyask:cancel", (event) => {
    if (trustedShell(event)) {
      coordinator.cancel();
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
    if (!trustedShell(event) || !["sites", "archive", "settings"].includes(String(value))) return;
    manager.setSurface(value as "sites" | "archive" | "settings");
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
  ipcMain.on("polyask:reload-site", (event, value: unknown) => {
    if (trustedShell(event) && typeof value === "string" && SITE_KEYS.includes(value as SiteKey)) {
      manager.reload(value as SiteKey);
    }
  });
  ipcMain.on("polyask:site-response", (event, envelope: SiteResponseEnvelope) => {
    if (manager.owns(event.sender)) manager.receiveResponse(event.sender, envelope);
  });

  return () => {
    disposeSyncIpc();
    for (const channel of HANDLERS) ipcMain.removeHandler(channel);
    for (const channel of LISTENERS) ipcMain.removeAllListeners(channel);
  };
}
