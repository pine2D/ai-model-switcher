import type { SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";

export interface BroadcastRun {
  readonly request: BroadcastRequest;
  readonly results: ReadonlyMap<SiteKey, SiteRunResult>;
}

export function completeRun(
  request: BroadcastRequest,
  results: readonly SiteRunResult[]
): BroadcastRun {
  return {
    request,
    results: new Map(
      results
        .filter((result) => request.sites.includes(result.site))
        .map((result) => [result.site, result])
    )
  };
}

export function mergeRunResults(
  run: BroadcastRun,
  results: readonly SiteRunResult[]
): BroadcastRun {
  const merged = new Map(run.results);
  for (const result of results) {
    if (run.request.sites.includes(result.site)) merged.set(result.site, result);
  }
  return { request: run.request, results: merged };
}

export function failedRunSites(run: BroadcastRun): SiteKey[] {
  return run.request.sites.filter((site) => {
    const result = run.results.get(site);
    return result?.ok === false && result.code !== "cancelled";
  });
}

export function cancelledRunSites(run: BroadcastRun): SiteKey[] {
  return run.request.sites.filter((site) => {
    const result = run.results.get(site);
    return result?.ok === false && result.code === "cancelled";
  });
}

export function retryRequest(run: BroadcastRun): BroadcastRequest | null {
  const sites = run.request.sites.filter((site) => run.results.get(site)?.ok === false);
  return sites.length ? { ...run.request, sites } : null;
}

export function runCoversSites(run: BroadcastRun, sites: readonly SiteKey[]): boolean {
  return sites.length > 0 && sites.every((site) => run.request.sites.includes(site));
}
