import {
  DEFAULT_DISPLAY_PREFERENCES,
  parseDisplayPreferences,
  type DisplayPreferences
} from "../shared/display";

const DISPLAY_STORAGE_KEY = "polyask.display";

export interface DisplayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadDisplayPreferences(
  storage: DisplayStorage,
  coarsePointer: boolean
): DisplayPreferences {
  const raw = storage.getItem(DISPLAY_STORAGE_KEY);
  if (raw === null) {
    return coarsePointer
      ? { ...DEFAULT_DISPLAY_PREFERENCES, density: "comfortable" }
      : DEFAULT_DISPLAY_PREFERENCES;
  }
  try {
    return parseDisplayPreferences(JSON.parse(raw)) ?? DEFAULT_DISPLAY_PREFERENCES;
  } catch {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
}

export function saveDisplayPreferences(storage: DisplayStorage, value: unknown): boolean {
  const preferences = parseDisplayPreferences(value);
  if (!preferences) return false;
  storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(preferences));
  return true;
}
