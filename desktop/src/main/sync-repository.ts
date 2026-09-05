import { createHash } from "node:crypto";

import {
  isArchiveRecord,
  type ArchiveTombstone,
  type StoredArchive
} from "../shared/archive";
import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { Tier } from "../shared/protocol";
import {
  isStoredPromptTemplate,
  promptTemplatesToStateFragment,
  type StoredPromptTemplate
} from "../shared/prompt-library";
import {
  compareSyncVersion,
  isHistoryRecord,
  mergeHistoryRecords,
  mergeStateFragments,
  SYNC_SCHEMA,
  validSyncTime,
  type OutboxOperation,
  type StateFragment,
  type StoredHistory,
  type SyncStatus,
  type VersionedSyncValue
} from "../shared/sync";
import type { WorkspaceGroup } from "../shared/workspace";
import type { DesktopDatabase } from "./database";
import type { DriveFile } from "./drive-client";
import { SITES } from "./sites";

export interface SyncConfig {
  readonly connected: boolean;
  readonly readOnly: boolean;
  readonly pageToken?: string;
  readonly stateFileId?: string;
  readonly lastSuccessAt?: number;
  readonly errorCount: number;
  readonly state: SyncStatus["state"];
  readonly reason?: string;
  readonly diagnostic?: string;
  readonly clearRunning?: boolean;
  readonly clearProgress?: number;
  readonly tokenStored?: boolean;
  /** 触发只读锁的远端文件及其 schema；任一 schema > SYNC_SCHEMA 即锁定，本机追平后自动解锁。 */
  readonly futureFiles?: Readonly<Record<string, number>>;
  /** 旧版只存 fileId 列表、不知道 schema；读到时按 SYNC_SCHEMA+1 兜底，写回时改存 futureFiles。 */
  readonly futureFileIds?: readonly string[];
}

interface StoredWorkspace {
  readonly selectedSites: readonly SiteKey[];
  readonly tier: Tier;
  readonly updatedAt: number;
  readonly deviceId: string;
}

const DEFAULT_CONFIG: SyncConfig = { connected: false, readOnly: false, errorCount: 0, state: "idle" };
const hostFor = (key: SiteKey) => SITES.find((site) => site.key === key)?.host;
const keyFor = (host: string) => SITES.find((site) => site.host === host)?.key;

export class SyncRepository {
  constructor(private readonly database: DesktopDatabase) {}

  deviceId(): string {
    const id = this.database.meta.get<unknown>("deviceId");
    if (typeof id !== "string" || !id) throw new Error("device_id_missing");
    return id;
  }

  config(): SyncConfig {
    return { ...DEFAULT_CONFIG, ...this.database.meta.get<Partial<SyncConfig>>("syncConfig") };
  }

  saveConfig(patch: Partial<SyncConfig>): SyncConfig {
    return this.database.meta.put("syncConfig", { ...this.config(), ...patch });
  }

  localStateFragment(): StateFragment {
    const deviceId = this.deviceId();
    const workspace = this.database.state.get<StoredWorkspace>("workspace") ?? {
      selectedSites: [...SITE_KEYS], tier: null, updatedAt: 0, deviceId
    };
    const remoteStates = this.remoteStates();
    const previous = Object.values(remoteStates).find((state) => state.deviceId === deviceId);
    const selected = Object.fromEntries(workspace.selectedSites.flatMap((key) => {
      const host = hostFor(key);
      return host ? [[host, true]] : [];
    }));
    const settings = {
      ...(previous?.settings ?? {}),
      "amsConsole.selected": {
        value: { ...unknownSelection(remoteStates), ...selected },
        updatedAt: workspace.updatedAt,
        deviceId
      },
      "amsConsole.tier": { value: workspace.tier ?? "", updatedAt: workspace.updatedAt, deviceId }
    };
    // Groups whose cloud copy names a host this build cannot resolve are consumed
    // read-only: re-projecting them would upload a truncated host list that wins
    // the tie against the complete one (same updatedAt, same deviceId).
    const foreign = groupsWithUnknownHosts(remoteStates);
    const groups = Object.fromEntries(this.database.state.entries<WorkspaceGroup>("group:")
      .filter(({ value }) => "deletedAt" in value || !foreign.has(value.id))
      .map(({ value }) => [
        value.id,
        "deletedAt" in value
          ? value
          : { id: value.id, name: value.name, hosts: value.sites.flatMap((key) => hostFor(key) ?? []), updatedAt: value.updatedAt, deviceId: value.deviceId }
      ]));
    const localTemplates = this.database.state.list<unknown>("template:").filter(isStoredPromptTemplate);
    const templates = mergeStateFragments([
      previous ?? { schema: SYNC_SCHEMA, deviceId, settings: {}, templates: {}, groups: {} },
      {
        schema: SYNC_SCHEMA,
        deviceId,
        settings: {},
        templates: promptTemplatesToStateFragment(localTemplates, deviceId),
        groups: {}
      }
    ]).materialized.templates;
    return { schema: SYNC_SCHEMA, deviceId, settings, templates, groups };
  }

  applyStateFragments(remoteStates: Readonly<Record<string, StateFragment>>): { readonly changed: boolean; readonly readOnly: boolean; readonly corrupt: number } {
    this.database.meta.put("remoteStates", remoteStates);
    const merged = mergeStateFragments([...Object.values(remoteStates), this.localStateFragment()]);
    this.database.meta.put("materializedState", merged.materialized);
    const selectedSetting = merged.settings["amsConsole.selected"];
    const tierSetting = merged.settings["amsConsole.tier"];
    const current = this.database.state.get<StoredWorkspace>("workspace");
    const selectedSites = selectionFromSetting(selectedSetting) ?? current?.selectedSites ?? [...SITE_KEYS];
    const tier = tierSetting?.value === "fast" || tierSetting?.value === "think" ? tierSetting.value : null;
    const updatedAt = Math.max(selectedSetting?.updatedAt ?? 0, tierSetting?.updatedAt ?? 0, current?.updatedAt ?? 0);
    const deviceId = compareSyncVersion(selectedSetting ?? {}, tierSetting ?? {}) >= 0
      ? selectedSetting?.deviceId : tierSetting?.deviceId;
    let changed = false;
    const nextWorkspace = { selectedSites, tier, updatedAt, deviceId: deviceId || current?.deviceId || this.deviceId() };
    if (JSON.stringify(nextWorkspace) !== JSON.stringify(current)) {
      this.database.state.put("workspace", nextWorkspace, updatedAt, false);
      changed = true;
    }
    for (const group of Object.values(merged.materialized.groups)) {
      const next = syncGroup(group);
      if (!next) continue;
      const currentGroup = this.database.state.get<WorkspaceGroup>(`group:${next.id}`);
      if (JSON.stringify(next) === JSON.stringify(currentGroup)) continue;
      this.database.state.put(`group:${next.id}`, next, next.updatedAt, false);
      changed = true;
    }
    for (const template of Object.values(merged.materialized.templates)) {
      if (!isStoredPromptTemplate(template)) continue;
      const currentTemplate = this.database.state.get<StoredPromptTemplate>(`template:${template.id}`);
      if (JSON.stringify(template) === JSON.stringify(currentTemplate)) continue;
      this.database.state.put(`template:${template.id}`, template, template.updatedAt, false);
      changed = true;
    }
    return { changed, readOnly: merged.readOnly, corrupt: merged.corrupt };
  }

  remoteStates(): Record<string, StateFragment> {
    return this.database.meta.get<Record<string, StateFragment>>("remoteStates") ?? {};
  }

  importHistory(value: unknown): boolean {
    if (!isHistoryRecord(value)) return false;
    if (!("deletedAt" in value) && createHash("sha256").update(value.text).digest("hex") !== value.textHash) return false;
    const current = this.database.history.get(value.id);
    const merged = mergeHistoryRecords([current, value])[0];
    if (!merged || JSON.stringify(merged) === JSON.stringify(current)) return true;
    this.database.history.put(merged, false);
    return true;
  }

  importArchive(value: unknown): boolean {
    if (!validArchive(value)) return false;
    const current = this.database.archives.get(value.id);
    if (current && compareEntity(value, current) <= 0) return true;
    this.database.archives.put(value, false);
    return true;
  }

  history(id: string): StoredHistory | null { return this.database.history.get(id); }
  archive(id: string): StoredArchive | null { return this.database.archives.get(id); }
  enqueue(operation: OutboxOperation) { return this.database.outbox.enqueue(operation); }
  ready(now: number) { return this.database.outbox.ready(now); }
  complete(key: string, revision: number): boolean { return this.database.outbox.complete(key, revision); }
  pending(): number { return this.database.outbox.count(); }
  onLocalChange(listener: () => void): () => void { return this.database.outbox.onChange(listener); }

  driveFile(fileId: string) { return this.database.driveFiles.get(fileId); }
  findDriveFile(logicalKey: string) { return this.database.driveFiles.find(logicalKey); }
  driveFiles() { return this.database.driveFiles.list(); }
  putDriveFile(file: DriveFile, logicalKey: string, seenAt: number): void {
    this.database.driveFiles.put({ ...file, logicalKey, seenAt });
  }
  deleteDriveFile(fileId: string): void { this.database.driveFiles.delete(fileId); }
  clearDriveFiles(): void { this.database.driveFiles.clear(); }
}

function hostMap(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Site toggles for hosts this build does not know, carried from the newest cloud copy. */
function unknownSelection(remoteStates: Readonly<Record<string, StateFragment>>): Record<string, unknown> {
  let winner: VersionedSyncValue | undefined;
  for (const fragment of Object.values(remoteStates)) {
    const candidate = fragment?.settings?.["amsConsole.selected"];
    if (candidate && (!winner || compareSyncVersion(candidate, winner) > 0)) winner = candidate;
  }
  return Object.fromEntries(Object.entries(hostMap(winner?.value)).filter(([host]) => !keyFor(host)));
}

function groupsWithUnknownHosts(remoteStates: Readonly<Record<string, StateFragment>>): Set<string> {
  const ids = new Set<string>();
  for (const fragment of Object.values(remoteStates)) {
    for (const [id, group] of Object.entries(fragment?.groups ?? {})) {
      const hosts = (group as { readonly hosts?: unknown }).hosts;
      if (Array.isArray(hosts) && hosts.some((host) => typeof host === "string" && !keyFor(host))) ids.add(id);
    }
  }
  return ids;
}

function selectionFromSetting(setting?: VersionedSyncValue): SiteKey[] | null {
  if (!setting?.value || typeof setting.value !== "object" || Array.isArray(setting.value)) return null;
  const hosts = setting.value as Record<string, unknown>;
  const selected = new Set(Object.entries(hosts).flatMap(([host, enabled]) => enabled && keyFor(host) ? [keyFor(host)!] : []));
  return SITE_KEYS.filter((key) => selected.has(key));
}

function syncGroup(value: VersionedSyncValue & { readonly id: string }): WorkspaceGroup | null {
  if ("deletedAt" in value) return { id: value.id, updatedAt: value.updatedAt, deletedAt: value.deletedAt!, deviceId: value.deviceId };
  const input = value as VersionedSyncValue & { readonly id: string; readonly name?: unknown; readonly hosts?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const hosts = Array.isArray(input.hosts) ? input.hosts : [];
  const sites = SITE_KEYS.filter((key) => hosts.includes(hostFor(key)));
  if (!name || !sites.length) return null;
  return { id: value.id, name, sites, updatedAt: value.updatedAt, deviceId: value.deviceId };
}

function validArchive(value: unknown): value is StoredArchive {
  if (isArchiveRecord(value)) return true;
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArchiveTombstone>;
  return !!item.id && item.schema === SYNC_SCHEMA && typeof item.deviceId === "string" &&
    [item.createdAt, item.updatedAt, item.deletedAt].every(validSyncTime);
}

function compareEntity(left: StoredArchive, right: StoredArchive): number {
  return compareSyncVersion(
    { updatedAt: left.updatedAt, deviceId: left.deviceId, ...( "deletedAt" in left ? { deletedAt: left.deletedAt } : {}) },
    { updatedAt: right.updatedAt, deviceId: right.deviceId, ...( "deletedAt" in right ? { deletedAt: right.deletedAt } : {}) }
  );
}
