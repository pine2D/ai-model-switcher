import { contextBridge, ipcRenderer } from "electron";

import { ipcErrorCode } from "../shared/ipc-error";

import type {
  ArchiveFilters,
  ArchiveInput,
  ArchivePatch,
  ArchiveRecord,
  ArchiveSearchResult
} from "../shared/archive";
import type { SiteKey } from "../shared/contracts";
import type { CommandId } from "../shared/commands";
import type { PromptLibraryState, PromptTemplate } from "../shared/prompt-library";
import type { DisplayPreferences } from "../shared/display";
import type {
  BootstrapState,
  BroadcastRequest,
  CollectedAnswer,
  CollectionRequest,
  DesktopSurface,
  LayoutState,
  MenuShortcut,
  NewSessionSiteResult,
  SiteHistoryState,
  SiteRunResult,
  SiteStatus
} from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";
import type { SyncStatus } from "../shared/sync";
import type { SyncDiagnosticSnapshot } from "../shared/sync-diagnostics";
import type { SiteHealth } from "../shared/site-health";
import type {
  SynthesisCandidate,
  SynthesisSendRequest,
  SynthesisSendResponse
} from "../shared/synthesis";

export interface PolyAskDesktopApi {
  bootstrap(): Promise<BootstrapState>;
  menuShortcuts(): Promise<MenuShortcut[]>;
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
  stepPage(offset: -1 | 1): void;
  stepSite(offset: -1 | 1): void;
  stepHistory(offset: -1 | 1, site?: SiteKey): void;
  siteHistoryState(): Promise<Record<string, SiteHistoryState>>;
  setDisplayPreferences(value: DisplayPreferences): Promise<DisplayPreferences>;
  setComposerExpanded(value: boolean): void;
  setDrawerOpen(value: boolean): void;
  setSurface(value: DesktopSurface): void;
  setSelection(sites: readonly SiteKey[]): Promise<WorkspaceState>;
  setTier(value: BroadcastRequest["tier"]): Promise<WorkspaceState>;
  saveGroup(input: { readonly name: string; readonly sites: readonly SiteKey[] }): Promise<WorkspaceState>;
  deleteGroup(id: string): Promise<WorkspaceState>;
  newSession(sites: readonly SiteKey[]): Promise<NewSessionSiteResult[]>;
  showGroupMenu(): Promise<string | null>;
  showCommandMenu(commands: readonly CommandId[]): Promise<CommandId | null>;
  setCompletionNotifications(enabled: boolean): void;
  savePromptTemplate(input: { readonly name: string; readonly text: string }): Promise<PromptLibraryState>;
  deletePromptTemplate(id: string): Promise<PromptLibraryState>;
  connectSync(): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>;
  disconnectSync(): Promise<SyncStatus>;
  clearRemoteSync(confirmation: string): Promise<SyncStatus>;
  syncDiagnostics(): Promise<SyncDiagnosticSnapshot>;
  checkSiteHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]>;
  reloadSite(site: SiteKey, ignoreCache?: boolean): Promise<boolean>;
  clearSiteData(site: SiteKey): Promise<boolean>;
  clearHistory(): Promise<number>;
  clearArchives(): Promise<number>;
  resetLocalData(): Promise<SyncStatus>;
  onStatus(listener: (status: SiteStatus) => void): () => void;
  onLayout(listener: (layout: LayoutState) => void): () => void;
  onDisplayPreferences(listener: (value: DisplayPreferences) => void): () => void;
  onCommand(listener: (id: CommandId) => void): () => void;
  onWorkspaceState(listener: (value: WorkspaceState) => void): () => void;
  onPromptLibrary(listener: (value: PromptLibraryState) => void): () => void;
  onSyncStatus(listener: (value: SyncStatus) => void): () => void;
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// 全部 invoke 走这一层：把 Electron 的远程调用前缀剥掉，渲染层拿到的 error.message 就是主进程抛的裸码。
const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => { throw new Error(ipcErrorCode(error)); });

const api: PolyAskDesktopApi = Object.freeze({
  bootstrap: () => invoke("polyask:bootstrap"),
  menuShortcuts: () => invoke("polyask:menu-shortcuts"),
  broadcast: (request: BroadcastRequest) => invoke("polyask:broadcast", request),
  collectAnswers: (request: CollectionRequest) => invoke("polyask:collect", request),
  searchArchives: (filters: ArchiveFilters) => invoke("polyask:archive-search", filters),
  getArchive: (id: string) => invoke("polyask:archive-get", id),
  addArchive: (input: ArchiveInput) => invoke("polyask:archive-add", input),
  updateArchive: (id: string, patch: ArchivePatch) => invoke("polyask:archive-update", { id, patch }),
  deleteArchive: (id: string) => invoke("polyask:archive-delete", id),
  archiveMarkdown: (id: string, locale: string) => invoke("polyask:archive-markdown", { id, locale }),
  sendSynthesis: (request: SynthesisSendRequest) => invoke("polyask:synthesis-send", request),
  collectSynthesis: () => invoke("polyask:synthesis-collect"),
  saveSynthesis: (replaceExisting: boolean) => invoke("polyask:synthesis-save", replaceExisting),
  openExternal: (url: string) => invoke("polyask:open-external", url),
  cancel: () => ipcRenderer.send("polyask:cancel"),
  setLayout: (mode: "overview" | "focus", focused: SiteKey) => ipcRenderer.send("polyask:set-layout", { mode, focused }),
  setPage: (page: number) => ipcRenderer.send("polyask:set-page", page),
  stepPage: (offset: -1 | 1) => ipcRenderer.send("polyask:step-page", offset),
  stepSite: (offset: -1 | 1) => ipcRenderer.send("polyask:step-site", offset),
  stepHistory: (offset: -1 | 1, site?: SiteKey) => ipcRenderer.send("polyask:step-history", { offset, site }),
  siteHistoryState: () => invoke("polyask:site-history-state"),
  setDisplayPreferences: (value: DisplayPreferences) => invoke("polyask:set-display", value),
  setComposerExpanded: (value: boolean) => ipcRenderer.send("polyask:set-composer-expanded", value),
  setDrawerOpen: (value: boolean) => ipcRenderer.send("polyask:set-drawer-open", value),
  setSurface: (value: DesktopSurface) => ipcRenderer.send("polyask:set-surface", value),
  setSelection: (sites: readonly SiteKey[]) => invoke("polyask:set-selection", sites),
  setTier: (value: BroadcastRequest["tier"]) => invoke("polyask:set-tier", value),
  saveGroup: (input: { readonly name: string; readonly sites: readonly SiteKey[] }) =>
    invoke("polyask:save-group", input),
  deleteGroup: (id: string) => invoke("polyask:delete-group", id),
  newSession: (sites: readonly SiteKey[]) => invoke("polyask:new-session", sites),
  showGroupMenu: () => invoke("polyask:show-group-menu"),
  showCommandMenu: (commands: readonly CommandId[]) => invoke("polyask:show-command-menu", commands),
  setCompletionNotifications: (enabled: boolean) =>
    ipcRenderer.send("polyask:set-completion-notifications", enabled),
  savePromptTemplate: (input: Pick<PromptTemplate, "name" | "text">) =>
    invoke("polyask:prompt-template-save", input),
  deletePromptTemplate: (id: string) => invoke("polyask:prompt-template-delete", id),
  connectSync: () => invoke("polyask:sync-connect"),
  syncNow: () => invoke("polyask:sync-now"),
  disconnectSync: () => invoke("polyask:sync-disconnect"),
  clearRemoteSync: (confirmation: string) => invoke("polyask:sync-clear", confirmation),
  syncDiagnostics: () => invoke("polyask:sync-diagnostics"),
  checkSiteHealth: (sites: readonly SiteKey[]) => invoke("polyask:site-health", sites),
  reloadSite: (site: SiteKey, ignoreCache?: boolean) => invoke("polyask:reload-site", site, ignoreCache),
  clearSiteData: (site: SiteKey) => invoke("polyask:clear-site-data", site),
  clearHistory: () => invoke("polyask:clear-history"),
  clearArchives: () => invoke("polyask:clear-archives"),
  resetLocalData: () => invoke("polyask:reset-local"),
  onStatus: (listener: (status: SiteStatus) => void) => subscribe("polyask:site-status", listener),
  onLayout: (listener: (layout: LayoutState) => void) => subscribe("polyask:layout", listener),
  onDisplayPreferences: (listener: (value: DisplayPreferences) => void) =>
    subscribe("polyask:display-preferences", listener),
  onCommand: (listener: (id: CommandId) => void) => subscribe("polyask:command", listener),
  onWorkspaceState: (listener: (value: WorkspaceState) => void) =>
    subscribe("polyask:workspace-state", listener),
  onPromptLibrary: (listener: (value: PromptLibraryState) => void) =>
    subscribe("polyask:prompt-library", listener),
  onSyncStatus: (listener: (value: SyncStatus) => void) => subscribe("polyask:sync-status", listener)
});

contextBridge.exposeInMainWorld("polyask", api);
