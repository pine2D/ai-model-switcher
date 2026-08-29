import type {
  CommandDescriptor,
  CommandGroup,
  CommandId
} from "../shared/commands";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { ActiveWorkspaceGroup } from "../shared/workspace";

export type PaletteGroup = CommandGroup | "saved";

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
