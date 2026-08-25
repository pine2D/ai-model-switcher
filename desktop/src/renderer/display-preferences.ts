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

export interface DisplayDensityTarget {
  readonly dataset: { density?: string };
}

export function loadDisplayPreferences(
  storage: DisplayStorage,
  coarsePointer: boolean
): DisplayPreferences {
  const fallback = coarsePointer
    ? { ...DEFAULT_DISPLAY_PREFERENCES, density: "comfortable" as const }
    : DEFAULT_DISPLAY_PREFERENCES;
  try {
    const raw = storage.getItem(DISPLAY_STORAGE_KEY);
    return raw === null ? fallback : parseDisplayPreferences(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveDisplayPreferences(storage: DisplayStorage, value: unknown): boolean {
  const preferences = parseDisplayPreferences(value);
  if (!preferences) return false;
  try {
    storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function applyDisplayDensity(
  target: DisplayDensityTarget,
  value: DisplayPreferences
): void {
  target.dataset.density = value.density;
}

export function applyDisplayPreferences(
  target: DisplayDensityTarget,
  storage: DisplayStorage,
  value: DisplayPreferences,
  onPersistenceFailure: () => void
): void {
  applyDisplayDensity(target, value);
  if (!saveDisplayPreferences(storage, value)) onPersistenceFailure();
}
