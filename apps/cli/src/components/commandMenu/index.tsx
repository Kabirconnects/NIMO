import type { RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";

import { COLORS } from "../../theme";
import { getFilteredCommands } from "./filterCommands";
import { COMMANDS } from "./commands";

const MAX_VISIBLE_ITEMS = 8;

// Align all command names in a fixed-width column so their descriptions start
// at the same horizontal position. Include the leading "/" in the width.
const COMMAND_COL_WIDTH =
  Math.max(...COMMANDS.map((cmd) => cmd.name.length + 1)) + 4;

type CommandMenuProps = {
  query: string;
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

export function CommandMenu({
  query,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: CommandMenuProps) {
  const filtered = getFilteredCommands(query);
  const visibleHeight = Math.min(filtered.length, MAX_VISIBLE_ITEMS);

  if (filtered.length === 0) {
    return (
      <box
        width="100%"
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        paddingX={2}
        flexDirection="column"
      >
        <text fg={COLORS.brand}>No matching commands</text>
        <text fg={COLORS.dim} attributes={TextAttributes.DIM}>
          Try a different command or check your spelling.
        </text>
      </box>
    );
  }

  return (
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={COLORS.border}
      backgroundColor={COLORS.background}
      title=" Commands "
      titleAlignment="left"
      height={visibleHeight + 2}
    >
      <scrollbox ref={scrollRef} height={visibleHeight}>
        {filtered.map((cmd, i) => {
          const isSelected = i === selectedIndex;

          return (
            <box
              key={cmd.value}
              flexDirection="row"
              paddingX={1}
              height={1}
              overflow="hidden"
              backgroundColor={isSelected ? COLORS.selection : undefined}
              onMouseMove={() => onSelect(i)}
              onMouseDown={() => onExecute(i)}
            >
              <box width={COMMAND_COL_WIDTH} flexShrink={0}>
                <text
                  selectable={false}
                  fg={isSelected ? COLORS.selectionText : COLORS.accent}
                >
                  /{cmd.name}
                </text>
              </box>

              <box flexGrow={1} flexShrink={1} overflow="hidden">
                <text
                  selectable={false}
                  truncate
                  fg={isSelected ? COLORS.selectionText : COLORS.dim}
                >
                  {cmd.description}
                </text>
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
