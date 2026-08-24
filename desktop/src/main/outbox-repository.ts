import type { DatabaseSync } from "node:sqlite";

import type { OutboxOperation } from "../shared/sync";
import { readJson } from "./repository-utils";

export class OutboxRepository {
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
    return { ...value, revision };
  }

  count(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM outbox").get() as { count?: unknown } | undefined;
    return Number(row?.count) || 0;
  }
}
