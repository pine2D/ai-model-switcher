export type ActionFailure = string | ((error: unknown) => string);

export class SerialActions {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly onBusy: (value: boolean) => void,
    private readonly onFailure: (message: string) => void
  ) {}

  run(action: () => Promise<void>, failure: ActionFailure): Promise<void> {
    if (++this.pending === 1) this.onBusy(true);
    const current = this.tail.then(action).catch((error) => {
      this.onFailure(typeof failure === "function" ? failure(error) : failure);
    }).finally(() => {
      if (--this.pending === 0) this.onBusy(false);
    });
    this.tail = current;
    return current;
  }
}
