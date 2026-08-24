import { contextBridge, ipcRenderer } from "electron";

import type { SiteKey } from "../shared/contracts";
import type {
  BootstrapState,
  BroadcastRequest,
  LayoutState,
  SiteRunResult,
  SiteStatus
} from "../shared/protocol";

export interface PolyAskDesktopApi {
  bootstrap(): Promise<BootstrapState>;
  broadcast(request: BroadcastRequest): Promise<SiteRunResult[]>;
  cancel(): void;
  setLayout(mode: "overview" | "focus", focused: SiteKey): void;
  reloadSite(site: SiteKey): void;
  onStatus(listener: (status: SiteStatus) => void): () => void;
  onLayout(listener: (layout: LayoutState) => void): () => void;
  onFocusPrompt(listener: () => void): () => void;
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
  reloadSite: (site: SiteKey) => ipcRenderer.send("polyask:reload-site", site),
  onStatus: (listener: (status: SiteStatus) => void) => subscribe("polyask:site-status", listener),
  onLayout: (listener: (layout: LayoutState) => void) => subscribe("polyask:layout", listener),
  onFocusPrompt: (listener: () => void) => subscribe("polyask:focus-prompt", listener)
});

contextBridge.exposeInMainWorld("polyask", api);
