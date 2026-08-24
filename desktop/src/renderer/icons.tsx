import type { ReactNode } from "react";

interface IconProps {
  readonly children: ReactNode;
}

function Icon({ children }: IconProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function GridIcon(): React.JSX.Element {
  return <Icon><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></Icon>;
}

export function FocusIcon(): React.JSX.Element {
  return <Icon><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><rect x="8" y="8" width="8" height="8" /></Icon>;
}

export function ReloadIcon(): React.JSX.Element {
  return <Icon><path d="M20 6v5h-5M19 11a7 7 0 1 0 .2 3" /></Icon>;
}

export function SendIcon(): React.JSX.Element {
  return <Icon><path d="m4 4 16 8-16 8 3-8-3-8Z" /><path d="M7 12h13" /></Icon>;
}

export function StopIcon(): React.JSX.Element {
  return <Icon><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>;
}
