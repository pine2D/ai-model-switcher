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

export function ScopeIcon(): React.JSX.Element {
  return <Icon><path d="M4 6h16M4 12h10M4 18h7" /><path d="m16 16 2 2 3-4" /></Icon>;
}

export function NewSessionIcon(): React.JSX.Element {
  return <Icon><path d="M5 5h10v14H5zM15 9h4v10H9" /><path d="M10 9v6M7 12h6" /></Icon>;
}

export function CloseIcon(): React.JSX.Element {
  return <Icon><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function SaveIcon(): React.JSX.Element {
  return <Icon><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></Icon>;
}

export function TrashIcon(): React.JSX.Element {
  return <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon>;
}

export function ImagePlusIcon(): React.JSX.Element {
  return <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 4-4 3 3 2-2 4 4M17 6v6M14 9h6" /></Icon>;
}

export function WarningIcon(): React.JSX.Element {
  return <Icon><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17h.01" /></Icon>;
}

export function ArchiveIcon(): React.JSX.Element {
  return <Icon><path d="M4 7v13h16V7M3 3h18v4H3zM9 11h6" /></Icon>;
}

export function CopyIcon(): React.JSX.Element {
  return <Icon><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>;
}

export function DownloadIcon(): React.JSX.Element {
  return <Icon><path d="M12 3v12m-4-4 4 4 4-4M4 20h16" /></Icon>;
}

export function StarIcon(): React.JSX.Element {
  return <Icon><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></Icon>;
}

export function SparklesIcon(): React.JSX.Element {
  return <Icon><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" /></Icon>;
}

export function SettingsIcon(): React.JSX.Element {
  return <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></Icon>;
}
