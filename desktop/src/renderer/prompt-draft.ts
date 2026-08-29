export const PROMPT_DRAFT_KEY = "polyask.desktop.prompt-draft.v1";

export interface PromptDraft {
  readonly text: string;
  readonly updatedAt: number;
}

const EMPTY_DRAFT: PromptDraft = { text: "", updatedAt: 0 };

export function parsePromptDraft(value: string | null): PromptDraft {
  if (!value) return EMPTY_DRAFT;
  try {
    const parsed = JSON.parse(value) as Partial<PromptDraft>;
    if (typeof parsed.text !== "string" || [...parsed.text].length > 100_000 ||
      !Number.isSafeInteger(parsed.updatedAt) || Number(parsed.updatedAt) < 0) return EMPTY_DRAFT;
    return { text: parsed.text, updatedAt: Number(parsed.updatedAt) };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function loadDraft(storage: Storage): PromptDraft {
  try { return parsePromptDraft(storage.getItem(PROMPT_DRAFT_KEY)); }
  catch { return EMPTY_DRAFT; }
}

export function saveDraft(storage: Storage, text: string, updatedAt = Date.now()): boolean {
  try {
    if (!text) return clearDraft(storage);
    if ([...text].length > 100_000 || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return false;
    storage.setItem(PROMPT_DRAFT_KEY, JSON.stringify({ text, updatedAt }));
    return true;
  } catch { return false; }
}

export function clearDraft(storage: Storage): boolean {
  try { storage.removeItem(PROMPT_DRAFT_KEY); return true; }
  catch { return false; }
}
