import type { StoredArchive } from "../shared/archive";
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
      readOnly: config.readOnly,
      oauthConfigured: this.options.auth.configured(),
      secureTokenStorage: this.options.auth.securePersistence()
    };
  }

  connect(): Promise<SyncStatus> {
    return this.serialize(async () => {
      if (!this.options.auth.configured()) return this.setStatus("blocked", { reason: "oauth_not_configured" });
      try {
        await this.options.auth.connect();
        this.options.repository.saveConfig({ connected: true, reason: undefined });
        this.options.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
        return await this.run("connect");
      } catch (error) { return this.fail(error); }
    });
  }

  syncNow(reason = "manual"): Promise<SyncStatus> {
    if (!this.options.repository.config().connected) return this.connect();
    return this.serialize(() => this.run(reason));
  }

  disconnect(): Promise<SyncStatus> {
    return this.serialize(async () => {
      this.activeController?.abort();
      let failed = false;
      try { await this.options.auth.disconnect(); } catch { failed = true; }
      this.options.repository.clearDriveFiles();
      this.options.repository.saveConfig({ connected: false, pageToken: undefined, stateFileId: undefined, readOnly: false, reason: failed ? "revoke_failed" : undefined });
      return this.setStatus(failed ? "auth" : "idle");
    });
  }

  clearRemote(): Promise<SyncStatus> {
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

  private async run(reason: string): Promise<SyncStatus> {
    const config = this.options.repository.config();
    if (!config.connected || config.clearRunning) return this.status();
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
        lastSuccessAt: this.now(), reason: undefined
      });
    } catch (error) { return this.fail(error); }
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

  private fail(error: unknown): SyncStatus {
    const code = (error as { code?: string; message?: string }).code ?? (error as { message?: string }).message;
    if (code === "network_error" || error instanceof TypeError) return this.setStatus("offline");
    if (code === "unauthorized" || code === "auth_failed" || code === "refresh_token_missing") return this.setStatus("auth");
    if (code === "oauth_not_configured") return this.setStatus("blocked", { reason: code });
    if (code === "forbidden") {
      const reason = String((error as { reason?: string }).reason ?? "").toLowerCase();
      return this.setStatus("blocked", { reason: /notconfigured|disabled/.test(reason) ? "drive_disabled" : /quota|limit|rate/.test(reason) ? "quota" : "policy" });
    }
    if (code === "rate_limited" || code === "server_error") return this.setStatus("waiting");
    return this.setStatus("error");
  }

  private setStatus(state: SyncStatus["state"], patch: Record<string, unknown> = {}): SyncStatus {
    this.options.repository.saveConfig({ ...patch, state });
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
