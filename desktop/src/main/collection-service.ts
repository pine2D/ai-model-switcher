import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { CollectedAnswer, SiteCollectionResult } from "../shared/protocol";

export type CollectDispatch = (
  site: SiteKey,
  deadline: number
) => Promise<SiteCollectionResult>;

interface ActiveCollectionRun {
  readonly runId: string;
  readonly sites: ReadonlySet<SiteKey>;
  readonly generation: number;
}

export class CollectionService {
  private activeRun: ActiveCollectionRun | null = null;
  private generation = 0;

  constructor(
    private readonly definitions: readonly SiteDefinition[],
    private readonly dispatch: CollectDispatch,
    private readonly now: () => number = Date.now
  ) {}

  beginRun(runId: string, sites: readonly SiteKey[]): void {
    if (!runId || runId.length > 128) throw new Error("invalid_run_id");
    const next = new Set(sites);
    if (this.activeRun?.runId === runId) {
      if ([...next].some((site) => !this.activeRun!.sites.has(site))) throw new Error("stale_run");
      this.activeRun = {
        runId,
        sites: this.activeRun.sites,
        generation: ++this.generation
      };
      return;
    }
    this.activeRun = { runId, sites: next, generation: ++this.generation };
  }

  clearRun(): void {
    this.generation += 1;
    this.activeRun = null;
  }

  async collect(sites: readonly SiteKey[], runId: string | null): Promise<CollectedAnswer[]> {
    let context: ActiveCollectionRun | null = null;
    if (runId !== null) {
      if (this.activeRun?.runId !== runId || sites.some((site) => !this.activeRun!.sites.has(site))) {
        throw new Error("stale_run");
      }
      context = this.activeRun;
    }
    const selected = new Set(sites);
    const deadline = this.now() + 8_000;
    const answers = await Promise.all(this.definitions.filter((site) => selected.has(site.key)).map(async (site) => {
      try {
        const result = await this.dispatch(site.key, deadline);
        const text = typeof result.text === "string" && result.text.trim() ? result.text : null;
        return {
          site: site.key,
          host: site.host,
          label: site.label,
          text,
          ...(result.state ? { state: result.state } : {}),
          ...(!text ? { code: result.code || "no_answer" } : result.code ? { code: result.code } : {})
        } satisfies CollectedAnswer;
      } catch {
        return { site: site.key, host: site.host, label: site.label, text: null, code: "not_ready" };
      }
    }));
    if (context && (this.activeRun !== context || this.activeRun.generation !== context.generation)) {
      throw new Error("stale_run");
    }
    return answers;
  }
}
