import type { SiteKey } from "../shared/contracts";
import type { GenerationState, SitePhase } from "../shared/protocol";

interface GenerationEntry {
  observedGenerating: boolean;
  phase: "submitted" | "generating" | "complete";
}

export class GenerationMonitor {
  private runId: string | null = null;
  private readonly entries = new Map<SiteKey, GenerationEntry>();

  begin(runId: string, sites: readonly SiteKey[]): void {
    this.runId = runId;
    this.entries.clear();
    for (const site of sites) {
      this.entries.set(site, { observedGenerating: false, phase: "submitted" });
    }
  }

  invalidate(): void {
    this.runId = null;
    this.entries.clear();
  }

  accepts(runId: string, site: SiteKey): boolean {
    return this.runId === runId && this.entries.has(site);
  }

  accept(runId: string, site: SiteKey, state: GenerationState): SitePhase | null {
    if (this.runId !== runId) return null;
    const entry = this.entries.get(site);
    if (!entry) return null;
    if (entry.phase === "complete") return "complete";
    if (state === "generating") {
      entry.observedGenerating = true;
      entry.phase = "generating";
    } else if (state === "complete" && entry.observedGenerating) {
      entry.phase = "complete";
    }
    return entry.phase;
  }
}
