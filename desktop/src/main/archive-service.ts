import { randomUUID } from "node:crypto";

import type { ArchiveRepository } from "./archive-repository";
import {
  archiveMatches,
  createArchiveRecord,
  updateArchiveRecord,
  type ArchiveFilters,
  type ArchiveInput,
  type ArchivePatch,
  type ArchiveRecord,
  type ArchiveSearchResult
} from "../shared/archive";
import { getCopy } from "../shared/copy";
import { describeCollectionCode } from "../shared/status-copy";
import { SITES } from "./sites";

interface ArchiveServiceOptions {
  readonly deviceId: () => string;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const markdownText = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\[\]\\]/g, "\\$&");
const markdownUrl = (value: string) => value.replace(/[()]/g, (character) => character === "(" ? "%28" : "%29").replace(/\s/g, encodeURIComponent);

export class ArchiveService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly repository: ArchiveRepository,
    private readonly options: ArchiveServiceOptions
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  search(filters: ArchiveFilters = {}): ArchiveSearchResult {
    const records = this.repository.list();
    const tags = [...new Set(records.flatMap((record) => record.tags))]
      .sort((left, right) => left.localeCompare(right));
    return { items: records.filter((record) => archiveMatches(record, filters)), tags };
  }

  get(id: string): ArchiveRecord | null {
    const record = this.repository.get(id);
    return record && !("deletedAt" in record) ? record : null;
  }

  add(input: ArchiveInput): ArchiveRecord {
    const now = this.now();
    const record = createArchiveRecord(input, {
      id: this.createId(),
      now,
      deviceId: this.options.deviceId()
    });
    return this.repository.put(record) as ArchiveRecord;
  }

  update(id: string, patch: ArchivePatch): ArchiveRecord {
    const current = this.get(id);
    if (!current) throw new Error("not_found");
    const next = updateArchiveRecord(current, patch, {
      now: this.now(),
      deviceId: this.options.deviceId()
    });
    return this.repository.put(next) as ArchiveRecord;
  }

  delete(id: string): void {
    if (!this.repository.delete(id, this.now(), this.options.deviceId())) throw new Error("not_found");
  }

  exportMarkdown(id: string, locale: string): string {
    const record = this.get(id);
    if (!record) throw new Error("not_found");
    const copy = getCopy(locale);
    const markdown = [`# ${copy.archiveQuestion}`, `\n${record.task || record.text}`];
    if (record.source) {
      markdown.push(`\n**${copy.archiveSource}**: [${markdownText(record.source.title || record.source.url)}](${markdownUrl(record.source.url)})`);
    }
    for (const result of record.results) {
      const tier = result.state === "think" ? ` · ${copy.think}` : result.state === "fast" ? ` · ${copy.fast}` : "";
      markdown.push(`\n## ${result.label}${tier}`);
      if (record.winnerHost === result.host && result.text?.trim()) markdown.push(`\n**${copy.archiveBestAnswer}**`);
      markdown.push(`\n${result.text?.trim() || `> ${describeCollectionCode(copy, result.code)}`}`);
      if (result.code === "answer_truncated") markdown.push(`\n> ${copy.answerTruncated}`);
    }
    const synthesis = record.synthesis;
    if (synthesis) {
      const tier = synthesis.state === "think" ? copy.think : synthesis.state === "fast" ? copy.fast : "";
      const site = SITES.find((candidate) => candidate.host === synthesis.host);
      markdown.push(`\n## ${copy.synthesisSaved}`);
      markdown.push(`\n**${copy.synthesisTarget}**: ${site?.label ?? synthesis.host}${tier ? ` · ${tier}` : ""}`);
      markdown.push(`\n${synthesis.text}`);
    }
    return markdown.join("\n");
  }
}
