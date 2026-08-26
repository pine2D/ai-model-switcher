import type { DatabaseSync } from "node:sqlite";

import type { OutboxOperation } from "../shared/sync";
import { inTransaction, readJson } from "./repository-utils";

export class OutboxRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: DatabaseSync) {}

  enqueue(operation: OutboxOperation): OutboxOperation & { readonly revision: number } {
    this.database.prepare(`
      INSERT INTO outbox (key, kind, entity_id, body, next_at, revision)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        kind = excluded.kind,
        entity_id = excluded.entity_id,
        body = excluded.body,
        next_at = excluded.next_at,
        revision = outbox.revision + 1
    `).run(
      operation.key,
      operation.kind,
      operation.entityId ?? null,
      JSON.stringify(operation),
      operation.nextAt
    );
    const row = this.database.prepare("SELECT body, revision FROM outbox WHERE key = ?").get(operation.key);
    const value = readJson<OutboxOperation>(row);
    const revision = Number((row as { revision?: unknown } | undefined)?.revision) || 1;
    if (!value) throw new Error("outbox_write_failed");
    for (const listener of this.listeners) listener();
    return { ...value, revision };
  }

  count(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM outbox").get() as { count?: unknown } | undefined;
    return Number(row?.count) || 0;
  }

  rekeyPendingHistory(deviceId: string): void {
    if (!deviceId) throw new Error("invalid_device_id");
    const rows = this.database.prepare(
      "SELECT key, body, revision FROM outbox WHERE kind = 'history' ORDER BY key"
    ).all() as { key?: unknown; body?: unknown; revision?: unknown }[];
    const remove = this.database.prepare("DELETE FROM outbox WHERE key = ?");
    const insert = this.database.prepare(`
      INSERT INTO outbox (key, kind, entity_id, body, next_at, revision)
      VALUES (?, 'history', ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        body = excluded.body,
        next_at = MIN(outbox.next_at, excluded.next_at),
        revision = MAX(outbox.revision, excluded.revision) + 1
    `);
    inTransaction(this.database, () => {
      for (const row of rows) {
        const operation = readJson<OutboxOperation>(row);
        if (!operation?.entityId || typeof row.key !== "string") continue;
        const key = `history:${operation.entityId}:${deviceId}`;
        if (key === row.key) continue;
        remove.run(row.key);
        const rewritten = { ...operation, key };
        insert.run(key, operation.entityId, JSON.stringify(rewritten), operation.nextAt, Number(row.revision) || 1);
      }
    });
    if (rows.length) for (const listener of this.listeners) listener();
  }

  ready(now: number, limit = 100): (OutboxOperation & { readonly revision: number })[] {
    const rows = this.database.prepare(`
      SELECT body, revision FROM outbox
      WHERE next_at <= ? ORDER BY next_at, key LIMIT ?
    `).all(now, limit);
    return rows.flatMap((row) => {
      const value = readJson<OutboxOperation>(row);
      const revision = Number((row as { revision?: unknown }).revision);
      return value && Number.isSafeInteger(revision) ? [{ ...value, revision }] : [];
    });
  }

  complete(key: string, revision: number): boolean {
    return this.database.prepare("DELETE FROM outbox WHERE key = ? AND revision = ?").run(key, revision).changes === 1;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
