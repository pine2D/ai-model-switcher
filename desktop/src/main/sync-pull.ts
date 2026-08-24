import {
  mergeStateFragments,
  SYNC_SCHEMA,
  type StateFragment
} from "../shared/sync";
import type { DriveChange, DriveFile } from "./drive-client";
import { SyncRepository } from "./sync-repository";

export interface SyncPullDrive {
  listFiles(signal?: AbortSignal): Promise<DriveFile[]>;
  getStartToken(signal?: AbortSignal): Promise<string>;
  listChanges(pageToken: string, signal?: AbortSignal): Promise<{ changes: DriveChange[]; newStartPageToken: string | null }>;
  download(fileId: string, signal?: AbortSignal): Promise<unknown>;
}

type StateMap = Record<string, StateFragment>;

export class SyncPull {
  constructor(
    private readonly repository: SyncRepository,
    private readonly drive: SyncPullDrive,
    private readonly now: () => number,
    private readonly onWorkspaceChanged?: () => void
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const token = this.repository.config().pageToken;
    try {
      if (token) await this.incremental(token, signal);
      else await this.fullScan(signal);
    } catch (error) {
      const detail = error as { code?: string; status?: number };
      if (detail.code !== "page_token_expired" && detail.status !== 410) throw error;
      await this.fullScan(signal);
    }
  }

  private async fullScan(signal: AbortSignal): Promise<void> {
    const startToken = await this.drive.getStartToken(signal);
    const states: StateMap = {};
    const future = new Set<string>();
    const seen = new Set<string>();
    for (const file of await this.drive.listFiles(signal)) {
      seen.add(file.id);
      await this.readFile(file, states, future, this.now(), signal);
    }
    const changes = await this.drive.listChanges(startToken, signal);
    for (const change of changes.changes) await this.readChange(change, states, future, seen, signal);
    for (const indexed of this.repository.driveFiles()) {
      if (!seen.has(indexed.id)) this.repository.deleteDriveFile(indexed.id);
    }
    this.applyStates(states, future);
    this.repository.saveConfig({ pageToken: changes.newStartPageToken ?? startToken });
  }

  private async incremental(token: string, signal: AbortSignal): Promise<void> {
    const states = this.repository.remoteStates();
    const future = new Set<string>(this.repository.config().futureFileIds ?? []);
    const changes = await this.drive.listChanges(token, signal);
    for (const change of changes.changes) await this.readChange(change, states, future, null, signal);
    this.applyStates(states, future);
    this.repository.saveConfig({ pageToken: changes.newStartPageToken ?? token });
  }

  private async readChange(
    change: DriveChange,
    states: StateMap,
    future: Set<string>,
    seen: Set<string> | null,
    signal: AbortSignal
  ): Promise<void> {
    const id = change.file?.id ?? change.fileId;
    if (!id) return;
    if (change.removed || !change.file) {
      const indexed = this.repository.driveFile(id);
      if (indexed?.logicalKey.startsWith("state:")) delete states[id];
      this.repository.deleteDriveFile(id);
      future.delete(id);
      seen?.delete(id);
      return;
    }
    seen?.add(id);
    await this.readFile(change.file, states, future, this.now(), signal);
  }

  private async readFile(
    file: DriveFile,
    states: StateMap,
    future: Set<string>,
    seenAt: number,
    signal: AbortSignal
  ): Promise<void> {
    const props = file.appProperties ?? {};
    if (props.app !== "polyask") return;
    if (Number(props.schema) > SYNC_SCHEMA) {
      future.add(file.id);
      this.repository.deleteDriveFile(file.id);
      return;
    }
    const key = logicalKey(file);
    if (!key || Number(props.schema) !== SYNC_SCHEMA) {
      this.noteCorrupt(file.id);
      return;
    }
    let body: unknown;
    try {
      body = await this.drive.download(file.id, signal);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "not_found") {
        this.repository.deleteDriveFile(file.id);
        return;
      }
      if (code === "invalid_response") {
        this.noteCorrupt(file.id);
        return;
      }
      throw error;
    }
    if (body && typeof body === "object" && Number((body as { schema?: unknown }).schema) > SYNC_SCHEMA) {
      future.add(file.id);
      this.repository.deleteDriveFile(file.id);
      return;
    }
    let valid = false;
    if (props.kind === "state" && body && typeof body === "object" && (body as StateFragment).deviceId === props.id) {
      valid = !mergeStateFragments([body]).corrupt;
      if (valid) states[file.id] = body as StateFragment;
    } else if (props.kind === "history" && props.device && body && typeof body === "object") {
      const record = body as { id?: unknown; deviceId?: unknown };
      valid = record.id === props.id && record.deviceId === props.device && this.repository.importHistory(body);
    } else if (props.kind === "archive" && body && typeof body === "object") {
      valid = (body as { id?: unknown }).id === props.id && this.repository.importArchive(body);
    }
    if (!valid) {
      this.noteCorrupt(file.id);
      return;
    }
    this.repository.putDriveFile(file, key, seenAt);
  }

  private applyStates(states: StateMap, future: Set<string>): void {
    const merged = this.repository.applyStateFragments(states);
    const readOnly = future.size > 0 || merged.readOnly;
    this.repository.saveConfig({
      readOnly,
      errorCount: this.repository.config().errorCount + merged.corrupt,
      futureFileIds: [...future]
    });
    if (merged.changed) this.onWorkspaceChanged?.();
  }

  private noteCorrupt(fileId: string): void {
    this.repository.deleteDriveFile(fileId);
    const config = this.repository.config();
    this.repository.saveConfig({ errorCount: config.errorCount + 1 });
  }
}

function logicalKey(file: DriveFile): string | null {
  const props = file.appProperties ?? {};
  if (!props.id) return null;
  if (props.kind === "state") return `state:${props.id}`;
  if (props.kind === "history" && props.device) return `history:${props.id}:${props.device}`;
  if (props.kind === "archive") return `archive:${props.id}`;
  return null;
}
