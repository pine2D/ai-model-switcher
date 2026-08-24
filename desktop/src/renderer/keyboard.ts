export interface PromptKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

export function commandKeyAction(event: PromptKeyEvent): "submit" | "collapse" | null {
  if (event.isComposing) return null;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") return "submit";
  return event.key === "Escape" ? "collapse" : null;
}
