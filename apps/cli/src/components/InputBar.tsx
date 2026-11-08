import { useRef, useState, useEffect } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";

import { CommandMenu } from "./commandMenu/index.js";
import { useCommandMenu } from "./commandMenu/useCommandMenu.js";
import type { Command, CommandContext } from "./commandMenu/types.js";

const MIN_HEIGHT = 1; 
const MAX_HEIGHT = 6;

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "enter", ctrl: true, action: "newline" },
];

type InputBarProps = {
  onSubmit: (text: string) => void;
  commandContext: CommandContext;
  disabled?: boolean;
};

function InputBar({ onSubmit, commandContext, disabled = false }: InputBarProps) {
  const textareaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
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

  const handleTextareaContentChange = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    setValue(textarea.plainText);
    handleContentChange(textarea.plainText);
  };

  const handleSubmit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const text = textarea.plainText.trim();
    if (text.length === 0) return;

    onSubmit(text);
    resetInput();
  };

  // Run the command, or drop its text into the input if it has no action.
  const handleCommand = (command: Command | undefined) => {
    const textarea = textareaRef.current;
    if (!textarea || !command) return;

    resetInput();

    if (command.action) {
      void command.action(commandContext);
    } else {
      textarea.insertText(command.value + " ");
    }
  };

  const handleCommandExecute = (index: number) => {
    handleCommand(resolveCommand(index));
  };

  // Wire the textarea submit once; the ref always points at the latest logic.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  onSubmitRef.current = () => {
    if (disabled) return;

    if (showCommandMenu) {
      handleCommand(resolveCommand(selectedIndex));
      return;
    }

    handleSubmit();
  };

  return (
    // position="relative" makes this box the anchor for the overlay below.
    <box width="100%" flexDirection="column" position="relative">
      {showCommandMenu && (
        <box
          position="absolute"
          bottom="100%" // sits right above the whole input bar, whatever its height
          left={0}
          width="100%"
          zIndex={10}
        >
          <CommandMenu
            query={commandQuery}
            selectedIndex={selectedIndex}
            scrollRef={scrollRef}
            onSelect={setSelectedIndex}
            onExecute={handleCommandExecute}
          />
        </box>
      )}

      <box border={["top"]} borderColor="#B0654A" width="100%" height={1} />

      <box width="100%" flexDirection="row" alignItems="flex-start">
        <box height={1}>
          <text>❯ </text>
        </box>

        <box flexGrow={1} height={height}>
          <textarea
            ref={textareaRef}
            placeholder="Ask Nimo anything..."
            focused={!disabled}
            height={height}
            keyBindings={TEXTAREA_KEY_BINDINGS}
            onContentChange={handleTextareaContentChange}
          />
        </box>
      </box>

      <box border={["top"]} borderColor="#B0654A" width="100%" height={1} />
    </box>
  );
}

export default InputBar;