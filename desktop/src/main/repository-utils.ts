import type { DatabaseSync } from "node:sqlite";

export function readJson<T>(row: unknown): T | null {
  if (!row || typeof row !== "object") return null;
  const body = (row as { body?: unknown }).body;
  if (typeof body !== "string") return null;
  // 一行正文损坏只丢这一行：调用方都以 null 过滤；抛出去会让 history.list() 之类整体失败，bootstrap 里同步调它 = 一行坏数据打掉整个 shell。
  try { return JSON.parse(body) as T; }
  catch { return null; }
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
