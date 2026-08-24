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

export function SiteSettingIcon(): React.JSX.Element {
  return <Icon><path d="M3 4h7m4 0h7M3 12h5m4 0h9M3 20h9m4 0h5M12 2v4M10 10v4M14 18v4" /></Icon>;
}

export function FastIcon(): React.JSX.Element {
  return <Icon><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></Icon>;
}

export function DeepThinkIcon(): React.JSX.Element {
  return <Icon><path d="M9.5 5a3 3 0 0 0-5.7 1.3A3 3 0 0 0 4.5 12a3.5 3.5 0 0 0 5 5V5ZM14.5 5a3 3 0 0 1 5.7 1.3 3 3 0 0 1-.7 5.7 3.5 3.5 0 0 1-5 5V5Z" /><path d="M7 9h2.5M14.5 9H17M7 14h2.5M14.5 14H17" /></Icon>;
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
