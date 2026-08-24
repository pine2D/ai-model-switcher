import { randomUUID } from "node:crypto";

import type { WebContents } from "electron";

import type {
  SiteCommand,
  SiteCommandResponse,
  SiteResponseEnvelope
} from "../shared/protocol";

interface PendingCommand {
  readonly contentsId: number;
  readonly resolve: (result: SiteCommandResponse) => void;
  readonly timer: NodeJS.Timeout;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

interface SendOptions {
  readonly timeoutResult: SiteCommandResponse;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class SiteCommandChannel {
  private readonly pending = new Map<string, PendingCommand>();

  send(
    contents: WebContents,
    command: SiteCommand,
    options: SendOptions
  ): Promise<SiteCommandResponse> {
    const remaining = Math.max(0, command.deadline - Date.now());
    if (remaining === 0) return Promise.resolve(options.timeoutResult);
    if (options.signal?.aborted) return Promise.resolve({ ok: false, code: "cancelled" });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const finish = (result: SiteCommandResponse) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener("abort", pending.onAbort);
        }
        this.pending.delete(requestId);
        resolve(result);
      };
      const timer = setTimeout(() => finish(options.timeoutResult), remaining);
      const onAbort = options.signal ? () => {
        if (!this.pending.has(requestId)) return;
        options.onAbort?.();
        finish({ ok: false, code: "cancelled" });
      } : undefined;
      this.pending.set(requestId, {
        contentsId: contents.id,
        resolve,
        timer,
        signal: options.signal,
        onAbort
      });
      if (options.signal && onAbort) options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) { onAbort?.(); return; }
      contents.send("polyask:site-command", { requestId, command });
    });
  }

  receive(sender: WebContents, envelope: SiteResponseEnvelope): void {
    if (!envelope || typeof envelope.requestId !== "string" || !envelope.result) return;
    const pending = this.pending.get(envelope.requestId);
    if (!pending || pending.contentsId !== sender.id) return;
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.pending.delete(envelope.requestId);
    pending.resolve(envelope.result);
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      pending.resolve({ ok: false, code: "cancelled" });
    }
    this.pending.clear();
  }
}
