import type { DesktopCopy } from "./copy";

export type CommandId =
  | "open-command-palette"
  | "open-sites"
  | "open-site-health"
  | "show-page-1"
  | "show-page-2"
  | "show-page-3"
  | "next-page"
  | "previous-page"
  | "next-site"
  | "previous-site"
  | "site-back"
  | "site-forward"
  | "focus-prompt"
  | "set-think"
  | "set-fast"
  | "collect-answers"
  | "open-archive"
  | "collect-synthesis"
  | "retry-failed"
  | "new-session"
  | "open-settings"
  | "open-drive-diagnostics"
  | "open-shortcuts"
  | "next-unfinished"
  | "next-failed"
  | "check-updates";

export type CommandGroup = "navigate" | "compose" | "results" | "app";

export interface CommandDescriptor {
  readonly id: CommandId;
  readonly labelKey: keyof DesktopCopy;
  readonly group: CommandGroup;
  readonly accelerator?: string;
  readonly macAccelerator?: string;
  readonly aliases?: readonly string[];
}

export interface CommandInput {
  readonly type: string;
  readonly key: string;
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export const COMMANDS: readonly CommandDescriptor[] = Object.freeze([
  { id: "open-command-palette", labelKey: "commandPalette", group: "navigate", accelerator: "Alt+K", aliases: ["F1"] },
  { id: "open-sites", labelKey: "sitesAndGroups", group: "navigate", accelerator: "Alt+S" },
  { id: "open-site-health", labelKey: "siteHealth", group: "navigate", accelerator: "Alt+H" },
  { id: "show-page-1", labelKey: "showPageOne", group: "navigate", accelerator: "Alt+1" },
  { id: "show-page-2", labelKey: "showPageTwo", group: "navigate", accelerator: "Alt+2" },
  { id: "show-page-3", labelKey: "showPageThree", group: "navigate", accelerator: "Alt+3" },
  // 这四条原本是 createMenu() 里手写的菜单项，没进本表 → 快捷键速查（只渲染本表）看不到它们，
  // 而速查的文案承诺的是「集中查看当前可用的应用快捷键」。并进来后菜单也从本表生成，不会再漂。
  { id: "next-page", labelKey: "nextPageMenu", group: "navigate", accelerator: "CmdOrCtrl+Shift+PageDown" },
  { id: "previous-page", labelKey: "previousPageMenu", group: "navigate", accelerator: "CmdOrCtrl+Shift+PageUp" },
  { id: "next-site", labelKey: "nextSiteMenu", group: "navigate", accelerator: "CmdOrCtrl+PageDown" },
  { id: "previous-site", labelKey: "previousSiteMenu", group: "navigate", accelerator: "CmdOrCtrl+PageUp" },
  // 站内导航（点了回答里的站内链接、站点自己的跳转器）之后此前完全没有退路，唯一脱身办法是
  // 「新会话」——那会丢掉当前对话。Alt+方向键避开浏览器/站点自己的 Alt+Left。
  { id: "site-back", labelKey: "siteBackMenu", group: "navigate", accelerator: "Alt+Left" },
  { id: "site-forward", labelKey: "siteForwardMenu", group: "navigate", accelerator: "Alt+Right" },
  { id: "focus-prompt", labelKey: "focusPromptMenu", group: "compose", accelerator: "Alt+Q" },
  { id: "set-think", labelKey: "chooseThinkMode", group: "compose", accelerator: "Alt+T" },
  { id: "set-fast", labelKey: "chooseFastMode", group: "compose", accelerator: "Alt+Y" },
  { id: "collect-answers", labelKey: "collectAnswers", group: "results", accelerator: "Alt+C" },
  { id: "open-archive", labelKey: "openArchive", group: "results" },
  { id: "collect-synthesis", labelKey: "synthesisCollect", group: "results" },
  { id: "retry-failed", labelKey: "retryFailedCommand", group: "results", accelerator: "Alt+R" },
  { id: "new-session", labelKey: "newSessionSelected", group: "compose", accelerator: "Alt+N" },
  { id: "open-settings", labelKey: "settings", group: "app", accelerator: "Control+,", macAccelerator: "Command+," },
  { id: "open-drive-diagnostics", labelKey: "openDriveDiagnostics", group: "app" },
  { id: "open-shortcuts", labelKey: "keyboardShortcuts", group: "app" },
  { id: "next-unfinished", labelKey: "nextUnfinished", group: "results" },
  { id: "next-failed", labelKey: "nextFailed", group: "results" },
  { id: "check-updates", labelKey: "checkForUpdates", group: "app" }
]);

const BY_ID = new Map<string, CommandDescriptor>(COMMANDS.map((command) => [command.id, command]));

export function commandById(id: string): CommandDescriptor | undefined {
  return BY_ID.get(id);
}

export function commandAccelerator(id: CommandId, platform: NodeJS.Platform): string | undefined {
  const command = commandById(id);
  return platform === "darwin" ? command?.macAccelerator ?? command?.accelerator : command?.accelerator;
}

export function commandAliasForInput(input: CommandInput): CommandId | undefined {
  if (input.type !== "keyDown" || input.alt || input.control || input.meta || input.shift) return undefined;
  return COMMANDS.find((command) => command.aliases?.some((alias) => alias === input.key))?.id;
}
