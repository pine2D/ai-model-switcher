import { useState } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { ConfirmDialog } from "./confirm-dialog";
import { shell } from "./shell-api";

type LocalDataAction = "history" | "archives" | "reset";

interface LocalDataCardProps {
  readonly copy: DesktopCopy;
  readonly busy: boolean;
  readonly onBusy: (value: boolean) => void;
  readonly onFeedback: (message: string) => void;
  readonly onStatus: (status: SyncStatus) => void;
  /** 重置成功后由外壳清掉只存在渲染层的状态（提问草稿）。 */
  readonly onReset?: () => void;
}

const CONFIRM_COPY: Record<LocalDataAction, { readonly title: keyof DesktopCopy; readonly message: keyof DesktopCopy }> = {
  history: { title: "clearHistoryConfirmTitle", message: "clearHistoryConfirmMessage" },
  archives: { title: "clearArchivesConfirmTitle", message: "clearArchivesConfirmMessage" },
  reset: { title: "resetLocalConfirmTitle", message: "resetLocalConfirmMessage" }
};

// 三个破坏性入口都先过应用内确认框（沿用新建会话的样式，默认焦点在取消上），确认后才真的动数据。
export function LocalDataCard(props: LocalDataCardProps): React.JSX.Element {
  const [pending, setPending] = useState<LocalDataAction | null>(null);

  const run = async (action: LocalDataAction): Promise<void> => {
    props.onBusy(true);
    try {
      if (action === "history") {
        props.onFeedback(formatCopy(props.copy.localDataHistoryCleared, { count: await shell.clearHistory() }));
      } else if (action === "archives") {
        props.onFeedback(formatCopy(props.copy.localDataArchivesCleared, { count: await shell.clearArchives() }));
      } else {
        props.onStatus(await shell.resetLocalData());
        props.onReset?.();
        props.onFeedback(props.copy.localDataReset);
      }
    } catch {
      props.onFeedback(props.copy.localDataActionFailed);
    } finally {
      props.onBusy(false);
    }
  };

  return (
    <section className="settings-card danger-zone" aria-labelledby="local-data-title">
      <h2 id="local-data-title">{props.copy.localDataTitle}</h2>
      <p>{props.copy.localDataDescription}</p>
      <div className="settings-actions">
        <button type="button" disabled={props.busy} onClick={() => setPending("history")}>{props.copy.clearHistoryAction}</button>
        <button type="button" disabled={props.busy} onClick={() => setPending("archives")}>{props.copy.clearArchivesAction}</button>
        <button type="button" disabled={props.busy} onClick={() => setPending("reset")}>{props.copy.resetLocalAction}</button>
      </div>
      <p className="sync-privacy">{props.copy.localDataCloudUntouched}</p>
      {pending ? (
        <ConfirmDialog
          copy={props.copy}
          title={props.copy[CONFIRM_COPY[pending].title]}
          message={props.copy[CONFIRM_COPY[pending].message]}
          confirmLabel={props.copy.localDataConfirm}
          cancelLabel={props.copy.cancel}
          onConfirm={() => { const action = pending; setPending(null); void run(action); }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </section>
  );
}
