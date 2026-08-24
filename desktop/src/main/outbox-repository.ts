import type { DatabaseSync } from "node:sqlite";

import type { OutboxOperation } from "../shared/sync";
import { readJson } from "./repository-utils";

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
