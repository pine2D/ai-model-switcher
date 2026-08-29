import { randomUUID } from "node:crypto";

import {
  createPromptTemplate,
  isStoredPromptTemplate,
  tombstonePromptTemplate,
  type PromptLibraryState,
  type PromptTemplate,
  type StoredPromptTemplate
} from "../shared/prompt-library";
import type { HistoryService } from "./history-service";
import type { MetaRepository } from "./meta-repository";
import type { StateRepository } from "./state-repository";

const TEMPLATE_PREFIX = "template:";

interface PromptLibraryOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class PromptLibraryService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly state: StateRepository,
    private readonly meta: MetaRepository,
    private readonly history: HistoryService,
    options: PromptLibraryOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  getState(): PromptLibraryState {
    const templates = this.state.list<unknown>(TEMPLATE_PREFIX)
      .filter(isStoredPromptTemplate)
      .filter((item): item is PromptTemplate => !("deletedAt" in item));
    return { templates, history: this.history.list(30) };
  }

  save(value: unknown): PromptTemplate {
    if (!value || typeof value !== "object") throw new Error("invalid_prompt_template");
    const input = value as { id?: unknown; name?: unknown; text?: unknown };
    const id = typeof input.id === "string" && input.id.trim() ? input.id : this.createId();
    const template = createPromptTemplate({
      id,
      name: typeof input.name === "string" ? input.name : "",
      text: typeof input.text === "string" ? input.text : ""
    }, { now: this.now(), deviceId: this.deviceId() });
    this.state.put(`${TEMPLATE_PREFIX}${template.id}`, template, template.updatedAt);
    return template;
  }

  delete(value: unknown): StoredPromptTemplate {
    if (typeof value !== "string" || !value.trim() || value.length > 128) {
      throw new Error("invalid_prompt_template_id");
    }
    const current = this.state.get<unknown>(`${TEMPLATE_PREFIX}${value}`);
    if (!isStoredPromptTemplate(current) || "deletedAt" in current) throw new Error("prompt_template_not_found");
    const deleted = tombstonePromptTemplate(current, this.now(), this.deviceId());
    return this.state.put(`${TEMPLATE_PREFIX}${value}`, deleted, deleted.updatedAt);
  }

  private deviceId(): string {
    const id = this.meta.get<unknown>("deviceId");
    if (typeof id !== "string" || !id) throw new Error("device_id_missing");
    return id;
  }
}
