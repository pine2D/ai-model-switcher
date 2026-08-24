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
export type ArchiveInput = Pick<ArchiveRecord, "text" | "task" | "results"> & Partial<ArchiveRecord>;
export type ArchivePatch = Partial<Pick<ArchiveRecord, "favorite" | "tags" | "note" | "winnerHost" | "synthesis">>;
export interface ArchiveFilters {
  readonly query?: string;
  readonly tag?: string;
  readonly favorite?: boolean;
}

export interface ArchiveSearchResult {
  readonly items: readonly ArchiveRecord[];
  readonly tags: readonly string[];
}

const clean = (value: unknown) => String(value ?? "").trim();
const codePointPreview = (value: unknown) => [...clean(value)].slice(0, 320).join("");

function normalizeSource(value: unknown): ArchiveSource | null {
  if (value == null) return null;
  if (!value || typeof value !== "object") throw new Error("invalid_source");
  const source = value as Partial<ArchiveSource>;
  if (source.kind !== "page" && source.kind !== "selection") throw new Error("invalid_source");
  if (typeof source.url !== "string") throw new Error("invalid_source");
  let url: URL;
  try { url = new URL(source.url); } catch { throw new Error("invalid_source"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_source");
  if (!validSyncTime(source.capturedAt)) throw new Error("invalid_source");
  const title = clean(source.title);
  if ([...title].length > 512) throw new Error("invalid_source");
  return {
    kind: source.kind,
    title,
    url: url.href,
    truncated: !!source.truncated,
    capturedAt: source.capturedAt
  };
}

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

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("invalid_tags");
  const tags = [...new Set(value.map(clean).filter(Boolean))];
  if (tags.some((tag) => [...tag].length > 32)) throw new Error("invalid_tags");
  return tags;
}

function normalizeSynthesis(value: unknown): ArchiveSynthesis | null {
  if (value == null) return null;
  if (!value || typeof value !== "object") throw new Error("invalid_synthesis");
  const synthesis = value as Partial<ArchiveSynthesis>;
  const host = clean(synthesis.host);
  if (!host || [...host].length > 256 || typeof synthesis.text !== "string" || !synthesis.text.trim()) {
    throw new Error("invalid_synthesis");
  }
  if (typeof synthesis.instruction !== "string" || [...synthesis.instruction].length > 4_000 || !validSyncTime(synthesis.createdAt)) {
    throw new Error("invalid_synthesis");
  }
  return {
    host,
    text: synthesis.text,
    state: synthesis.state === "think" || synthesis.state === "fast" ? synthesis.state : null,
    instruction: clean(synthesis.instruction),
    createdAt: synthesis.createdAt
  };
}

export function updateArchiveRecord(
  record: ArchiveRecord,
  patch: ArchivePatch,
  context: { readonly now: number; readonly deviceId: string }
): ArchiveRecord {
  const allowed = new Set(["favorite", "tags", "note", "winnerHost", "synthesis"]);
  if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) => !allowed.has(key))) {
    throw new Error("invalid_patch");
  }
  if (!validSyncTime(context.now) || !context.deviceId) throw new Error("invalid_archive_version");
  const next = { ...record, updatedAt: context.now, deviceId: context.deviceId };
  if (Object.hasOwn(patch, "favorite")) {
    if (typeof patch.favorite !== "boolean") throw new Error("invalid_favorite");
    next.favorite = patch.favorite;
  }
  if (Object.hasOwn(patch, "tags")) next.tags = cleanTags(patch.tags);
  if (Object.hasOwn(patch, "note")) {
    if (typeof patch.note !== "string" || [...patch.note].length > 4_000) throw new Error("invalid_note");
    next.note = patch.note;
  }
  if (Object.hasOwn(patch, "winnerHost")) {
    const winner = patch.winnerHost == null ? null : clean(patch.winnerHost);
    const successful = record.results.some((result) => result.host === winner && result.text?.trim());
    if (winner && !successful) throw new Error("invalid_winner");
    next.winnerHost = winner;
  }
  if (Object.hasOwn(patch, "synthesis")) next.synthesis = normalizeSynthesis(patch.synthesis);
  return { ...next, searchText: searchText(next) };
}

export function archiveMatches(
  record: ArchiveRecord,
  filters: ArchiveFilters
): boolean {
  const query = clean(filters.query).toLowerCase();
  const tag = clean(filters.tag);
  return (!query || record.searchText.includes(query)) &&
    (!filters.favorite || record.favorite) &&
    (!tag || record.tags.includes(tag));
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
    id: context.id,
    text: String(input.text ?? ""),
    task,
    source: normalizeSource(input.source),
    results,
    favorite: false,
    tags: [],
    note: "",
    winnerHost: null,
    synthesis: null,
    hosts: results.map((result) => result.host),
    resultPreviews,
    preview: typeof input.preview === "string" && input.preview ? input.preview : utf8Preview(input.text),
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
  if (typeof record.favorite !== "boolean" || typeof record.note !== "string" || [...record.note].length > 4_000 || typeof record.searchText !== "string") return false;
  try {
    const normalized = record.results.map(normalizeResult);
    const tags = cleanTags(record.tags);
    const source = normalizeSource(record.source);
    const synthesis = normalizeSynthesis(record.synthesis);
    const hosts = normalized.map((result) => result.host);
    const previews = normalized.filter((result) => typeof result.text === "string" && result.text.trim())
      .map((result) => ({ host: result.host, label: result.label, text: codePointPreview(result.text) }));
    const winner = record.winnerHost == null || normalized.some((result) => result.host === record.winnerHost && result.text?.trim());
    return JSON.stringify(tags) === JSON.stringify(record.tags) &&
      JSON.stringify(source) === JSON.stringify(record.source) && winner &&
      JSON.stringify(synthesis) === JSON.stringify(record.synthesis) &&
      JSON.stringify(hosts) === JSON.stringify(record.hosts) &&
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
