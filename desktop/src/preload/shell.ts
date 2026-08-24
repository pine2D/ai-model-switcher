import { contextBridge, ipcRenderer } from "electron";

import type { SiteKey } from "../shared/contracts";
import type { DisplayPreferences } from "../shared/display";
import type {
  BootstrapState,
  BroadcastRequest,
  LayoutState,
  SiteRunResult,
  SiteStatus
} from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";

export interface PolyAskDesktopApi {
  bootstrap(): Promise<BootstrapState>;
  broadcast(request: BroadcastRequest): Promise<SiteRunResult[]>;
  cancel(): void;
  setLayout(mode: "overview" | "focus", focused: SiteKey): void;
  setDisplayPreferences(value: DisplayPreferences): Promise<DisplayPreferences>;
  setComposerExpanded(value: boolean): void;
  setDrawerOpen(value: boolean): void;
  setSelection(sites: readonly SiteKey[]): Promise<WorkspaceState>;
  setTier(value: BroadcastRequest["tier"]): Promise<WorkspaceState>;
  saveGroup(input: { readonly name: string; readonly sites: readonly SiteKey[] }): Promise<WorkspaceState>;
  deleteGroup(id: string): Promise<WorkspaceState>;
  newSession(sites: readonly SiteKey[]): Promise<void>;
  reloadSite(site: SiteKey): void;
  onStatus(listener: (status: SiteStatus) => void): () => void;
  onLayout(listener: (layout: LayoutState) => void): () => void;
  onDisplayPreferences(listener: (value: DisplayPreferences) => void): () => void;
  onFocusPrompt(listener: () => void): () => void;
  onWorkspaceState(listener: (value: WorkspaceState) => void): () => void;
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: PolyAskDesktopApi = Object.freeze({
  bootstrap: () => ipcRenderer.invoke("polyask:bootstrap"),
  broadcast: (request: BroadcastRequest) => ipcRenderer.invoke("polyask:broadcast", request),
  cancel: () => ipcRenderer.send("polyask:cancel"),
  setLayout: (mode: "overview" | "focus", focused: SiteKey) => ipcRenderer.send("polyask:set-layout", { mode, focused }),
  setDisplayPreferences: (value: DisplayPreferences) => ipcRenderer.invoke("polyask:set-display", value),
  setComposerExpanded: (value: boolean) => ipcRenderer.send("polyask:set-composer-expanded", value),
  setDrawerOpen: (value: boolean) => ipcRenderer.send("polyask:set-drawer-open", value),
  setSelection: (sites: readonly SiteKey[]) => ipcRenderer.invoke("polyask:set-selection", sites),
  setTier: (value: BroadcastRequest["tier"]) => ipcRenderer.invoke("polyask:set-tier", value),
  saveGroup: (input: { readonly name: string; readonly sites: readonly SiteKey[] }) =>
    ipcRenderer.invoke("polyask:save-group", input),
  deleteGroup: (id: string) => ipcRenderer.invoke("polyask:delete-group", id),
  newSession: (sites: readonly SiteKey[]) => ipcRenderer.invoke("polyask:new-session", sites),
  reloadSite: (site: SiteKey) => ipcRenderer.send("polyask:reload-site", site),
  onStatus: (listener: (status: SiteStatus) => void) => subscribe("polyask:site-status", listener),
  onLayout: (listener: (layout: LayoutState) => void) => subscribe("polyask:layout", listener),
  onDisplayPreferences: (listener: (value: DisplayPreferences) => void) =>
    subscribe("polyask:display-preferences", listener),
  onFocusPrompt: (listener: () => void) => subscribe("polyask:focus-prompt", listener),
  onWorkspaceState: (listener: (value: WorkspaceState) => void) =>
    subscribe("polyask:workspace-state", listener)
});

contextBridge.exposeInMainWorld("polyask", api);
