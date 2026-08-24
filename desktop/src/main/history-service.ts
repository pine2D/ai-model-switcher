import { createHash } from "node:crypto";

import { utf8Preview, type HistoryRecord } from "../shared/sync";
import type { HistoryRepository } from "./history-repository";

interface HistoryServiceOptions {
  readonly deviceId: () => string;
  readonly now?: () => number;
}

export class HistoryService {
  private readonly now: () => number;

  constructor(
    private readonly repository: HistoryRepository,
    private readonly options: HistoryServiceOptions
  ) {
    this.now = options.now ?? Date.now;
  }

  record(value: string): HistoryRecord {
    const text = String(value ?? "").trim();
    if (!text) throw new Error("invalid_history_text");
    const id = createHash("sha256").update(text).digest("hex");
    const current = this.repository.get(id);
    const now = this.now();
    const record: HistoryRecord = {
      id,
      textHash: id,
      text,
      preview: utf8Preview(text),
      createdAt: current?.createdAt ?? now,
      lastUsedAt: now,
      updatedAt: now,
      deviceId: this.options.deviceId(),
      schema: 1
    };
    return this.repository.put(record) as HistoryRecord;
  }
}
