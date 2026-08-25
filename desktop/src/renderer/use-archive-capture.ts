import { useRef } from "react";

import type { ArchiveInput, ArchiveRecord } from "../shared/archive";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { runCoversSites, type BroadcastRun } from "./broadcast-run";

interface ArchiveCaptureInput {
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly prompt: string;
}

export function useArchiveCapture(input: ArchiveCaptureInput): {
  readonly remember: (run: BroadcastRun) => void;
  readonly invalidate: () => void;
  readonly capture: () => Promise<ArchiveRecord>;
} {
  const lastRun = useRef<BroadcastRun | null>(null);
  const remember = (run: BroadcastRun) => {
    if (![...run.results.values()].some((result) => result.ok)) return;
    lastRun.current = run;
  };
  const invalidate = (): void => { lastRun.current = null; };
  const capture = async (): Promise<ArchiveRecord> => {
    const selectedSites = input.sites.filter((site) => input.selected.has(site.key));
    if (!selectedSites.length) throw new Error("no_selected_sites");
    const selectedKeys = selectedSites.map((site) => site.key);
    const matchingRun = lastRun.current && runCoversSites(lastRun.current, selectedKeys)
      ? lastRun.current
      : null;
    const text = matchingRun?.request.text || input.prompt.trim();
    if (!text) throw new Error("no_prompt");
    const answers = await window.polyask.collectAnswers({
      sites: selectedKeys,
      runId: matchingRun?.request.runId ?? null
    });
    const entry: ArchiveInput = {
      text,
      task: text,
      source: null,
      ts: Date.now(),
      results: answers.map((answer) => ({
        host: answer.host,
        label: answer.label,
        text: answer.text,
        ...(answer.state ? { state: answer.state } : {}),
        ...(answer.code ? { code: answer.code } : {})
      }))
    };
    return window.polyask.addArchive(entry);
  };
  return { remember, invalidate, capture };
}
