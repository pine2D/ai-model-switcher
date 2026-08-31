import type { SiteKey } from "../shared/contracts";
import type { GenerationState, SitePhase } from "../shared/protocol";

// Consecutive "complete" readings required before a site settles on the terminal
// phase. Probes run every 900ms, so three readings span ~1.8s and survive the
// single-frame blind spots of the read-only detector (a stop control that
// re-renders at 0x0, a paused stream that resumes). Never infer completion from
// answer text that stopped growing — docs/desktop-workbench-ux.md 10.2.
const COMPLETE_CONFIRMATIONS = 3;

interface GenerationEntry {
  observedGenerating: boolean;
  completeStreak: number;
  phase: "submitted" | "generating" | "complete";
}

export class GenerationMonitor {
  private runId: string | null = null;
  private readonly entries = new Map<SiteKey, GenerationEntry>();

  // Retrying a failed subset reuses the run id, so the same run resumes: entries
  // already being watched survive and only the missing sites are added. A run
  // that was invalidated (cancel, shutdown) cannot be resumed — every site was
  // reported cancelled and the retry carries them all — so the next begin with
  // the same id deliberately starts over from the submitted sites alone.
  // Returns true when an existing run was resumed.
  begin(runId: string, sites: readonly SiteKey[]): boolean {
    const resumed = this.runId === runId;
    if (!resumed) {
      this.runId = runId;
      this.entries.clear();
    }
    for (const site of sites) {
      if (this.entries.has(site)) continue;
      this.entries.set(site, { observedGenerating: false, completeStreak: 0, phase: "submitted" });
    }
    return resumed;
  }

  invalidate(): void {
    this.runId = null;
    this.entries.clear();
  }

  forget(site: SiteKey): void {
    this.entries.delete(site);
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
      entry.completeStreak = 0;
      entry.phase = "generating";
    } else if (state === "idle") {
      entry.completeStreak = 0;
    } else if (state === "complete" && entry.observedGenerating) {
      entry.completeStreak += 1;
      if (entry.completeStreak >= COMPLETE_CONFIRMATIONS) entry.phase = "complete";
    }
    // state === null carries no information: it neither confirms nor resets the
    // streak, so an intermittent probe failure cannot strand a finished answer.
    return entry.phase;
  }
}
