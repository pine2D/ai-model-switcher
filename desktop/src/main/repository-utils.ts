import type { DatabaseSync } from "node:sqlite";

export function readJson<T>(row: unknown): T | null {
  if (!row || typeof row !== "object") return null;
  const body = (row as { body?: unknown }).body;
  if (typeof body !== "string") return null;
  return JSON.parse(body) as T;
}

export function inTransaction<T>(database: DatabaseSync, task: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
