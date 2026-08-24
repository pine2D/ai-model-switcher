import type { DatabaseSync } from "node:sqlite";

import type { DriveFile } from "./drive-client";
import { readJson } from "./repository-utils";

export interface IndexedDriveFile extends DriveFile {
  readonly logicalKey: string;
  readonly seenAt: number;
}

export class DriveFileRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(fileId: string): IndexedDriveFile | null {
    return readJson<IndexedDriveFile>(this.database.prepare("SELECT body FROM drive_files WHERE file_id = ?").get(fileId));
  }

  find(logicalKey: string): IndexedDriveFile | null {
    return readJson<IndexedDriveFile>(this.database.prepare("SELECT body FROM drive_files WHERE logical_key = ? ORDER BY file_id LIMIT 1").get(logicalKey));
  }

  list(): IndexedDriveFile[] {
    return this.database.prepare("SELECT body FROM drive_files ORDER BY file_id").all()
      .flatMap((row) => readJson<IndexedDriveFile>(row) ?? []);
  }

  put(file: IndexedDriveFile): IndexedDriveFile {
    if (!file.id || !file.logicalKey || !Number.isSafeInteger(file.seenAt)) throw new Error("invalid_drive_file");
    this.database.prepare(`
      INSERT INTO drive_files (file_id, logical_key, body, seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET logical_key = excluded.logical_key, body = excluded.body, seen_at = excluded.seen_at
    `).run(file.id, file.logicalKey, JSON.stringify(file), file.seenAt);
    return file;
  }

  delete(fileId: string): void {
    this.database.prepare("DELETE FROM drive_files WHERE file_id = ?").run(fileId);
  }

  clear(): void {
    this.database.prepare("DELETE FROM drive_files").run();
  }
}
