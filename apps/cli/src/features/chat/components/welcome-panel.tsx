import { TextAttributes } from "@opentui/core";

import { COLORS } from "../../../theme";

type WelcomePanelProps = {
  modelLabel: string;
  mode: string;
  effort: string;
};

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <box
      flexDirection="row"
      gap={1}
      border
      borderStyle="rounded"
      borderColor={COLORS.faint}
      paddingX={1}
      height={3}
      alignItems="center"
      flexShrink={1}
      overflow="hidden"
    >
      <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
        {label}
      </text>
      <text fg={COLORS.accent} truncate>
        {value}
      </text>
    </box>
  );
}

/** Empty-chat welcome state — replaces the old static info panel. */
export function WelcomePanel({ modelLabel, mode, effort }: WelcomePanelProps) {
  return (
    <box
      width="100%"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      paddingY={2}
    >
      <box
        width="92%"
        maxWidth={72}
        flexDirection="column"
        alignItems="center"
        gap={1}
      >
        <ascii-font
          font="tiny"
          text="NIMO"
          color={[COLORS.brand, COLORS.accent]}
        />

        <text fg={COLORS.text} attributes={TextAttributes.BOLD}>
          Your AI agent in the terminal
        </text>
        <text fg={COLORS.dim}>
          Ask anything. Type / for commands and settings.
        </text>

        <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1}>
          <Chip label="model" value={modelLabel} />
          <Chip label="mode" value={mode} />
          <Chip label="effort" value={effort} />
        </box>

        <box
          border
          borderStyle="rounded"
          borderColor={COLORS.faint}
          paddingX={2}
          height={3}
          alignItems="center"
        >
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            enter send · ctrl+j newline · /help for shortcuts
          </text>
        </box>
      </box>
    </box>
  );
}
