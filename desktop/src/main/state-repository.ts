import type { DatabaseSync } from "node:sqlite";

import { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

export class StateRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly outbox: OutboxRepository
  ) {}

  get<T = unknown>(key: string): T | null {
    const row = this.database.prepare("SELECT body FROM state_items WHERE key = ?").get(key);
    return readJson<T>(row);
  }

  list<T = unknown>(prefix: string): T[] {
    if (!prefix) throw new Error("invalid_state_prefix");
    const rows = this.database.prepare(`
      SELECT body FROM state_items
      WHERE substr(key, 1, ?) = ?
      ORDER BY updated_at DESC, key
    `).all(prefix.length, prefix);
    return rows.flatMap((row) => {
      const value = readJson<T>(row);
      return value === null ? [] : [value];
    });
  }

  put<T>(key: string, value: T, updatedAt: number, enqueue = true): T {
    if (!key || !Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new Error("invalid_state_item");
    const deletedAt = value && typeof value === "object" && "deletedAt" in value
      ? Number((value as { deletedAt: unknown }).deletedAt)
      : null;
    const write = () => {
      this.database.prepare(`
        INSERT INTO state_items (key, body, updated_at, deleted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      `).run(key, JSON.stringify(value), updatedAt, Number.isSafeInteger(deletedAt) ? deletedAt : null);
      if (enqueue) this.outbox.enqueue({
        key: `state:${key}`,
        kind: "state",
        entityId: key,
        nextAt: 0,
        attempt: 0
      });
      return value;
    };
    return enqueue ? inTransaction(this.database, write) : write();
  }
}
