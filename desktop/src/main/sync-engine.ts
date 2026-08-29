import type { StoredArchive } from "../shared/archive";
import type { RuntimeInfo } from "../shared/runtime";
import { createSyncDiagnosticSnapshot, type SyncDiagnosticSnapshot } from "../shared/sync-diagnostics";
import {
  retryDelay,
  utf8Preview,
  type OutboxOperation,
  type StateFragment,
  type StoredHistory,
  type SyncStatus
} from "../shared/sync";
import type { DriveChange, DriveFile } from "./drive-client";
import { SyncPull } from "./sync-pull";
import { SyncRepository } from "./sync-repository";

interface SyncEngineOptions {
  readonly repository: SyncRepository;
  readonly drive: SyncDrive;
  readonly auth: SyncAuth;
  readonly now?: () => number;
  readonly onStatus?: (status: SyncStatus) => void;
  readonly onWorkspaceChanged?: () => void;
}

export interface SyncDrive {
  listFiles(signal?: AbortSignal): Promise<DriveFile[]>;
  getStartToken(signal?: AbortSignal): Promise<string>;
  listChanges(pageToken: string, signal?: AbortSignal): Promise<{ changes: DriveChange[]; newStartPageToken: string | null }>;
  download(fileId: string, signal?: AbortSignal): Promise<unknown>;
  upsert(fileId: string | null, name: string, appProperties: Readonly<Record<string, string>>, body: unknown, signal?: AbortSignal): Promise<DriveFile>;
  clearAll(onProgress?: (count: number) => void | Promise<void>, signal?: AbortSignal): Promise<void>;
}

export interface SyncAuth {
  configured(): boolean;
  securePersistence(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

type QueuedOperation = OutboxOperation & { readonly revision: number };
type FailureStage = "oauth" | "drive" | "sync";
export class SyncEngine {
  private readonly now: () => number;
  private chain: Promise<unknown> = Promise.resolve();
  private localTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private disposeOutbox: (() => void) | null = null;
  private activeController: AbortController | null = null;

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.disposeOutbox) return;
    const config = this.options.repository.config();
    if (!config.connected && config.state === "syncing") {
      this.options.repository.saveConfig({ state: "idle", reason: undefined });
    }
    this.disposeOutbox = this.options.repository.onLocalChange(() => this.scheduleLocal());
    this.periodicTimer = setInterval(() => { void this.syncNow("periodic"); }, 15 * 60_000);
    this.periodicTimer.unref?.();
    if (this.options.repository.config().connected) void this.syncNow("startup");
    else this.publish();
  }

  dispose(): void {
    this.activeController?.abort();
    this.disposeOutbox?.();
    this.disposeOutbox = null;
    if (this.localTimer) clearTimeout(this.localTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.localTimer = this.periodicTimer = null;
  }

  status(): SyncStatus {
    const config = this.options.repository.config();
    return {
      state: config.state,
      connected: config.connected,
      pending: this.options.repository.pending(),
      errorCount: config.errorCount,
      ...(config.lastSuccessAt ? { lastSuccessAt: config.lastSuccessAt } : {}),
      ...(config.reason ? { reason: config.reason } : {}),
      ...(config.diagnostic ? { diagnostic: config.diagnostic } : {}),
      readOnly: config.readOnly,
      oauthConfigured: this.options.auth.configured(),
      secureTokenStorage: this.options.auth.securePersistence()
    };
  }

  diagnostics(runtime: RuntimeInfo): SyncDiagnosticSnapshot {
    return createSyncDiagnosticSnapshot(this.status(), runtime, this.now());
  }

  connect(): Promise<SyncStatus> {
    return this.serialize(async () => {
      if (!this.options.auth.configured()) return this.setStatus("blocked", { reason: "oauth_not_configured" });
      try {
        this.setStatus("syncing", { reason: "oauth" });
        await this.options.auth.connect();
        this.options.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
        return await this.run("drive_check", true);
      } catch (error) { return this.fail(error, "oauth"); }
    });
  }

  syncNow(reason = "manual"): Promise<SyncStatus> {
    if (!this.options.repository.config().connected) return Promise.resolve(this.publish());
    return this.serialize(() => this.run(reason));
  }

  disconnect(): Promise<SyncStatus> {
    this.activeController?.abort();
    return this.serialize(async () => {
      let failed = false;
      try { await this.options.auth.disconnect(); } catch { failed = true; }
      this.options.repository.clearDriveFiles();
      this.options.repository.saveConfig({ connected: false, pageToken: undefined, stateFileId: undefined, readOnly: false, reason: failed ? "revoke_failed" : undefined });
      return this.setStatus(failed ? "auth" : "idle");
    });
  }

  clearRemote(): Promise<SyncStatus> {
    this.activeController?.abort();
    return this.serialize(async () => {
      const config = this.options.repository.config();
      if (!config.connected) return this.setStatus("auth");
      this.options.repository.saveConfig({ clearRunning: true, clearProgress: config.clearProgress ?? 0 });
      try {
        await this.options.drive.clearAll((count) => {
          this.options.repository.saveConfig({ clearProgress: (config.clearProgress ?? 0) + count });
        });
        await this.options.auth.disconnect();
        this.options.repository.clearDriveFiles();
        this.options.repository.saveConfig({ connected: false, readOnly: false, pageToken: undefined, stateFileId: undefined, clearRunning: false, clearProgress: 0 });
        return this.setStatus("idle");
      } catch (error) {
        this.options.repository.saveConfig({ clearRunning: true });
        await this.fail(error);
        throw error;
      }
    });
  }

  private async run(reason: string, establishingConnection = false): Promise<SyncStatus> {
    const config = this.options.repository.config();
    if ((!config.connected && !establishingConnection) || config.clearRunning) return this.status();
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    this.setStatus("syncing", { reason });
    try {
      await new SyncPull(
        this.options.repository,
        this.options.drive,
        this.now,
        this.options.onWorkspaceChanged
      ).run(controller.signal);
      const waiting = await this.flush(controller.signal);
      const next = this.options.repository.config();
      return this.setStatus(next.readOnly ? "schema" : waiting ? "waiting" : "idle", {
        connected: true, lastSuccessAt: this.now(), reason: undefined
      });
    } catch (error) { return this.fail(error, establishingConnection ? "drive" : "sync"); }
    finally { if (this.activeController === controller) this.activeController = null; }
  }

  private async flush(signal: AbortSignal): Promise<boolean> {
    if (this.options.repository.config().readOnly) return false;
    let waiting = false;
    for (;;) {
      const ready = this.options.repository.ready(this.now());
      if (!ready.length) return waiting;
      ready.sort((left, right) => ({ state: 0, history: 1, archive: 2 }[left.kind] - ({ state: 0, history: 1, archive: 2 }[right.kind])));
      for (const operation of ready) {
        try { await this.upload(operation, signal); }
        catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== "rate_limited" && code !== "server_error") throw error;
          const attempt = operation.attempt + 1;
          this.options.repository.enqueue({ ...operation, attempt, nextAt: this.now() + ((error as { retryAfter?: number }).retryAfter ?? retryDelay(attempt)) });
          waiting = true;
        }
      }
    }
  }

  private async upload(operation: QueuedOperation, signal: AbortSignal): Promise<void> {
    const deviceId = this.options.repository.deviceId();
    let key = operation.key;
    let name: string;
    let properties: Record<string, string>;
    let body: StateFragment | StoredHistory | StoredArchive;
    if (operation.kind === "state") {
      key = `state:${deviceId}`;
      name = `state-${deviceId}.json`;
      properties = { app: "polyask", schema: "1", kind: "state", id: deviceId };
      body = this.options.repository.localStateFragment();
    } else if (operation.kind === "history" && operation.entityId) {
      const record = this.options.repository.history(operation.entityId);
      if (!record) { this.options.repository.complete(operation.key, operation.revision); return; }
      name = `history-${record.textHash}-${deviceId}.json`;
      properties = { app: "polyask", schema: "1", kind: "history", id: record.textHash, device: deviceId, deleted: "deletedAt" in record ? "1" : "0", preview: "deletedAt" in record ? "" : utf8Preview(record.text) };
      body = { ...record, deviceId };
    } else if (operation.kind === "archive" && operation.entityId) {
      const record = this.options.repository.archive(operation.entityId);
      if (!record) { this.options.repository.complete(operation.key, operation.revision); return; }
      name = `archive-${record.id}.json`;
      properties = { app: "polyask", schema: "1", kind: "archive", id: record.id, deleted: "deletedAt" in record ? "1" : "0", preview: "deletedAt" in record ? "" : utf8Preview(record.text) };
      body = record;
    } else { this.options.repository.complete(operation.key, operation.revision); return; }
    const existing = this.options.repository.findDriveFile(key);
    const saved = await this.options.drive.upsert(existing?.id ?? null, name, properties, body, signal);
    if (!saved.id) throw Object.assign(new Error("invalid_response"), { code: "invalid_response" });
    this.options.repository.putDriveFile(saved, key, this.now());
    this.options.repository.complete(operation.key, operation.revision);
  }

  private fail(error: unknown, stage: FailureStage = "sync"): SyncStatus {
    const code = (error as { code?: string; message?: string }).code ?? (error as { message?: string }).message;
    if (code === "oauth_timeout") return this.setStatus("offline", { reason: "oauth_callback_timeout" });
    if (code === "network_timeout") return this.setStatus("offline", {
      reason: stage === "oauth" ? "oauth_network_timeout" : stage === "drive" ? "drive_network_timeout" : "network_timeout"
    });
    if (code === "network_error" || error instanceof TypeError) return this.setStatus("offline", {
      reason: stage === "oauth" ? "oauth_network" : stage === "drive" ? "drive_network" : undefined
    });
    if (code === "token_store_failed") return this.setStatus("error", { reason: "token_storage" });
    if (code === "oauth_token_failed" || code === "oauth_invalid_response") return this.setStatus("error", { reason: "oauth_response" });
    if (code === "invalid_response" && stage === "drive") return this.setStatus("error", { reason: "drive_response" });
    if (code === "oauth_invalid_client" || code === "oauth_redirect_mismatch") {
      return this.setStatus("blocked", { reason: code });
    }
    if (code === "oauth_provider_error") {
      const diagnostic = oauthProviderDiagnostic(error);
      return diagnostic
        ? this.setStatus("auth", { reason: code, diagnostic })
        : this.setStatus("auth", { reason: "oauth_rejected" });
    }
    if (code === "oauth_invalid_grant") return this.setStatus("auth", { reason: code });
    if (code === "refresh_token_missing") return this.setStatus("auth", { reason: "oauth_refresh_missing" });
    if (code === "unauthorized" && stage === "drive") return this.setStatus("auth", { reason: "drive_unauthorized" });
    if (code === "unauthorized" || code === "auth_failed") {
      return this.setStatus("auth", { reason: stage === "oauth" || stage === "drive" ? "oauth_rejected" : undefined });
    }
    if (code === "oauth_not_configured") return this.setStatus("blocked", { reason: code });
    if (code === "forbidden") {
      const reason = String((error as { reason?: string }).reason ?? "").toLowerCase();
      return this.setStatus("blocked", { reason: /notconfigured|disabled/.test(reason) ? "drive_disabled" : /quota|limit|rate/.test(reason) ? "quota" : "policy" });
    }
    if (code === "rate_limited" || code === "server_error") return this.setStatus("waiting", { reason: undefined });
    return this.setStatus("error", { reason: undefined });
  }

  private setStatus(state: SyncStatus["state"], patch: Record<string, unknown> = {}): SyncStatus {
    this.options.repository.saveConfig({ diagnostic: undefined, ...patch, state });
    return this.publish();
  }

  private publish(): SyncStatus {
    const status = this.status();
    this.options.onStatus?.(status);
    return status;
  }

  private scheduleLocal(): void {
    if (!this.options.repository.config().connected) return;
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => { this.localTimer = null; void this.syncNow("local-change"); }, 3_000);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

function oauthProviderDiagnostic(error: unknown): string | null {
  const failure = error as { providerCode?: unknown; providerDetail?: unknown };
  if (typeof failure.providerCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(failure.providerCode)) return null;
  const detail = typeof failure.providerDetail === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(failure.providerDetail)
    ? ` / ${failure.providerDetail}` : "";
  return `${failure.providerCode}${detail}`;
}
