export const SYNC_SCHEMA = 1;

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
