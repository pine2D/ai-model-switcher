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
