import { useRef } from "react";

import type { ArchiveInput, ArchiveRecord } from "../shared/archive";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";

interface LastRun {
  readonly runId: string;
  readonly text: string;
  readonly sites: readonly SiteKey[];
}

interface ArchiveCaptureInput {
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly prompt: string;
}

function sameSites(left: readonly SiteKey[], right: readonly SiteKey[]): boolean {
  return left.length === right.length && left.every((site, index) => site === right[index]);
}

export function useArchiveCapture(input: ArchiveCaptureInput): {
  readonly remember: (request: BroadcastRequest, results: readonly SiteRunResult[]) => void;
  readonly capture: () => Promise<ArchiveRecord>;
} {
  const lastRun = useRef<LastRun | null>(null);
  const remember = (request: BroadcastRequest, results: readonly SiteRunResult[]) => {
    if (!results.some((result) => result.ok)) return;
    lastRun.current = {
      runId: crypto.randomUUID(),
      text: request.text,
      sites: [...request.sites]
    };
  };
  const capture = async (): Promise<ArchiveRecord> => {
    const selectedSites = input.sites.filter((site) => input.selected.has(site.key));
    if (!selectedSites.length) throw new Error("no_selected_sites");
    const selectedKeys = selectedSites.map((site) => site.key);
    const matchingRun = lastRun.current && sameSites(lastRun.current.sites, selectedKeys)
      ? lastRun.current
      : null;
    const text = matchingRun?.text || input.prompt.trim();
    if (!text) throw new Error("no_prompt");
    const answers = await window.polyask.collectAnswers({
      sites: selectedKeys,
      runId: matchingRun?.runId ?? null
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
  return { remember, capture };
}
