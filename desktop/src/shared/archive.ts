import { SYNC_SCHEMA, utf8Preview, validSyncTime } from "./sync";

export interface ArchiveResult {
  readonly host: string;
  readonly label: string;
  readonly text: string | null;
  readonly state?: string;
  readonly code?: string;
}

export interface ArchivePreview {
  readonly host: string;
  readonly label: string;
  readonly text: string;
}

export interface ArchiveSource {
  readonly kind: "page" | "selection";
  readonly title: string;
  readonly url: string;
  readonly truncated: boolean;
  readonly capturedAt: number;
}

export interface ArchiveSynthesis {
  readonly host: string;
  readonly text: string;
  readonly state: "think" | "fast" | null;
  readonly instruction: string;
  readonly createdAt: number;
}

export interface ArchiveRecord {
  readonly id: string;
  readonly text: string;
  readonly task: string;
  readonly source: ArchiveSource | null;
  readonly results: readonly ArchiveResult[];
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly note: string;
  readonly winnerHost: string | null;
  readonly synthesis: ArchiveSynthesis | null;
  readonly hosts: readonly string[];
  readonly resultPreviews: readonly ArchivePreview[];
  readonly searchText: string;
  readonly preview: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly ts: number;
  readonly deviceId: string;
  readonly schema: 1;
}

export interface ArchiveTombstone {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
  readonly schema: 1;
}

export type StoredArchive = ArchiveRecord | ArchiveTombstone;
type ArchiveInput = Pick<ArchiveRecord, "text" | "task" | "results"> & Partial<ArchiveRecord>;

const clean = (value: unknown) => String(value ?? "").trim();
const codePointPreview = (value: unknown) => [...clean(value)].slice(0, 320).join("");

function normalizeResult(value: ArchiveResult): ArchiveResult {
  const host = clean(value.host);
  const label = clean(value.label);
  if (!host || [...host].length > 256 || [...label].length > 256) throw new Error("invalid_result");
  if (value.text !== null && typeof value.text !== "string") throw new Error("invalid_result");
  if (value.state != null && (typeof value.state !== "string" || value.state.length > 64)) throw new Error("invalid_result");
  if (value.code != null && (typeof value.code !== "string" || value.code.length > 64)) throw new Error("invalid_result");
  return { host, label, text: value.text, ...(value.state ? { state: value.state } : {}), ...(value.code ? { code: value.code } : {}) };
}

function searchText(record: Pick<ArchiveRecord, "task" | "source" | "note" | "tags" | "results" | "resultPreviews" | "synthesis">): string {
  return [
    record.task,
    record.source?.title,
    record.source?.url,
    record.note,
    ...record.tags,
    ...record.results.map((result) => result.label),
    ...record.resultPreviews.map((result) => result.text),
    codePointPreview(record.synthesis?.text)
  ].filter(Boolean).join("\n").toLowerCase();
}

export function createArchiveRecord(
  input: ArchiveInput,
  context: { readonly id: string; readonly now: number; readonly deviceId: string }
): ArchiveRecord {
  if (!context.id || !context.deviceId || !validSyncTime(context.now)) throw new Error("invalid_archive_version");
  const results = input.results.map(normalizeResult);
  const task = clean(input.task || input.text);
  const resultPreviews = results
    .filter((result) => typeof result.text === "string" && result.text.trim())
    .map((result) => ({ host: result.host, label: result.label, text: codePointPreview(result.text) }));
  const createdAt = validSyncTime(input.createdAt) ? input.createdAt : context.now;
  const base = {
    ...input,
    id: context.id,
    text: String(input.text ?? ""),
    task,
    source: input.source ?? null,
    results,
    favorite: false,
    tags: [],
    note: "",
    winnerHost: null,
    synthesis: null,
    hosts: results.map((result) => result.host),
    resultPreviews,
    preview: input.preview || utf8Preview(input.text),
    createdAt,
    updatedAt: validSyncTime(input.updatedAt) ? input.updatedAt : context.now,
    ts: validSyncTime(input.ts) ? input.ts : createdAt,
    deviceId: context.deviceId,
    schema: SYNC_SCHEMA
  } satisfies Omit<ArchiveRecord, "searchText">;
  return { ...base, searchText: searchText(base) };
}

export function isArchiveRecord(value: unknown): value is ArchiveRecord {
  if (!value || typeof value !== "object" || "deletedAt" in value) return false;
  const record = value as Partial<ArchiveRecord>;
  if (!record.id || !record.deviceId || record.schema !== SYNC_SCHEMA) return false;
  if (![record.createdAt, record.updatedAt, record.ts].every(validSyncTime)) return false;
  if (typeof record.text !== "string" || typeof record.task !== "string" || !Array.isArray(record.results)) return false;
  if (!Array.isArray(record.tags) || !Array.isArray(record.hosts) || !Array.isArray(record.resultPreviews)) return false;
  if (typeof record.favorite !== "boolean" || typeof record.note !== "string" || typeof record.searchText !== "string") return false;
  try {
    const normalized = record.results.map(normalizeResult);
    const hosts = normalized.map((result) => result.host);
    const previews = normalized.filter((result) => typeof result.text === "string" && result.text.trim())
      .map((result) => ({ host: result.host, label: result.label, text: codePointPreview(result.text) }));
    return JSON.stringify(hosts) === JSON.stringify(record.hosts) &&
      JSON.stringify(previews) === JSON.stringify(record.resultPreviews) &&
      searchText(record as ArchiveRecord) === record.searchText;
  } catch {
    return false;
  }
}

export function tombstoneArchive(
  record: StoredArchive,
  now: number,
  deviceId: string
): ArchiveTombstone {
  if (!validSyncTime(now) || !deviceId) throw new Error("invalid_tombstone");
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: now,
    deletedAt: now,
    deviceId,
    schema: SYNC_SCHEMA
  };
}
