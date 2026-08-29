import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { DesktopUiState } from "../shared/desktop-ui-state";

export class UiStateStore {
  private pending: DesktopUiState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly path: string) {}

  load(): unknown | null {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  save(state: DesktopUiState): boolean {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, this.path);
      return true;
    } catch {
      try { unlinkSync(temporaryPath); } catch { /* The temporary file may not exist. */ }
      return false;
    }
  }

  schedule(state: DesktopUiState, delay = 250): void {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const state = this.pending;
    this.pending = null;
    this.save(state);
  }

  dispose(): void {
    this.flush();
  }
}
