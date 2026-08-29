import type { CommandId } from "../shared/commands";

export type CommandActions = Partial<Record<CommandId, () => void>>;

export function executeCommand(id: CommandId, actions: CommandActions): boolean {
  const action = actions[id];
  if (!action) return false;
  action();
  return true;
}
