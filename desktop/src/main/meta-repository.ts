import type { DatabaseSync } from "node:sqlite";

import { readJson } from "./repository-utils";

export class MetaRepository {
  constructor(private readonly database: DatabaseSync) {}

  get<T = unknown>(key: string): T | null {
    const row = this.database.prepare("SELECT body FROM meta WHERE key = ?").get(key);
    return readJson<T>(row);
  }

  put<T>(key: string, value: T): T {
    if (!key) throw new Error("invalid_meta_key");
    this.database.prepare(`
      INSERT INTO meta (key, body) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET body = excluded.body
    `).run(key, JSON.stringify(value));
    return value;
  }

  delete(key: string): void {
    this.database.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }
}
