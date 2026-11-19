import { TextAttributes, decodePasteBytes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";

import { COLORS } from "../theme";

const COMPACT_LABEL_WIDTH = 13;

type SecureFieldProps = {
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

/**
 * A masked text field.
 *
 * OpenTUI's inputs have no password masking, so this renders bullets and keeps
 * the real value in React state. Keys are read from the global keyboard handler
 * and only when this field is the focused one; control keys (tab, enter, esc)
 * are left alone so the form can use them.
 */
export function SecureField({
  label,
  value,
  onChange,
  focused,
  onFocusRequest,
  placeholder = "",
  error,
  hint,
  compact = false,
}: SecureFieldProps) {
  useKeyboard((key) => {
    if (!focused || key.eventType !== "press") return;

    // The form owns navigation and submission.
    if (
      key.name === "tab" ||
      key.name === "return" ||
      key.name === "enter" ||
      key.name === "linefeed" ||
      key.name === "escape"
    ) {
      return;
    }

    if (key.name === "backspace") {
      key.preventDefault();
      if (value.length > 0) onChange(value.slice(0, -1));
      return;
    }

    if (key.ctrl && key.name === "u") {
      key.preventDefault();
      onChange("");
      return;
    }

    // Shortcuts and meta sequences must not end up inside the password.
    if (key.ctrl || key.meta || key.option) return;

    const sequence = key.sequence;
    if (!sequence || sequence.startsWith("\x1b")) return;

    const printable = [...sequence]
      .filter((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join("");

    if (!printable) return;

    key.preventDefault();
    onChange(value + printable);
  });

  usePaste((event) => {
    if (!focused) return;

    const pasted = [...decodePasteBytes(event.bytes)]
      .filter((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join("");

    if (pasted) onChange(value + pasted);
  });

  const masked = "•".repeat(Math.min(value.length, 64));

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
          <box flexGrow={1} overflow="hidden">
            {value.length > 0 ? (
              <text fg={focused ? COLORS.text : COLORS.dim} truncate>
                {masked}
                {focused ? " ▌" : ""}
              </text>
            ) : (
              <text fg={COLORS.faint} truncate>
                {focused ? `▌ ${placeholder}` : placeholder}
              </text>
            )}
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
        {value.length > 0 ? (
          <text fg={focused ? COLORS.text : COLORS.dim} truncate>
            {masked}
            {focused ? " ▌" : ""}
          </text>
        ) : (
          <text
            fg={COLORS.faint}
            attributes={focused ? undefined : TextAttributes.DIM}
            truncate
          >
            {focused ? `▌ ${placeholder}` : placeholder}
          </text>
        )}
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
