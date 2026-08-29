import type { SiteStatus } from "../shared/protocol";

interface NotificationCopy {
  readonly title: string;
  readonly complete: (site: string) => string;
  readonly failed: (site: string) => string;
}

interface CompletionNotifierOptions {
  readonly copy: NotificationCopy;
  readonly focused: () => boolean;
  readonly show: (notification: { readonly title: string; readonly body: string }) => void;
}

export class CompletionNotifier {
  private enabled = false;
  private readonly delivered = new Set<string>();

  constructor(private readonly options: CompletionNotifierOptions) {}

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  accept(status: SiteStatus, siteLabel: string): boolean {
    const terminal = status.phase === "complete" || status.phase === "failed" || status.phase === "crashed";
    if (!terminal) {
      for (const key of this.delivered) if (key.startsWith(`${status.site}:`)) this.delivered.delete(key);
      return false;
    }
    const key = `${status.site}:${status.phase}`;
    if (!this.enabled || this.options.focused() || !status.unread || this.delivered.has(key)) return false;
    this.delivered.add(key);
    this.options.show({
      title: this.options.copy.title,
      body: status.phase === "complete"
        ? this.options.copy.complete(siteLabel)
        : this.options.copy.failed(siteLabel)
    });
    return true;
  }
}
