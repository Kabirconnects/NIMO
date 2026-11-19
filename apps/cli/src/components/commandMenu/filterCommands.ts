import type { Command } from "./types";
import { COMMANDS } from "./commands";

export function getFilteredCommands(query: string): Command[] {
  if (query.length === 0) return COMMANDS;

  const needle = query.toLowerCase();

  return COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().startsWith(needle) ||
      cmd.value.toLowerCase().startsWith(`/${needle}`),
  );
}
