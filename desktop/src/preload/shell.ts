import { contextBridge, ipcRenderer } from "electron";

import type {
  ArchiveFilters,
  ArchiveInput,
  ArchivePatch,
  ArchiveRecord,
  ArchiveSearchResult
} from "../shared/archive";
import type { SiteKey } from "../shared/contracts";
import type { CommandId } from "../shared/commands";
import type { DisplayPreferences } from "../shared/display";
import type {
  BootstrapState,
  BroadcastRequest,
  CollectedAnswer,
  CollectionRequest,
  DesktopSurface,
  LayoutState,
  NewSessionSiteResult,
  SiteRunResult,
  SiteStatus
} from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";
import type { SyncStatus } from "../shared/sync";
import type {
  SynthesisCandidate,
  SynthesisSendRequest,
  SynthesisSendResponse
} from "../shared/synthesis";

export interface PolyAskDesktopApi {
  bootstrap(): Promise<BootstrapState>;
  broadcast(request: BroadcastRequest): Promise<SiteRunResult[]>;
  collectAnswers(request: CollectionRequest): Promise<CollectedAnswer[]>;
  searchArchives(filters: ArchiveFilters): Promise<ArchiveSearchResult>;
  getArchive(id: string): Promise<ArchiveRecord | null>;
  addArchive(input: ArchiveInput): Promise<ArchiveRecord>;
  updateArchive(id: string, patch: ArchivePatch): Promise<ArchiveRecord>;
  deleteArchive(id: string): Promise<void>;
  archiveMarkdown(id: string, locale: string): Promise<string>;
  sendSynthesis(request: SynthesisSendRequest): Promise<SynthesisSendResponse>;
  collectSynthesis(): Promise<SynthesisCandidate>;
  saveSynthesis(replaceExisting: boolean): Promise<ArchiveRecord>;
  openExternal(url: string): Promise<void>;
  cancel(): void;
  setLayout(mode: "overview" | "focus", focused: SiteKey): void;
  setPage(page: number): void;
  setDisplayPreferences(value: DisplayPreferences): Promise<DisplayPreferences>;
  setComposerExpanded(value: boolean): void;
  setDrawerOpen(value: boolean): void;
  setSurface(value: DesktopSurface): void;
  setSelection(sites: readonly SiteKey[]): Promise<WorkspaceState>;
  setTier(value: BroadcastRequest["tier"]): Promise<WorkspaceState>;
  saveGroup(input: { readonly name: string; readonly sites: readonly SiteKey[] }): Promise<WorkspaceState>;
  deleteGroup(id: string): Promise<WorkspaceState>;
  newSession(sites: readonly SiteKey[]): Promise<NewSessionSiteResult[]>;
  connectSync(): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>;
  disconnectSync(): Promise<SyncStatus>;
  clearRemoteSync(confirmation: string): Promise<SyncStatus>;
  reloadSite(site: SiteKey): void;
  onStatus(listener: (status: SiteStatus) => void): () => void;
  onLayout(listener: (layout: LayoutState) => void): () => void;
  onDisplayPreferences(listener: (value: DisplayPreferences) => void): () => void;
  onFocusPrompt(listener: () => void): () => void;
  onCommand(listener: (id: CommandId) => void): () => void;
  onWorkspaceState(listener: (value: WorkspaceState) => void): () => void;
  onSyncStatus(listener: (value: SyncStatus) => void): () => void;
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: PolyAskDesktopApi = Object.freeze({
  bootstrap: () => ipcRenderer.invoke("polyask:bootstrap"),
  broadcast: (request: BroadcastRequest) => ipcRenderer.invoke("polyask:broadcast", request),
  collectAnswers: (request: CollectionRequest) => ipcRenderer.invoke("polyask:collect", request),
  searchArchives: (filters: ArchiveFilters) => ipcRenderer.invoke("polyask:archive-search", filters),
  getArchive: (id: string) => ipcRenderer.invoke("polyask:archive-get", id),
  addArchive: (input: ArchiveInput) => ipcRenderer.invoke("polyask:archive-add", input),
  updateArchive: (id: string, patch: ArchivePatch) => ipcRenderer.invoke("polyask:archive-update", { id, patch }),
  deleteArchive: (id: string) => ipcRenderer.invoke("polyask:archive-delete", id),
  archiveMarkdown: (id: string, locale: string) => ipcRenderer.invoke("polyask:archive-markdown", { id, locale }),
  sendSynthesis: (request: SynthesisSendRequest) => ipcRenderer.invoke("polyask:synthesis-send", request),
  collectSynthesis: () => ipcRenderer.invoke("polyask:synthesis-collect"),
  saveSynthesis: (replaceExisting: boolean) => ipcRenderer.invoke("polyask:synthesis-save", replaceExisting),
  openExternal: (url: string) => ipcRenderer.invoke("polyask:open-external", url),
  cancel: () => ipcRenderer.send("polyask:cancel"),
  setLayout: (mode: "overview" | "focus", focused: SiteKey) => ipcRenderer.send("polyask:set-layout", { mode, focused }),
  setPage: (page: number) => ipcRenderer.send("polyask:set-page", page),
  setDisplayPreferences: (value: DisplayPreferences) => ipcRenderer.invoke("polyask:set-display", value),
  setComposerExpanded: (value: boolean) => ipcRenderer.send("polyask:set-composer-expanded", value),
  setDrawerOpen: (value: boolean) => ipcRenderer.send("polyask:set-drawer-open", value),
  setSurface: (value: DesktopSurface) => ipcRenderer.send("polyask:set-surface", value),
  setSelection: (sites: readonly SiteKey[]) => ipcRenderer.invoke("polyask:set-selection", sites),
  setTier: (value: BroadcastRequest["tier"]) => ipcRenderer.invoke("polyask:set-tier", value),
  saveGroup: (input: { readonly name: string; readonly sites: readonly SiteKey[] }) =>
    ipcRenderer.invoke("polyask:save-group", input),
  deleteGroup: (id: string) => ipcRenderer.invoke("polyask:delete-group", id),
  newSession: (sites: readonly SiteKey[]) => ipcRenderer.invoke("polyask:new-session", sites),
  connectSync: () => ipcRenderer.invoke("polyask:sync-connect"),
  syncNow: () => ipcRenderer.invoke("polyask:sync-now"),
  disconnectSync: () => ipcRenderer.invoke("polyask:sync-disconnect"),
  clearRemoteSync: (confirmation: string) => ipcRenderer.invoke("polyask:sync-clear", confirmation),
  reloadSite: (site: SiteKey) => ipcRenderer.send("polyask:reload-site", site),
  onStatus: (listener: (status: SiteStatus) => void) => subscribe("polyask:site-status", listener),
  onLayout: (listener: (layout: LayoutState) => void) => subscribe("polyask:layout", listener),
  onDisplayPreferences: (listener: (value: DisplayPreferences) => void) =>
    subscribe("polyask:display-preferences", listener),
  onFocusPrompt: (listener: () => void) => subscribe("polyask:focus-prompt", listener),
  onCommand: (listener: (id: CommandId) => void) => subscribe("polyask:command", listener),
  onWorkspaceState: (listener: (value: WorkspaceState) => void) =>
    subscribe("polyask:workspace-state", listener),
  onSyncStatus: (listener: (value: SyncStatus) => void) => subscribe("polyask:sync-status", listener)
});

contextBridge.exposeInMainWorld("polyask", api);
