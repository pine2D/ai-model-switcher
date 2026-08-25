export interface PromptKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

export function commandKeyAction(
  event: PromptKeyEvent,
  submitBlocked = false
): "submit" | "collapse" | null {
  if (event.isComposing) return null;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    return submitBlocked ? null : "submit";
  }
  return event.key === "Escape" ? "collapse" : null;
}
