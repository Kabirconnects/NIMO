import { useEffect, useRef, useState } from "react";
import { TextAttributes, type KeyBinding, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { COLORS } from "../../../theme";
import { CommandMenu } from "../../../components/commandMenu";
import { useCommandMenu } from "../../../components/commandMenu/useCommandMenu";
import type { CommandContext } from "../../../components/commandMenu/types";
import type { AgentMode, Effort } from "../types";
import { EFFORT_LABELS } from "../labels";

const MIN_HEIGHT = 1;
const MAX_HEIGHT = 6;

const KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "enter", ctrl: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

type ChatBoxProps = {
  streaming: boolean;
  overlayOpen: boolean;
  notice: string | null;
  modelLabel: string;
  mode: AgentMode;
  effort: Effort;
  commandContext: CommandContext;
  onSubmit: (prompt: string) => void;
  onStop: () => void;
};

export function ChatBox({
  streaming,
  overlayOpen,
  notice,
  modelLabel,
  mode,
  effort,
  commandContext,
  onSubmit,
  onStop,
}: ChatBoxProps) {
  const textareaRef = useRef<TextareaRenderable>(null);
  const submitRef = useRef<() => void>(() => {});
  const [value, setValue] = useState("");

  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();

  const lineCount = value.split("\n").length;
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, lineCount));

  const resetInput = () => {
    textareaRef.current?.setText("");
    setValue("");
    handleContentChange("");
  };

  const executeCommand = (index: number) => {
    const command = resolveCommand(index);
    if (!command) return;

    resetInput();

    if (command.action) {
      void command.action(commandContext);
    } else {
      textareaRef.current?.insertText(`${command.value} `);
    }
  };

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea || streaming) return;

    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      if (command) {
        executeCommand(selectedIndex);
        return;
      }

      // A typo'd "/..." must not reach the model as a paid prompt.
      if (textarea.plainText.trimStart().startsWith("/")) return;
    }

    const text = textarea.plainText.trim();
    if (text.length === 0) return;

    onSubmit(text);
    resetInput();
  };

  // Wire the textarea submit once; the ref always points at the latest logic.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.onSubmit = () => submitRef.current();
  }, []);

  submitRef.current = submit;

  // Esc stops an in-flight turn, but only when no menu/overlay owns the key.
  useKeyboard((key) => {
    if (key.name !== "escape") return;
    if (overlayOpen || showCommandMenu) return;
    if (!streaming) return;

    key.preventDefault();
    onStop();
  });

  return (
    <box width="100%" flexDirection="column" position="relative">
      {showCommandMenu && (
        <box
          position="absolute"
          bottom="100%"
          left={0}
          width="100%"
          zIndex={10}
        >
          <CommandMenu
            query={commandQuery}
            selectedIndex={selectedIndex}
            scrollRef={scrollRef}
            onSelect={setSelectedIndex}
            onExecute={executeCommand}
          />
        </box>
      )}

      <box
        width="100%"
        height={1}
        border={["top"]}
        borderColor={COLORS.border}
      />

      <box width="100%" flexDirection="row" alignItems="flex-start" paddingX={1}>
        <box height={1}>
          <text fg={streaming ? COLORS.warning : COLORS.brand}>
            {streaming ? "◌ " : "❯ "}
          </text>
        </box>

        <box flexGrow={1} height={height}>
          <textarea
            ref={textareaRef}
            placeholder={
              streaming ? "Nimo is responding… (esc to stop)" : "Message Nimo…"
            }
            focused={!overlayOpen}
            height={height}
            keyBindings={KEY_BINDINGS}
            onContentChange={() => {
              const textarea = textareaRef.current;
              if (!textarea) return;
              setValue(textarea.plainText);
              handleContentChange(textarea.plainText);
            }}
          />
        </box>
      </box>

      <box
        width="100%"
        height={1}
        border={["top"]}
        borderColor={COLORS.border}
      />

      <box
        width="100%"
        height={1}
        flexDirection="row"
        alignItems="center"
        paddingX={1}
      >
        <text fg={COLORS.brand}>◆ </text>
        <box flexShrink={1} overflow="hidden">
          <text fg={COLORS.dim} truncate>
            {modelLabel}
          </text>
        </box>
        <text fg={COLORS.faint}> · </text>
        <text fg={COLORS.accent}>{mode}</text>
        <text fg={COLORS.faint}> · </text>
        <text fg={COLORS.accent}>{EFFORT_LABELS[effort]}</text>

        <box flexGrow={1} />

        {streaming ? (
          <text fg={COLORS.warning} attributes={TextAttributes.DIM}>
            esc to stop
          </text>
        ) : (
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            / commands
          </text>
        )}
      </box>

      {notice && (
        <box width="100%" height={1} paddingX={1}>
          <text fg={COLORS.warning} truncate>
            ✦ {notice}
          </text>
        </box>
      )}
    </box>
  );
}
