import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ArchiveRepository } from "./archive-repository";
import { HistoryRepository } from "./history-repository";
import { DriveFileRepository } from "./drive-file-repository";
import { MetaRepository } from "./meta-repository";
import { OutboxRepository } from "./outbox-repository";
import { inTransaction } from "./repository-utils";
import { StateRepository } from "./state-repository";

const SCHEMA_VERSION = 1;

function migrate(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      sort_time INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS history_sort ON history(sort_time DESC, id);
    CREATE INDEX IF NOT EXISTS history_deleted ON history(deleted_at);
    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      sort_time INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS archives_sort ON archives(sort_time DESC, id);
    CREATE INDEX IF NOT EXISTS archives_deleted ON archives(deleted_at);
    CREATE TABLE IF NOT EXISTS state_items (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS state_updated ON state_items(updated_at, key);
    CREATE INDEX IF NOT EXISTS state_deleted ON state_items(deleted_at);
    CREATE TABLE IF NOT EXISTS outbox (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      entity_id TEXT,
      body TEXT NOT NULL,
      next_at INTEGER NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS outbox_next ON outbox(next_at, key);
    CREATE INDEX IF NOT EXISTS outbox_entity ON outbox(kind, entity_id);
    CREATE TABLE IF NOT EXISTS drive_files (
      file_id TEXT PRIMARY KEY,
      logical_key TEXT NOT NULL,
      body TEXT NOT NULL,
      seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drive_logical_key ON drive_files(logical_key);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, body TEXT NOT NULL);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

export class DesktopDatabase {
  readonly outbox: OutboxRepository;
  readonly history: HistoryRepository;
  readonly archives: ArchiveRepository;
  readonly state: StateRepository;
  readonly driveFiles: DriveFileRepository;
  readonly meta: MetaRepository;
  private closed = false;

  private constructor(private readonly database: DatabaseSync) {
    this.outbox = new OutboxRepository(database);
    this.history = new HistoryRepository(database, this.outbox);
    this.archives = new ArchiveRepository(database, this.outbox);
    this.state = new StateRepository(database, this.outbox);
    this.driveFiles = new DriveFileRepository(database);
    this.meta = new MetaRepository(database);
  }

  static open(path: string): DesktopDatabase {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    migrate(database);
    return new DesktopDatabase(database);
  }

  configuration(): { journalMode: string; foreignKeys: boolean; userVersion: number } {
    const journal = this.database.prepare("PRAGMA journal_mode").get() as { journal_mode?: unknown } | undefined;
    const foreign = this.database.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: unknown } | undefined;
    const version = this.database.prepare("PRAGMA user_version").get() as { user_version?: unknown } | undefined;
    return {
      journalMode: String(journal?.journal_mode ?? ""),
      foreignKeys: Number(foreign?.foreign_keys) === 1,
      userVersion: Number(version?.user_version) || 0
    };
  }

  // 本机重置唯一的物理删除路径：只清本机，云端由重新连接后的全量拉取恢复。deviceId 保留（见 DataAdminService）。
  resetLocalData(): void {
    inTransaction(this.database, () => {
      for (const table of ["history", "archives", "state_items", "outbox", "drive_files"]) this.database.exec(`DELETE FROM ${table}`);
      this.database.prepare("DELETE FROM meta WHERE key <> ?").run("deviceId");
    });
  }

  adoptImportedProfile(deviceId: string): void {
    this.outbox.rekeyPendingHistory(deviceId);
    this.meta.put("deviceId", deviceId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
