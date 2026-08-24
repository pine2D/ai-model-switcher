import { useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type {
  PendingSynthesis,
  SynthesisCandidate,
  SynthesisSendRequest
} from "../shared/synthesis";

export function useSynthesisFlow(): {
  readonly pending: PendingSynthesis | null;
  readonly candidate: SynthesisCandidate | null;
  readonly acceptPending: (value: PendingSynthesis | null) => void;
  readonly send: (request: SynthesisSendRequest) => Promise<PendingSynthesis>;
  readonly collect: () => Promise<string>;
  readonly save: (replaceExisting: boolean) => Promise<ArchiveRecord>;
} {
  const [pending, setPending] = useState<PendingSynthesis | null>(null);
  const [candidate, setCandidate] = useState<SynthesisCandidate | null>(null);
  const acceptPending = (value: PendingSynthesis | null) => {
    setPending(value);
    if (!value) setCandidate(null);
  };
  const send = async (request: SynthesisSendRequest): Promise<PendingSynthesis> => {
    const response = await window.polyask.sendSynthesis(request);
    if (!response.result.ok || !response.pending) throw new Error(response.result.code || "synthesis_send_failed");
    setPending(response.pending);
    setCandidate(null);
    return response.pending;
  };
  const collect = async (): Promise<string> => {
    if (!pending) throw new Error("synthesis_not_pending");
    setCandidate(await window.polyask.collectSynthesis());
    return pending.archiveId;
  };
  const save = async (replaceExisting: boolean): Promise<ArchiveRecord> => {
    const record = await window.polyask.saveSynthesis(replaceExisting);
    setPending(null);
    setCandidate(null);
    return record;
  };
  return { pending, candidate, acceptPending, send, collect, save };
}
