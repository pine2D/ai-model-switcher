export const COMPLETION_NOTIFICATIONS_KEY = "polyask.desktop.completion-notifications.v1";

export function loadCompletionNotifications(storage: Storage): boolean {
  try { return storage.getItem(COMPLETION_NOTIFICATIONS_KEY) === "true"; }
  catch { return false; }
}

export function saveCompletionNotifications(storage: Storage, enabled: boolean): boolean {
  try { storage.setItem(COMPLETION_NOTIFICATIONS_KEY, String(enabled)); return true; }
  catch { return false; }
}
