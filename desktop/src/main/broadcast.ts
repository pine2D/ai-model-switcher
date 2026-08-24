import type { SiteKey } from "../shared/contracts";
import type {
  BroadcastRequest,
  SiteCommand,
  SiteResult,
  SiteRunResult
} from "../shared/protocol";

export type SiteDispatch = (
  site: SiteKey,
  command: SiteCommand,
  signal: AbortSignal
) => Promise<SiteResult>;

export type ResultObserver = (result: SiteRunResult) => void;

export class BroadcastCoordinator {
  private epoch = 0;
  private activeController: AbortController | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}

  cancel(): void {
    this.epoch += 1;
    this.activeController?.abort();
    this.activeController = null;
  }

  async send(
    request: BroadcastRequest,
    dispatch: SiteDispatch,
    timeoutMs: number,
    onResult?: ResultObserver
  ): Promise<SiteRunResult[]> {
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    const epoch = ++this.epoch;
    const deadline = this.now() + Math.max(1, timeoutMs);

    const results = await Promise.all(
      request.sites.map(async (site): Promise<SiteRunResult> => {
        const command: SiteCommand = {
          source: "AMS",
          cmd: "submitPrompt",
          text: request.text,
          tier: request.tier,
          deadline,
          images: request.images
        };
        const result = await this.dispatchUntilTerminal(
          site,
          command,
          dispatch,
          epoch,
          controller.signal
        );
        if (epoch !== this.epoch) {
          const cancelled = { site, ok: false, code: "cancelled" } as const;
          onResult?.(cancelled);
          return cancelled;
        }
        const output: SiteRunResult = { site, ok: result.ok };
        const observed = result.code ? { ...output, code: result.code } : output;
        onResult?.(observed);
        return observed;
      })
    );
    if (this.activeController === controller) this.activeController = null;
    return results;
  }

  private async dispatchUntilTerminal(
    site: SiteKey,
    command: SiteCommand,
    dispatch: SiteDispatch,
    epoch: number,
    signal: AbortSignal
  ): Promise<SiteResult> {
    for (;;) {
      if (epoch !== this.epoch) return { ok: false, code: "cancelled" };
      if (this.now() >= command.deadline) return { ok: false, code: "timeout" };
      let result: SiteResult;
      try {
        result = await dispatch(site, command, signal);
      } catch (error) {
        return {
          ok: false,
          code: "submit_unconfirmed",
          reason: error instanceof Error ? error.message : String(error)
        };
      }
      if (epoch !== this.epoch) return { ok: false, code: "cancelled" };
      if (result.code !== "composer_not_found" && result.code !== "not_ready") return result;
      const remaining = Math.max(0, command.deadline - this.now());
      if (remaining === 0) return { ok: false, code: "timeout" };
      await this.wait(Math.min(500, remaining));
    }
  }
}
