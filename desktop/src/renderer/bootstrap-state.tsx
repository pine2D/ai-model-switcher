import type { DesktopCopy } from "../shared/copy";
import type { BootstrapPhase } from "./bootstrap-model";

interface BootstrapStateViewProps {
  readonly copy: DesktopCopy;
  readonly phase: Exclude<BootstrapPhase, "ready">;
  readonly announcement: string;
  readonly onRetry: () => void;
}

export function BootstrapStateView({
  copy,
  phase,
  announcement,
  onRetry
}: BootstrapStateViewProps): React.JSX.Element {
  const loading = phase === "loading";
  return (
    <main className="shell-bootstrap" aria-busy={loading || undefined}>
      <header className="bootstrap-bar">
        {loading ? (
          <p role="status" aria-live="polite">{copy.shellLoading}</p>
        ) : (
          <>
            <p role="alert">{copy.shellLoadFailed}</p>
            <button
              type="button"
              title={copy.retryShellLoad}
              aria-label={copy.retryShellLoad}
              onClick={onRetry}
            >
              {copy.retryShellLoad}
            </button>
          </>
        )}
      </header>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </main>
  );
}
