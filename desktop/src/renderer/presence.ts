import { useEffect, useState } from "react";

export function usePresence(open: boolean, exitMs: number): boolean {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, open]);
  return present;
}
