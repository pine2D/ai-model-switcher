import type { ArchiveService } from "./archive-service";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type {
  BroadcastPayload,
  CollectedAnswer,
  SiteRunResult
} from "../shared/protocol";
import {
  buildSynthesisPrompt,
  validateSynthesisRequest,
  type PendingSynthesis,
  type SynthesisCandidate,
  type SynthesisSendRequest,
  type SynthesisSendResponse
} from "../shared/synthesis";

interface SynthesisServiceOptions {
  readonly sites: readonly SiteDefinition[];
  readonly archives: ArchiveService;
  readonly navigate: (site: SiteKey, url: string) => Promise<void>;
  readonly send: (request: BroadcastPayload) => Promise<SiteRunResult[]>;
  readonly collect: (sites: readonly SiteKey[], runId: string | null) => Promise<CollectedAnswer[]>;
  readonly showTarget: (site: SiteKey) => void;
  readonly recordHistory: (text: string) => void;
  readonly beforeSend?: () => void;
  readonly now?: () => number;
}

function archiveId(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const id = (value as { archiveId?: unknown }).archiveId;
  if (typeof id !== "string" || !id.trim() || id.length > 128) throw new Error("invalid_request");
  return id;
}

export class SynthesisService {
  private readonly now: () => number;
  private pending: PendingSynthesis | null = null;
  private candidate: SynthesisCandidate | null = null;
  private activeController: AbortController | null = null;

  constructor(private readonly options: SynthesisServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getPending(): PendingSynthesis | null {
    return this.pending;
  }

  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  async send(value: unknown): Promise<SynthesisSendResponse> {
    const id = archiveId(value);
    const record = this.options.archives.get(id);
    if (!record) throw new Error("archive_not_found");
    const error = validateSynthesisRequest(value, record);
    if (error) throw new Error(error);
    const request = value as SynthesisSendRequest;
    const site = this.options.sites.find((item) => item.key === request.targetSite);
    if (!site) throw new Error("target_missing");
    const text = buildSynthesisPrompt({
      record,
      selectedHosts: request.selectedHosts,
      instruction: request.instruction
    });
    this.options.beforeSend?.();
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const navigationCode = await this.navigate(site.key, site.url, controller.signal);
      if (navigationCode) return { result: { site: site.key, ok: false, code: navigationCode }, pending: null };
      const [result] = await this.options.send({ text, tier: request.tier, sites: [site.key], images: [] });
      const outcome = controller.signal.aborted
        ? { site: site.key, ok: false, code: "cancelled" }
        : result ?? { site: site.key, ok: false, code: "invalid_response" };
      if (!outcome.ok) return { result: outcome, pending: null };
      try { this.options.recordHistory(text); } catch { /* A confirmed send must remain usable if local history fails. */ }
      this.pending = {
        archiveId: record.id,
        targetSite: site.key,
        targetHost: site.host,
        tier: request.tier,
        instruction: request.instruction.trim(),
        sentAt: this.now()
      };
      this.candidate = null;
      this.options.showTarget(site.key);
      return { result: outcome, pending: this.pending };
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  async collect(): Promise<SynthesisCandidate> {
    const pending = this.pending;
    if (!pending || !this.options.archives.get(pending.archiveId)) throw new Error("synthesis_not_pending");
    const results = await this.options.collect([pending.targetSite], null);
    const answer = results.find((result) => result.site === pending.targetSite && !!result.text?.trim());
    if (!answer?.text) throw new Error("synthesis_collect_failed");
    this.candidate = {
      host: pending.targetHost,
      text: answer.text,
      state: answer.state === "think" || answer.state === "fast" ? answer.state : null,
      instruction: pending.instruction,
      createdAt: this.now()
    };
    return this.candidate;
  }

  async save(replaceExisting: boolean): Promise<ReturnType<ArchiveService["update"]>> {
    const pending = this.pending;
    const candidate = this.candidate;
    if (!pending || !candidate) throw new Error("synthesis_not_collected");
    const record = this.options.archives.get(pending.archiveId);
    if (!record) throw new Error("archive_not_found");
    if (record.synthesis && !replaceExisting) throw new Error("replace_confirmation_required");
    const saved = this.options.archives.update(record.id, {
      synthesis: { ...candidate, state: candidate.state ?? pending.tier }
    });
    this.pending = null;
    this.candidate = null;
    return saved;
  }

  private navigate(site: SiteKey, url: string, signal: AbortSignal): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (code: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(code);
      };
      const onAbort = () => finish("cancelled");
      const timer = setTimeout(() => finish("timeout"), 22_000);
      signal.addEventListener("abort", onAbort, { once: true });
      this.options.navigate(site, url).then(() => finish(null), () => finish("not_ready"));
    });
  }
}
