import { useRef, useState } from "react";

import type { BroadcastPayload, BroadcastRequest } from "../shared/protocol";
import {
  cancelledRunSites,
  completeRun,
  failedRunSites,
  mergeRunResults,
  retryRequest,
  type BroadcastRun
} from "./broadcast-run";
import {
  BroadcastFlowState,
  cancelBroadcast,
  runWithBroadcastLock
} from "./broadcast-flow-state";
import type { RunState } from "./command-bar";

export function useBroadcastFlow(
  announce: () => void,
  remember: (run: BroadcastRun) => void,
  forget: () => void
): {
  readonly send: (payload: BroadcastPayload) => Promise<BroadcastRun | null>;
  readonly retry: () => Promise<BroadcastRun | null>;
  readonly cancel: () => void;
  readonly invalidate: () => void;
  readonly runState: RunState;
  readonly failureCount: number;
  readonly cancelledCount: number;
} {
  const [run, setRun] = useState<BroadcastRun | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const state = useRef(new BroadcastFlowState()).current;

  const syncState = (): void => {
    setRun(state.run);
    setRunState(state.runState);
  };

  const send = async (payload: BroadcastPayload): Promise<BroadcastRun | null> => {
    return runWithBroadcastLock(state, true, async (operation) => {
      forget();
      syncState();
      try {
        const request: BroadcastRequest = {
          runId: crypto.randomUUID(),
          text: payload.text,
          tier: payload.tier,
          sites: [...payload.sites],
          images: [...payload.images]
        };
        const completed = completeRun(request, await window.polyask.broadcast(request));
        if (!state.commit(operation, completed)) return null;
        setRun(state.run);
        remember(completed);
        return completed;
      } catch {
        if (state.isCurrent(operation)) announce();
        return null;
      }
    }, () => setRunState(state.runState));
  };

  const retry = async (): Promise<BroadcastRun | null> => {
    const current = state.run;
    const request = current && retryRequest(current);
    if (!current || !request) return null;
    return runWithBroadcastLock(state, false, async (operation) => {
      syncState();
      try {
        const merged = mergeRunResults(current, await window.polyask.broadcast(request));
        if (!state.commit(operation, merged)) return null;
        setRun(state.run);
        remember(merged);
        return merged;
      } catch {
        if (state.isCurrent(operation)) announce();
        return null;
      }
    }, () => setRunState(state.runState));
  };

  const cancel = (): void => {
    cancelBroadcast(state, setRunState, window.polyask.cancel);
  };
  const invalidate = (): void => {
    state.invalidate();
    syncState();
    forget();
  };

  return {
    send,
    retry,
    cancel,
    invalidate,
    runState,
    failureCount: run ? failedRunSites(run).length : 0,
    cancelledCount: run ? cancelledRunSites(run).length : 0
  };
}
