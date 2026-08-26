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

export function pageTabKeyAction(
  key: string,
  current: number,
  count: number
): { readonly focus: number; readonly activate: boolean } | null {
  if (count <= 1) return null;
  if (key === "Enter" || key === " ") return { focus: current, activate: true };
  if (key === "Home") return { focus: 0, activate: false };
  if (key === "End") return { focus: count - 1, activate: false };
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const offset = key === "ArrowRight" ? 1 : -1;
  return { focus: (current + offset + count) % count, activate: false };
}
