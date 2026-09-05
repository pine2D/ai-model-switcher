import type { SiteKey } from "../shared/contracts";
import {
  normalizeSubmitted,
  type BroadcastPayload,
  type SiteCode,
  type SiteResult,
  type SiteRunResult,
  type SiteSubmittedResponse,
  type SubmitSiteCommand,
  type WasSubmittedSiteCommand
} from "../shared/protocol";

export type SiteDispatch = (
  site: SiteKey,
  command: SubmitSiteCommand,
  signal: AbortSignal
) => Promise<SiteResult>;

/**
 * 只读探测「这段文字是否已作为末条用户消息发出」；由 ViewManager.confirmSubmitted 实现。
 * 返回 null = 这一次没人应答（页面正在重挂、通道超时），与「站点不支持」是两回事：前者再问一次，后者立刻交用户。
 */
export type SubmittedProbe = (
  site: SiteKey,
  command: WasSubmittedSiteCommand,
  signal: AbortSignal
) => Promise<SiteSubmittedResponse | null>;

export type ResultObserver = (result: SiteRunResult) => void;

export interface SendOptions {
  readonly confirm?: SubmittedProbe;
  /** 只读确认「未提交」后是否允许重发一次；缺省取 POLYASK_KIMI_RESUBMIT。测试必须显式传值。 */
  readonly resubmit?: boolean;
}

// 「提交不确定 ≠ 可以重发」红线的唯一合法例外：站点实现了只读 submitted()（目前仅 Kimi）且明确确认
// 「末条用户消息不是本次内容」，才允许自动重发一次。这个开关是模块常量，不是设置项——用户不该有能力
// 打开一条尚未经真机验证的自动重发路径。F067 两条硬用例（新会话空态、末条是上一轮内容）真机通过前保持 false；
// 通过后改成 true 并随同一次发版发出，未通过则保持 false 发版。
const POLYASK_KIMI_RESUBMIT = false;

// 只有这两个码代表「还没开始提交」，可以在同一 deadline 内等待重试；其它任何码（含新增的）默认不可重试。
const RETRIABLE: ReadonlySet<SiteCode> = new Set<SiteCode>(["composer_not_found", "not_ready"]);
const UNSUPPORTED: SiteSubmittedResponse = { supported: false, ok: false };
const CONFIRM_WINDOW_MS = 1_500;
const CONFIRM_PROBE_MS = 300;

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
    request: BroadcastPayload,
    dispatch: SiteDispatch,
    timeoutMs: number,
    onResult?: ResultObserver,
    options: SendOptions = {}
  ): Promise<SiteRunResult[]> {
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    const epoch = ++this.epoch;
    const deadline = this.now() + Math.max(1, timeoutMs);

    const results = await Promise.all(
      request.sites.map(async (site): Promise<SiteRunResult> => {
        const command: SubmitSiteCommand = {
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
          controller.signal,
          options.confirm,
          options.resubmit ?? POLYASK_KIMI_RESUBMIT
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
    command: SubmitSiteCommand,
    dispatch: SiteDispatch,
    epoch: number,
    signal: AbortSignal,
    confirm: SubmittedProbe | undefined,
    resubmit: boolean
  ): Promise<SiteResult> {
    let resent = false;
    for (;;) {
      if (epoch !== this.epoch) return { ok: false, code: "cancelled" };
      if (this.now() >= command.deadline) return { ok: false, code: "timeout" };
      let result: SiteResult;
      try {
        result = await dispatch(site, command, signal);
      } catch (error) {
        result = {
          ok: false,
          code: "submit_unconfirmed",
          reason: error instanceof Error ? error.message : String(error)
        };
      }
      if (epoch !== this.epoch) return { ok: false, code: "cancelled" };
      if (result.code === "submit_unconfirmed" && confirm) {
        const verdict = await this.confirmSubmitted(site, command, confirm, epoch, signal);
        if (epoch !== this.epoch) return { ok: false, code: "cancelled" };
        if (verdict.supported && verdict.ok) return { ok: true };
        if (!(verdict.supported && resubmit && !resent)) return result;
        resent = true;
      } else if (!result.code || !RETRIABLE.has(result.code as SiteCode)) {
        return result;
      }
      const remaining = Math.max(0, command.deadline - this.now());
      if (remaining === 0) return { ok: false, code: "timeout" };
      await this.wait(Math.min(500, remaining));
    }
  }

  // Kimi 发送后会重挂页面并断开消息端口：给新 content 最多 1.5s 注入并作答。
  // 这个窗口**独立于群发 deadline**：submit_unconfirmed 最常恰好在 deadline 那一刻到达（通道超时、带图时页内
  // confirmSubmitted 跑满绝对线），从剩余预算里抠窗口 = 永远零次探测。只读探测不往页面写任何东西，
  // 不受 deadline 夹取规则约束（CLAUDE.md 已记为例外）。单次探测只给 300ms：一次无人应答（页面重挂中）
  // 不能吃掉整个窗口，也不能被读成「不支持」。
  // 结论：supported 且已见到该消息 → 已提交；supported 且连续 5 次未见 → 未提交；其余一律 unsupported（交用户）。
  private async confirmSubmitted(
    site: SiteKey,
    command: SubmitSiteCommand,
    confirm: SubmittedProbe,
    epoch: number,
    signal: AbortSignal
  ): Promise<SiteSubmittedResponse> {
    const end = this.now() + CONFIRM_WINDOW_MS;
    let misses = 0;
    while (this.now() < end) {
      if (epoch !== this.epoch) return UNSUPPORTED;
      let answer: SiteSubmittedResponse | null = null;
      try {
        const deadline = Math.min(end, this.now() + CONFIRM_PROBE_MS);
        answer = await confirm(site, { source: "AMS", cmd: "wasSubmitted", text: command.text, deadline }, signal);
      } catch {
        answer = null; // 页面重挂中，等新 content 注入
      }
      if (epoch !== this.epoch) return UNSUPPORTED;
      if (answer !== null) {
        const verdict = normalizeSubmitted(answer);
        if (!verdict.supported || verdict.ok) return verdict;
        if (++misses >= 5) return verdict;
      }
      await this.wait(Math.min(150, Math.max(0, end - this.now())));
    }
    return UNSUPPORTED;
  }
}
