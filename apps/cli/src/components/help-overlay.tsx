import { useRef } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { COLORS } from "../theme";
import { COMMANDS } from "./commandMenu/commands";

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "enter", description: "Send the message" },
  { keys: "ctrl+j", description: "Insert a new line" },
  { keys: "esc", description: "Stop a response or close a menu" },
  { keys: "tab", description: "Move to the next field on auth screens" },
  { keys: "ctrl+c", description: "Quit Nimo" },
];

const COMMAND_COL_WIDTH = 16;

function Section({ title }: { title: string }) {
  return (
    <box paddingTop={1} height={2}>
      <text fg={COLORS.brand} attributes={TextAttributes.BOLD}>
        {title}
      </text>
    </box>
  );
}

function Row({
  left,
  description,
  accent = false,
}: {
  left: string;
  description: string;
  accent?: boolean;
}) {
  return (
    <box flexDirection="row" height={1} overflow="hidden">
      <box width={COMMAND_COL_WIDTH} flexShrink={0}>
        <text fg={accent ? COLORS.accent : COLORS.text} selectable={false}>
          {left}
        </text>
      </box>
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        <text fg={COLORS.dim} truncate selectable={false}>
          {description}
        </text>
      </box>
    </box>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault();
      onClose();
    }
  });

  const width = Math.max(40, Math.min(78, dimensions.width - 4));
  const height = Math.max(10, Math.min(30, dimensions.height - 2));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={50}
      backgroundColor={COLORS.background}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={width}
        height={height}
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title=" Help "
        titleColor={COLORS.brand}
        titleAlignment="left"
        flexDirection="column"
      >
        <scrollbox ref={scrollRef} flexGrow={1} paddingX={1} focused>
          <Section title="COMMANDS" />
          {COMMANDS.map((command) => (
            <Row
              key={command.value}
              left={command.value}
              description={command.description}
              accent
            />
          ))}

          <Section title="KEYBOARD" />
          {SHORTCUTS.map((shortcut) => (
            <Row
              key={shortcut.keys}
              left={shortcut.keys}
              description={shortcut.description}
            />
          ))}

          <Section title="ABOUT" />
          <Row
            left="nimo"
            description="Terminal client for the Nimo agent."
          />
          <Row
            left="server"
            description="Set NIMO_API_URL to point at another API."
          />
          <Row
            left="config"
            description="Preferences are stored in ~/.nimo/cli.json."
          />
        </scrollbox>

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            ↑ ↓ scroll · esc close
          </text>
        </box>
      </box>
    </box>
  );
}
