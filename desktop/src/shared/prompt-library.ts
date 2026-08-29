import { validSyncTime } from "./sync";

export const PROMPT_TEMPLATE_NAME_LIMIT = 80;
export const PROMPT_TEMPLATE_TEXT_LIMIT = 100_000;

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly updatedAt: number;
  readonly deviceId: string;
}

export interface PromptTemplateTombstone {
  readonly id: string;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
}

export type StoredPromptTemplate = PromptTemplate | PromptTemplateTombstone;

export interface PromptHistoryItem {
  readonly id: string;
  readonly text: string;
  readonly lastUsedAt: number;
}

export interface PromptLibraryState {
  readonly templates: readonly PromptTemplate[];
  readonly history: readonly PromptHistoryItem[];
}

interface TemplateInput {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}

interface VersionContext {
  readonly now: number;
  readonly deviceId: string;
}

export function createPromptTemplate(input: TemplateInput, context: VersionContext): PromptTemplate {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const text = String(input.text ?? "").trim();
  if (!id || id.length > 128 || !name || [...name].length > PROMPT_TEMPLATE_NAME_LIMIT ||
    !text || [...text].length > PROMPT_TEMPLATE_TEXT_LIMIT ||
    !validSyncTime(context.now) || !context.deviceId) throw new Error("invalid_prompt_template");
  return { id, name, text, updatedAt: context.now, deviceId: context.deviceId };
}

export function tombstonePromptTemplate(
  template: StoredPromptTemplate,
  now: number,
  deviceId: string
): PromptTemplateTombstone {
  if (!validSyncTime(now) || !deviceId) throw new Error("invalid_prompt_template");
  return { id: template.id, updatedAt: now, deletedAt: now, deviceId };
}

export function isStoredPromptTemplate(value: unknown): value is StoredPromptTemplate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PromptTemplate> & Partial<PromptTemplateTombstone>;
  if (typeof item.id !== "string" || !item.id || item.id.length > 128 ||
    typeof item.deviceId !== "string" || !item.deviceId || !validSyncTime(item.updatedAt)) return false;
  if ("deletedAt" in item) return validSyncTime(item.deletedAt);
  return typeof item.name === "string" && !!item.name.trim() && [...item.name].length <= PROMPT_TEMPLATE_NAME_LIMIT &&
    typeof item.text === "string" && !!item.text.trim() && [...item.text].length <= PROMPT_TEMPLATE_TEXT_LIMIT;
}

export function promptTemplatesToStateFragment(
  templates: readonly StoredPromptTemplate[],
  deviceId: string
): Readonly<Record<string, StoredPromptTemplate>> {
  return Object.fromEntries(templates.filter(isStoredPromptTemplate).map((template) => [
    template.id,
    { ...template, deviceId: template.deviceId || deviceId }
  ]));
}
