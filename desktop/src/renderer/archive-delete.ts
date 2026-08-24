export interface ArmedArchiveDelete {
  readonly id: string;
  readonly until: number;
}

export const ARCHIVE_DELETE_CONFIRM_MS = 3_000;

export type ArchiveDeleteIntent =
  | { readonly action: "arm"; readonly armed: ArmedArchiveDelete }
  | { readonly action: "delete"; readonly armed: null };

export function deleteIntent(
  armed: ArmedArchiveDelete | null,
  id: string,
  now: number
): ArchiveDeleteIntent {
  if (armed?.id === id && armed.until >= now) return { action: "delete", armed: null };
  return { action: "arm", armed: { id, until: now + ARCHIVE_DELETE_CONFIRM_MS } };
}

export function deleteConfirmationRemaining(armed: ArmedArchiveDelete, now: number): number {
  return Math.max(0, armed.until - now);
}
