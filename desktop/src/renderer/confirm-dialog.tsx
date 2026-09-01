import { useEffect, useRef } from "react";

import type { DesktopCopy } from "../shared/copy";
import { CloseIcon } from "./icons";

interface ConfirmDialogProps {
  readonly copy: DesktopCopy;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

// 应用内确认层，取代 dialog.showMessageBox 的系统弹框——后者用的是各平台的原生外观，
// 与本应用其余部分格格不入，且在 Linux/Windows 上样式尤其陈旧。
// 默认焦点落在**取消**上（沿用原生弹框 defaultId=1 的语义）：这类动作会离开当前对话，
// 误触的代价不对称，回车不该直接确认。
export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { cancelRef.current?.focus(); }, []);

  // 焦点圈在弹层内：背后是九个站点视图，Tab 跑出去就再也回不来。
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") { event.preventDefault(); props.onCancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="confirm-scrim" onKeyDown={onKeyDown}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        ref={panelRef}
      >
        <header>
          <h2 id="confirm-title">{props.title}</h2>
          <button type="button" className="confirm-close" title={props.cancelLabel} aria-label={props.cancelLabel} onClick={props.onCancel}><CloseIcon /></button>
        </header>
        <p id="confirm-message">{props.message}</p>
        <div className="confirm-actions">
          <button type="button" ref={cancelRef} onClick={props.onCancel}>{props.cancelLabel}</button>
          <button type="button" className="primary" onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
