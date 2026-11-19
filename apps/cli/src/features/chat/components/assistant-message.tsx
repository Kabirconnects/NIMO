import { useState } from "react";
import { TextAttributes } from "@opentui/core";

import { COLORS } from "../../../theme";
import type {
  AssistantChatMessage,
  AssistantPart,
  ToolPart,
  ToolStatus,
} from "../types";

const TOOL_LABELS: Record<string, string> = {
  readFile: "Read file",
  writeFile: "Write file",
  editFile: "Edit file",
  deleteFile: "Delete file",
  deleteDir: "Delete directory",
  listFiles: "List files",
  mkdir: "Create directory",
  search: "Search files",
  glob: "Find files",
  runCommand: "Run command",
  runTests: "Run tests",
  gitStatus: "Git status",
  explainFile: "Explain file",
  refactor: "Refactor",
  benchmark: "Benchmark",
  createTool: "Create tool",
  webFetch: "Fetch page",
  summarize: "Summarize",
  extractData: "Extract data",
  recall: "Recall memory",
  remember: "Remember",
  linkMemories: "Link memories",
  updateMemory: "Update memory",
  forgetMemory: "Forget memory",
  loadSkills: "Load skills",
  teach: "Teach",
  teachSkill: "Teach skill",
  useSkill: "Use skill",
  manageProcess: "Manage process",
};

function humanizeTool(toolName: string): string {
  return (
    TOOL_LABELS[toolName] ??
    toolName
      .replace(/[-_]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (char) => char.toUpperCase())
  );
}

/** Pull the most useful "what is this acting on" string out of a tool input. */
function summarizeInput(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  const keys = [
    "path",
    "filePath",
    "file",
    "command",
    "query",
    "url",
    "pattern",
    "name",
    "prompt",
    "id",
  ];

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clamp(value: string, max = 2_400): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… ${value.length - max} more characters`;
}

function statusMark(status: ToolStatus): { mark: string; color: string } {
  if (status === "running") return { mark: "•", color: COLORS.warning };
  if (status === "error") return { mark: "✕", color: COLORS.error };
  return { mark: "✓", color: COLORS.success };
}

function ToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(part.input);
  const status = statusMark(part.status);
  const hasDetails =
    part.input !== undefined ||
    part.output !== undefined ||
    part.error !== undefined;

  return (
    <box flexDirection="column" width="100%" paddingLeft={1}>
      <box
        flexDirection="row"
        gap={1}
        height={1}
        onMouseDown={hasDetails ? () => setOpen((value) => !value) : undefined}
      >
        <text fg={COLORS.muted}>{hasDetails ? (open ? "▾" : "▸") : " "}</text>
        <text fg={COLORS.muted}>⚙</text>
        <text fg={COLORS.text}>{humanizeTool(part.toolName)}</text>
        {summary && (
          <text fg={COLORS.muted} truncate>
            {summary}
          </text>
        )}
        <box flexGrow={1} />
        <text fg={status.color}>{status.mark}</text>
      </box>

      {open && hasDetails && (
        <box flexDirection="column" paddingLeft={3} gap={1}>
          {part.input !== undefined && (
            <box flexDirection="column">
              <text fg={COLORS.muted} attributes={TextAttributes.DIM}>
                input
              </text>
              <text fg={COLORS.dim} wrapMode="word">
                {clamp(formatPayload(part.input))}
              </text>
            </box>
          )}
          {part.error !== undefined && (
            <box flexDirection="column">
              <text fg={COLORS.error} attributes={TextAttributes.DIM}>
                error
              </text>
              <text fg={COLORS.error} wrapMode="word">
                {clamp(String(part.error))}
              </text>
            </box>
          )}
          {part.output !== undefined && (
            <box flexDirection="column">
              <text fg={COLORS.muted} attributes={TextAttributes.DIM}>
                {part.truncated ? "output (truncated)" : "output"}
              </text>
              <text fg={COLORS.dim} wrapMode="word">
                {clamp(formatPayload(part.output))}
              </text>
            </box>
          )}
        </box>
      )}
    </box>
  );
}

function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  // Mirrors the web: open while the model is thinking, collapsed afterwards.
  // A click on the header keeps it open (or re-opens it) for inspection.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;

  return (
    <box flexDirection="column" width="100%" paddingLeft={1}>
      <box
        flexDirection="row"
        gap={1}
        height={1}
        onMouseDown={() => setUserOpen(!open)}
      >
        <text fg={COLORS.muted}>{open ? "▾" : "▸"}</text>
        <text fg={COLORS.muted}>✦</text>
        <text fg={COLORS.muted} attributes={TextAttributes.DIM}>
          {live ? "Thinking…" : "Thought process"}
        </text>
      </box>

      {open && (
        <box paddingLeft={3}>
          <text fg={COLORS.muted} wrapMode="word" attributes={TextAttributes.DIM}>
            {text}
          </text>
        </box>
      )}
    </box>
  );
}

function TextBlock({ text, live }: { text: string; live: boolean }) {
  return (
    <box width="100%" paddingLeft={1}>
      <text wrapMode="word" fg={COLORS.text}>
        {text}
        {live ? " ▌" : ""}
      </text>
    </box>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={COLORS.error}
      paddingX={1}
    >
      <text wrapMode="word" fg={COLORS.error}>
        ✕ {text}
      </text>
    </box>
  );
}

function ThinkingDots() {
  return (
    <box flexDirection="row" gap={1} paddingLeft={1}>
      <text fg={COLORS.brand} attributes={TextAttributes.DIM}>
        ● ● ●
      </text>
      <text fg={COLORS.muted} attributes={TextAttributes.DIM}>
        Thinking…
      </text>
    </box>
  );
}

function renderPart(part: AssistantPart, live: boolean) {
  switch (part.type) {
    case "reasoning":
      return <ReasoningBlock key={part.id} text={part.text} live={live} />;
    case "text":
      return <TextBlock key={part.id} text={part.text} live={live} />;
    case "tool":
      return <ToolCard key={part.id} part={part} />;
    case "error":
      return <ErrorBlock key={part.id} text={part.text} />;
  }
}

function formatModel(modelId: string): string {
  const name = modelId.split("/").pop() ?? modelId;
  return name.replace(/[-_]/g, " ");
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000
    ? `${(tokens / 1_000).toFixed(1)}k tokens`
    : `${tokens} tokens`;
}

function RunMeta({ message }: { message: AssistantChatMessage }) {
  const items: string[] = [];

  if (message.modelId) items.push(formatModel(message.modelId));
  if (message.steps && message.steps > 0) {
    items.push(`${message.steps} ${message.steps === 1 ? "step" : "steps"}`);
  }
  if (message.usage?.totalTokens) {
    items.push(formatTokens(message.usage.totalTokens));
  }
  if (message.durationMs) {
    items.push(`${(message.durationMs / 1000).toFixed(1)}s`);
  }

  if (items.length === 0) return null;

  return (
    <box paddingLeft={1}>
      <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
        {items.join("  ·  ")}
      </text>
    </box>
  );
}

export function AssistantMessage({
  message,
}: {
  message: AssistantChatMessage;
}) {
  const { parts, streaming } = message;
  const lastPart = parts[parts.length - 1];

  if (parts.length === 0) {
    return streaming ? (
      <ThinkingDots />
    ) : (
      <box paddingLeft={1}>
        <text fg={COLORS.muted}>No response.</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" gap={1}>
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const live =
          streaming &&
          isLast &&
          (part.type === "text" || part.type === "reasoning");
        return renderPart(part, live);
      })}

      {streaming && lastPart?.type !== "text" && lastPart?.type !== "reasoning" && (
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={COLORS.brand} attributes={TextAttributes.DIM}>
            ●
          </text>
          <text fg={COLORS.muted} attributes={TextAttributes.DIM}>
            Working…
          </text>
        </box>
      )}

      {!streaming && <RunMeta message={message} />}
    </box>
  );
}
