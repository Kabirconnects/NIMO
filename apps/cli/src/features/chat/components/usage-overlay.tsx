import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { COLORS } from "../../../theme";
import type { ChatMessage } from "../types";

export type UsageSummary = {
  messages: number;
  replies: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
  /** Responses the server did not report usage for (older or failed turns). */
  unreported: number;
};

/**
 * Sum the per-response usage events the server sent for this conversation.
 *
 * The server reports usage on the `done` frame of every turn, so this is real
 * accounting — not an estimate.
 */
export function summarizeUsage(messages: ChatMessage[]): UsageSummary {
  const summary: UsageSummary = {
    messages: messages.length,
    replies: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    unreported: 0,
  };

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    summary.replies += 1;
    summary.steps += message.steps ?? 0;
    summary.durationMs += message.durationMs ?? 0;

    const usage = message.usage;

    if (!usage || (!usage.totalTokens && !usage.inputTokens && !usage.outputTokens)) {
      // In-flight or failed turns have no usage frame.
      if (!message.streaming) summary.unreported += 1;
      continue;
    }

    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const reasoning = usage.reasoningTokens ?? 0;

    summary.inputTokens += input;
    summary.outputTokens += output;
    summary.reasoningTokens += reasoning;
    summary.totalTokens += usage.totalTokens ?? input + output + reasoning;
  }

  return summary;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <box flexDirection="row" height={1} paddingX={1}>
      <box width={16} flexShrink={0}>
        <text fg={COLORS.muted}>{label}</text>
      </box>
      <text fg={COLORS.text} truncate>
        {value}
      </text>
    </box>
  );
}

/** `/usage` — a local roll-up of the token counts the server already sent. */
export function UsageOverlay({
  messages,
  onClose,
}: {
  messages: ChatMessage[];
  onClose: () => void;
}) {
  const dimensions = useTerminalDimensions();
  const summary = useMemo(() => summarizeUsage(messages), [messages]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || key.name === "return") {
      key.preventDefault();
      onClose();
    }
  });

  const width = Math.max(36, Math.min(52, dimensions.width - 4));

  const rows: { label: string; value: string }[] = [
    { label: "Messages", value: String(summary.messages) },
    { label: "Responses", value: String(summary.replies) },
    { label: "Steps", value: String(summary.steps) },
    { label: "Input tokens", value: formatTokens(summary.inputTokens) },
    { label: "Output tokens", value: formatTokens(summary.outputTokens) },
  ];

  if (summary.reasoningTokens > 0) {
    rows.push({
      label: "Reasoning tokens",
      value: formatTokens(summary.reasoningTokens),
    });
  }

  rows.push({ label: "Total tokens", value: formatTokens(summary.totalTokens) });

  if (summary.durationMs > 0) {
    rows.push({
      label: "Time generating",
      value: formatDuration(summary.durationMs),
    });
  }

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
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title=" Usage "
        titleColor={COLORS.brand}
        titleAlignment="left"
        flexDirection="column"
        paddingBottom={1}
      >
        <box height={1} />

        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} />
        ))}

        <box height={1} />

        <box paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM} wrapMode="word">
            {summary.messages === 0
              ? "Nothing has been sent yet. Usage is counted per conversation and resets with /new."
              : summary.unreported > 0
                ? `${summary.unreported} response${
                    summary.unreported === 1 ? "" : "s"
                  } did not report usage (stopped or failed). Counts reset with /new.`
                : "Reported by the server for this conversation. Counts reset with /new."}
          </text>
        </box>

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            esc close
          </text>
        </box>
      </box>
    </box>
  );
}
