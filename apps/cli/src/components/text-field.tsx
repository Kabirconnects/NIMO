import { TextAttributes } from "@opentui/core";

import { COLORS } from "../theme";

const COMPACT_LABEL_WIDTH = 13;

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  focused: boolean;
  onFocusRequest?: () => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  /** One-line layout for short terminals. */
  compact?: boolean;
};

/** Shared single-line field used by the auth forms. */
export function TextField({
  label,
  value,
  onChange,
  focused,
  onFocusRequest,
  placeholder = "",
  error,
  hint,
  compact = false,
}: TextFieldProps) {
  if (compact) {
    return (
      <box flexDirection="column" width="100%">
        <box
          flexDirection="row"
          height={1}
          alignItems="center"
          gap={1}
          onMouseDown={onFocusRequest}
        >
          <box width={COMPACT_LABEL_WIDTH} flexShrink={0}>
            <text fg={focused ? COLORS.accent : COLORS.muted}>{label}</text>
          </box>
          <box flexGrow={1} height={1} overflow="hidden">
            <input
              width="100%"
              value={value}
              placeholder={placeholder}
              focused={focused}
              onInput={onChange}
            />
          </box>
        </box>

        {error && (
          <box paddingLeft={COMPACT_LABEL_WIDTH + 1} height={1}>
            <text fg={COLORS.error} truncate>
              {error}
            </text>
          </box>
        )}
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" gap={0}>
      <box
        width="100%"
        height={3}
        border
        borderStyle="rounded"
        borderColor={focused ? COLORS.brand : COLORS.faint}
        backgroundColor={focused ? COLORS.panel : COLORS.background}
        title={` ${label} `}
        titleColor={focused ? COLORS.accent : COLORS.muted}
        titleAlignment="left"
        paddingX={1}
        alignItems="center"
        onMouseDown={onFocusRequest}
      >
        <input
          width="100%"
          value={value}
          placeholder={placeholder}
          focused={focused}
          onInput={onChange}
        />
      </box>

      {error ? (
        <box paddingLeft={1} height={1}>
          <text fg={COLORS.error} truncate>
            {error}
          </text>
        </box>
      ) : hint ? (
        <box paddingLeft={1} height={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM} truncate>
            {hint}
          </text>
        </box>
      ) : null}
    </box>
  );
}
