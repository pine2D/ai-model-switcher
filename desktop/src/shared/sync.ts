export const SYNC_SCHEMA = 1;
export const CLEAR_REMOTE_CONFIRMATION = "DELETE";

export interface HistoryRecord {
  readonly id: string;
  readonly textHash: string;
  readonly text: string;
  readonly preview: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly schema: 1;
}

export interface HistoryTombstone {
  readonly id: string;
  readonly textHash: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
  readonly schema: 1;
}

export type StoredHistory = HistoryRecord | HistoryTombstone;
export type SyncEntityKind = "history" | "archive" | "state";

export type SyncState = "idle" | "syncing" | "offline" | "auth" | "blocked" | "waiting" | "schema" | "error";

export interface SyncStatus {
  readonly state: SyncState;
  readonly connected: boolean;
  readonly pending: number;
  readonly errorCount: number;
  readonly lastSuccessAt?: number;
  readonly reason?: string;
  readonly diagnostic?: string;
  readonly readOnly: boolean;
  readonly oauthConfigured: boolean;
  readonly secureTokenStorage: boolean;
  /** A Google refresh token is still held on this device even while disconnected. */
  readonly hasStoredToken?: boolean;
}

export interface VersionedSyncValue {
  readonly value?: unknown;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly deletedAt?: number;
}

export interface SyncTemplateValue extends VersionedSyncValue {
  readonly id: string;
  readonly name?: unknown;
  readonly text?: unknown;
}

export interface StateFragment {
  readonly schema: number;
  readonly deviceId: string;
  readonly settings: Readonly<Record<string, VersionedSyncValue>>;
  readonly templates: Readonly<Record<string, SyncTemplateValue>>;
  readonly groups: Readonly<Record<string, VersionedSyncValue & { readonly id: string }>>;
}

export interface MergedState {
  readonly settings: Readonly<Record<string, VersionedSyncValue>>;
  readonly templates: readonly SyncTemplateValue[];
  readonly groups: readonly (VersionedSyncValue & { readonly id: string })[];
  readonly materialized: StateFragment;
  readonly readOnly: boolean;
  readonly corrupt: number;
}

export interface OutboxOperation {
  readonly key: string;
  readonly kind: SyncEntityKind;
  readonly entityId?: string;
  readonly nextAt: number;
  readonly attempt: number;
  readonly revision?: number;
}

export function validSyncTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function versionTime(value: Partial<VersionedSyncValue>): number {
  return Math.max(Number(value.updatedAt) || 0, Number(value.deletedAt) || 0);
}

export function compareSyncVersion(
  left: Partial<VersionedSyncValue>,
  right: Partial<VersionedSyncValue>
): number {
  return versionTime(left) - versionTime(right) ||
    String(left.deviceId ?? "").localeCompare(String(right.deviceId ?? ""));
}

function newer<T extends VersionedSyncValue>(current: T | undefined, candidate: T): T {
  return !current || compareSyncVersion(candidate, current) > 0 ? candidate : current;
}

export function mergeHistoryRecords(records: readonly (StoredHistory | null | undefined)[]): StoredHistory[] {
  const merged = new Map<string, StoredHistory>();
  for (const record of records) {
    if (!record || !isHistoryRecord(record)) continue;
    const current = merged.get(record.textHash);
    const currentTime = Math.max(Number(current?.updatedAt) || 0, current && "deletedAt" in current ? current.deletedAt : 0, Number(current?.lastUsedAt) || 0);
    const nextTime = Math.max(record.updatedAt, "deletedAt" in record ? record.deletedAt : 0, record.lastUsedAt);
    const winsTie = !!current && nextTime === currentTime && (
      ("deletedAt" in record && !("deletedAt" in current)) ||
      (("deletedAt" in record) === ("deletedAt" in current) && record.deviceId.localeCompare(current.deviceId) > 0)
    );
    if (!current || nextTime > currentTime || winsTie) merged.set(record.textHash, record);
  }
  return [...merged.values()].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

export function mergeStateFragments(fragments: readonly unknown[]): MergedState {
  const settings: Record<string, VersionedSyncValue> = {};
  const templates = new Map<string, SyncTemplateValue>();
  const groups = new Map<string, VersionedSyncValue & { id: string }>();
  let readOnly = false;
  let corrupt = 0;
  for (const value of fragments) {
    if (!value || typeof value !== "object") { corrupt += 1; continue; }
    const fragment = value as Partial<StateFragment>;
    if (Number(fragment.schema) > SYNC_SCHEMA) { readOnly = true; continue; }
    if (fragment.schema !== SYNC_SCHEMA || typeof fragment.deviceId !== "string") { corrupt += 1; continue; }
    for (const [key, candidate] of Object.entries(fragment.settings ?? {})) {
      if (!validVersioned(candidate)) { corrupt += 1; continue; }
      const normalized = { ...candidate, deviceId: candidate.deviceId || fragment.deviceId };
      settings[key] = newer(settings[key], normalized);
    }
    for (const [bucket, target] of [[fragment.templates, templates], [fragment.groups, groups]] as const) {
      for (const candidate of Object.values(bucket ?? {})) {
        if (!validVersioned(candidate) || typeof candidate.id !== "string" || !candidate.id) { corrupt += 1; continue; }
        const normalized = { ...candidate, deviceId: candidate.deviceId || fragment.deviceId };
        target.set(candidate.id, newer(target.get(candidate.id), normalized));
      }
    }
  }
  const templateMap = Object.fromEntries(templates);
  const groupMap = Object.fromEntries(groups);
  return {
    settings,
    templates: [...templates.values()].filter((item) => !("deletedAt" in item)),
    groups: [...groups.values()].filter((item) => !("deletedAt" in item)),
    materialized: { schema: SYNC_SCHEMA, deviceId: "materialized", settings, templates: templateMap, groups: groupMap },
    readOnly,
    corrupt
  };
}

function validVersioned(value: unknown): value is VersionedSyncValue {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VersionedSyncValue>;
  return validSyncTime(item.updatedAt) && (item.deviceId == null || typeof item.deviceId === "string") &&
    (!("deletedAt" in item) || validSyncTime(item.deletedAt));
}

export function utf8Preview(value: unknown, maxBytes = 96): string {
  let output = "";
  let used = 0;
  for (const character of String(value ?? "")) {
    const size = new TextEncoder().encode(character).length;
    if (used + size > maxBytes) break;
    output += character;
    used += size;
  }
  return output;
}

export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15 * 60_000, 1_000 * (2 ** Math.max(0, attempt)));
  return Math.round(base * (0.75 + random() * 0.5));
}

export function isHistoryRecord(value: unknown): value is StoredHistory {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!record.id || record.textHash !== record.id || !record.deviceId || record.schema !== SYNC_SCHEMA) return false;
  if (![record.createdAt, record.lastUsedAt, record.updatedAt].every(validSyncTime)) return false;
  if ("deletedAt" in record) return validSyncTime(record.deletedAt);
  return typeof record.text === "string" && record.text.trim().length > 0 && typeof record.preview === "string";
}

export function tombstoneHistory(
  record: StoredHistory,
  now: number,
  deviceId: string
): HistoryTombstone {
  if (!validSyncTime(now) || !deviceId) throw new Error("invalid_tombstone");
  return {
    id: record.id,
    textHash: record.textHash,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    updatedAt: now,
    deletedAt: now,
    deviceId,
    schema: SYNC_SCHEMA
  };
}
