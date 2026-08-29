import { ipcMain } from "electron";

import { CLEAR_REMOTE_CONFIRMATION } from "../shared/sync";
import type { RuntimeInfo } from "../shared/runtime";
import type { SyncEngine } from "./sync-engine";

interface SyncIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}

interface SyncIpcOptions {
  readonly sync: SyncEngine;
  readonly runtime: RuntimeInfo;
  readonly trusted: (event: SyncIpcEvent) => boolean;
}

const CHANNELS = [
  "polyask:sync-connect",
  "polyask:sync-now",
  "polyask:sync-disconnect",
  "polyask:sync-clear",
  "polyask:sync-diagnostics"
] as const;

export function registerSyncIpc(options: SyncIpcOptions): () => void {
  ipcMain.handle(CHANNELS[0], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.connect();
  });
  ipcMain.handle(CHANNELS[1], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.syncNow();
  });
  ipcMain.handle(CHANNELS[2], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.disconnect();
  });
  ipcMain.handle(CHANNELS[3], (event, confirmation: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (confirmation !== CLEAR_REMOTE_CONFIRMATION) throw new Error("invalid_clear_confirmation");
    return options.sync.clearRemote();
  });
  ipcMain.handle(CHANNELS[4], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.diagnostics(options.runtime);
  });
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}
