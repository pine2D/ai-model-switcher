export function isTrustedShellUrl(candidate: string, entry: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(entry);
    actual.hash = "";
    expected.hash = "";
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
