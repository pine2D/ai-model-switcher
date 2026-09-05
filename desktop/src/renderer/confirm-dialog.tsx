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
  const onCancelRef = useRef(props.onCancel);
  onCancelRef.current = props.onCancel;

  // 焦点圈在弹层内、Escape 只关弹层：键盘事件挂在 window 的捕获阶段——挂在 scrim 的 React onKeyDown 上
  // 有两个洞：宿主页面（设置页、工作区抽屉）自己的 window Escape 监听会同时收到事件把整页关掉；
  // 点一下背景后焦点落到 body，事件不再经过 scrim，Tab 就走到弹层背后的控件上去了。
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onCancelRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current?.contains(active);
      if (!inside || (event.shiftKey && active === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      opener?.focus();
    };
  }, []);

  return (
    <div className="confirm-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); panelRef.current?.focus(); } }}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        tabIndex={-1}
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
