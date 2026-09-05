import { ipcMain } from "electron";

import type { DataAdminService } from "./data-admin-service";

interface DataAdminIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}

interface DataAdminIpcOptions {
  readonly admin: DataAdminService;
  readonly trusted: (event: DataAdminIpcEvent) => boolean;
  readonly afterHistoryChange: () => void;
  readonly afterReset: () => void;
}

const CHANNELS = [
  "polyask:clear-history",
  "polyask:clear-archives",
  "polyask:reset-local"
] as const;

export function registerDataAdminIpc(options: DataAdminIpcOptions): () => void {
  ipcMain.handle(CHANNELS[0], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    const count = options.admin.clearHistory();
    options.afterHistoryChange();
    return count;
  });
  ipcMain.handle(CHANNELS[1], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.admin.clearArchives();
  });
  ipcMain.handle(CHANNELS[2], async (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    const status = await options.admin.resetLocal();
    options.afterReset();
    return status;
  });
  // macOS 关窗后 activate 会重建窗口并重新注册，漏注销一条就 ipcMain.handle 重复注册直接抛错。
  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
