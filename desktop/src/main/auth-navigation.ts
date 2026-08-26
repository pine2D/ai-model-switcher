import type { NavigationDisposition } from "./navigation";

export class PostAuthReloadTracker {
  private armed = false;

  constructor(private readonly enabled: boolean) {}

  observe(disposition: NavigationDisposition, isMainFrame: boolean): void {
    if (this.enabled && isMainFrame && disposition === "auth") this.armed = true;
  }

  shouldReload(disposition: NavigationDisposition): boolean {
    if (!this.enabled || !this.armed || disposition !== "site") return false;
    this.armed = false;
    return true;
  }
}
