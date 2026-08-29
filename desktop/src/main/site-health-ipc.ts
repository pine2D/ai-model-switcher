import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { ViewManager } from "./view-manager";

interface SiteHealthIpcOptions {
  readonly manager: ViewManager;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
}

function siteList(value: unknown): SiteKey[] | null {
  if (!Array.isArray(value) || value.length > SITE_KEYS.length) return null;
  if (!value.every((site) => typeof site === "string" && SITE_KEYS.includes(site as SiteKey))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as SiteKey[];
}

export function registerSiteHealthIpc(options: SiteHealthIpcOptions): () => void {
  ipcMain.handle("polyask:site-health", (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    const sites = siteList(value);
    if (!sites) throw new Error("invalid_sites");
    return options.manager.checkHealth(sites);
  });
  ipcMain.handle("polyask:reload-site", (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (typeof value !== "string" || !SITE_KEYS.includes(value as SiteKey)) throw new Error("invalid_site");
    return options.manager.reload(value as SiteKey);
  });
  return () => {
    ipcMain.removeHandler("polyask:site-health");
    ipcMain.removeHandler("polyask:reload-site");
  };
}
