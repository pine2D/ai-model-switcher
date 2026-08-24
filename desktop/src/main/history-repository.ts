import type { DatabaseSync } from "node:sqlite";

import {
  isHistoryRecord,
  tombstoneHistory,
  type StoredHistory
} from "../shared/sync";
import { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

export class HistoryRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly outbox: OutboxRepository
  ) {}

  get(id: string): StoredHistory | null {
    const row = this.database.prepare("SELECT body FROM history WHERE id = ?").get(id);
    return readJson<StoredHistory>(row);
  }

  put(record: StoredHistory, enqueue = true): StoredHistory {
    if (!isHistoryRecord(record)) throw new Error("invalid_history");
    const write = () => {
      this.database.prepare(`
        INSERT INTO history (id, body, sort_time, deleted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET body = excluded.body, sort_time = excluded.sort_time, deleted_at = excluded.deleted_at
      `).run(
        record.id,
        JSON.stringify(record),
        record.lastUsedAt,
        "deletedAt" in record ? record.deletedAt : null
      );
      if (enqueue) this.outbox.enqueue({
        key: `history:${record.id}:${record.deviceId}`,
        kind: "history",
        entityId: record.id,
        nextAt: 0,
        attempt: 0
      });
      return record;
    };
    return enqueue ? inTransaction(this.database, write) : write();
  }

  delete(id: string, now: number, deviceId: string): StoredHistory | null {
    const current = this.get(id);
    if (!current) return null;
    return this.put(tombstoneHistory(current, now, deviceId));
  }
}
