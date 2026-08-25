import type { BroadcastRun } from "./broadcast-run";
import type { RunState } from "./command-bar";

export interface BroadcastOperation {
  readonly generation: number;
}

export class ExclusiveActionLock {
  private active = false;

  async run<T>(action: () => Promise<T>): Promise<T | null> {
    if (this.active) return null;
    this.active = true;
    try {
      return await action();
    } finally {
      this.active = false;
    }
  }
}

export class BroadcastFlowState {
  private generation = 0;
  private activeGeneration: number | null = null;
  private currentRun: BroadcastRun | null = null;
  private phase: RunState = "idle";

  get run(): BroadcastRun | null {
    return this.currentRun;
  }

  get runState(): RunState {
    return this.phase;
  }

  begin(clearRun: boolean): BroadcastOperation | null {
    if (this.activeGeneration !== null) return null;
    this.generation += 1;
    this.activeGeneration = this.generation;
    if (clearRun) this.currentRun = null;
    this.phase = "sending";
    return { generation: this.generation };
  }

  commit(operation: BroadcastOperation, run: BroadcastRun): boolean {
    if (!this.isCurrent(operation)) return false;
    this.currentRun = run;
    return true;
  }

  settle(operation: BroadcastOperation): boolean {
    if (operation.generation !== this.activeGeneration) return false;
    this.activeGeneration = null;
    this.phase = "idle";
    return true;
  }

  cancel(): void {
    this.phase = "cancelling";
  }

  invalidate(): void {
    this.generation += 1;
    this.currentRun = null;
    if (this.activeGeneration === null) this.phase = "idle";
  }

  isCurrent(operation: BroadcastOperation): boolean {
    return operation.generation === this.generation;
  }
}

export async function runWithBroadcastLock<T>(
  state: BroadcastFlowState,
  clearRun: boolean,
  task: (operation: BroadcastOperation) => Promise<T>,
  onSettled: () => void
): Promise<T | null> {
  const operation = state.begin(clearRun);
  if (!operation) return null;
  try {
    return await task(operation);
  } finally {
    if (state.settle(operation)) onSettled();
  }
}

export function cancelBroadcast(
  state: BroadcastFlowState,
  publish: (runState: RunState) => void,
  cancelIpc: () => void
): void {
  state.cancel();
  publish(state.runState);
  cancelIpc();
}
