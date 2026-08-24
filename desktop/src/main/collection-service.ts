import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { CollectedAnswer, SiteCollectionResult } from "../shared/protocol";

export type CollectDispatch = (
  site: SiteKey,
  deadline: number
) => Promise<SiteCollectionResult>;

export class CollectionService {
  constructor(
    private readonly definitions: readonly SiteDefinition[],
    private readonly dispatch: CollectDispatch,
    private readonly now: () => number = Date.now
  ) {}

  collect(sites: readonly SiteKey[], runId: string | null): Promise<CollectedAnswer[]> {
    void runId;
    const selected = new Set(sites);
    const deadline = this.now() + 8_000;
    return Promise.all(this.definitions.filter((site) => selected.has(site.key)).map(async (site) => {
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
  }
}
