import type {
  CommandDescriptor,
  CommandGroup,
  CommandId
} from "../shared/commands";
import { normalizeAccelerator } from "../shared/accelerators";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { MenuShortcut } from "../shared/protocol";
import type { ActiveWorkspaceGroup } from "../shared/workspace";

export type PaletteGroup = CommandGroup | "saved" | "menu";

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly group: PaletteGroup;
  readonly accelerator?: string;
  readonly aliases: readonly string[];
  readonly commandId?: CommandId;
  readonly groupId?: string;
}

interface SearchOptions {
  readonly groups?: readonly ActiveWorkspaceGroup[];
  readonly isMac?: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function itemMatches(item: PaletteCommand, query: string): boolean {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalized([
    item.label,
    item.id,
    item.accelerator ?? "",
    ...item.aliases
  ].join(" "));
  return terms.every((term) => haystack.includes(term));
}

// 菜单里由 Electron 给加速器的 role 项（重新加载/缩放/全屏/复制/退出…）不在 COMMANDS 表里，
// 速查只渲染该表就会漏掉它们。这里把主进程读来的**真实菜单**补进速查，并按加速器与已列出的
// 条目去重（我们自己那批命令本来就在菜单里，不去重会出现两遍）。这类条目不可执行，只作参考。
export function menuShortcutItems(
  shortcuts: readonly MenuShortcut[],
  listed: readonly PaletteCommand[],
  isMac = false
): readonly PaletteCommand[] {
  const seen = new Set(listed
    .map((item) => item.accelerator)
    .filter((value): value is string => !!value)
    .map((value) => normalizeAccelerator(value, isMac)));
  const items: PaletteCommand[] = [];
  for (const shortcut of shortcuts) {
    const key = normalizeAccelerator(shortcut.accelerator, isMac);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `menu:${shortcut.group}:${shortcut.label}`,
      label: shortcut.label,
      group: "menu",
      accelerator: shortcut.accelerator,
      aliases: []
    });
  }
  return items;
}

export function commandItems(
  commands: readonly CommandDescriptor[],
  copy: DesktopCopy,
  options: SearchOptions = {}
): readonly PaletteCommand[] {
  const registered = commands.map((command): PaletteCommand => ({
    id: command.id,
    label: copy[command.labelKey],
    group: command.group,
    accelerator: options.isMac
      ? command.macAccelerator ?? command.accelerator
      : command.accelerator,
    aliases: command.aliases ?? [],
    commandId: command.id
  }));
  const saved = (options.groups ?? []).map((group): PaletteCommand => ({
    id: `apply-group:${group.id}`,
    label: formatCopy(copy.applySavedGroup, { group: group.name }),
    group: "saved",
    aliases: [group.name],
    groupId: group.id
  }));
  return [...registered, ...saved];
}

export function searchCommands(
  query: string,
  commands: readonly CommandDescriptor[],
  copy: DesktopCopy,
  options: SearchOptions = {}
): readonly PaletteCommand[] {
  return commandItems(commands, copy, options).filter((item) => itemMatches(item, query));
}
