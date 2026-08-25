export type BootstrapPhase = "loading" | "ready" | "failed";

export async function loadBootstrap<State>(
  load: () => Promise<State>,
  accept: (state: State) => void
): Promise<Exclude<BootstrapPhase, "loading">> {
  try {
    accept(await load());
    return "ready";
  } catch {
    return "failed";
  }
}
