import { join } from "node:path";

import { app, safeStorage, shell as electronShell } from "electron";

import type { SyncStatus } from "../shared/sync";
import type { WorkspaceState } from "../shared/workspace";
import type { DesktopDatabase } from "./database";
import { DriveClient } from "./drive-client";
import { loadOAuthClientCredentials } from "./oauth-pkce";
import { OAuthSession } from "./oauth-session";
import { SyncEngine } from "./sync-engine";
import { SyncRepository } from "./sync-repository";
import { safeEncryptionAvailability, TokenStore } from "./token-store";

interface SyncRuntimeOptions {
  readonly database: DesktopDatabase;
  readonly workspace: () => WorkspaceState;
  readonly onStatus: (status: SyncStatus) => void;
  readonly onWorkspace: (workspace: WorkspaceState) => void;
}

export async function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncEngine> {
  const credentials = await loadOAuthClientCredentials({
    environment: app.isPackaged ? undefined : process.env,
    resourcePath: app.isPackaged
      ? join(process.resourcesPath, "oauth.json")
      : join(app.getAppPath(), "resources", "oauth.json")
  });
  const encryptionAvailable = credentials
    ? await safeEncryptionAvailability(() => safeStorage.isAsyncEncryptionAvailable())
    : false;
  const tokenStore = new TokenStore(join(app.getPath("userData"), "oauth-token.bin"), {
    backend: () => encryptionAvailable
      ? process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os_crypt"
      : "unavailable",
    available: async () => encryptionAvailable,
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  const oauth = new OAuthSession({
    credentials,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    tokenStore,
    openExternal: async (url) => {
      const destination = new URL(url);
      if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com") {
        throw new Error("invalid_oauth_url");
      }
      await electronShell.openExternal(destination.href);
    }
  });
  return new SyncEngine({
    repository: new SyncRepository(options.database),
    drive: new DriveClient(oauth),
    auth: oauth,
    onStatus: options.onStatus,
    onWorkspaceChanged: () => options.onWorkspace(options.workspace())
  });
}
