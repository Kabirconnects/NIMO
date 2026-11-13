import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/api-client";


import type {
  AgentStreamEvent,
  AgentUsage,
  AssistantChatMessage,
  AssistantPart,
  ChatInput,
  ChatMessage,
  ToolPart,
} from "../types";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  

/** Append a token delta, merging into the trailing part of the same kind. */
function appendDelta(
  parts: AssistantPart[],
  kind: "text" | "reasoning",
  text: string,
): AssistantPart[] {
  const last = parts[parts.length - 1];

  if (last && last.type === kind) {
    const merged: AssistantPart = {
      type: kind,
      id: last.id,
      text: last.text + text,
    };
    return [...parts.slice(0, -1), merged];
  }

  const created: AssistantPart = { type: kind, id: newId(), text };
  return [...parts, created];
}

/** Create or update the tool card keyed by the model's toolCallId. */
type ToolPartUpdate = Partial<Omit<ToolPart, "type" | "id">>;

function upsertTool(
  parts: AssistantPart[],
  id: string,
  update: ToolPartUpdate,
): AssistantPart[] {
  const index = parts.findIndex((part) => part.type === "tool" && part.id === id);

  if (index === -1) {
    return [
      ...parts,
      {
        type: "tool",
        id,
        toolName: update.toolName ?? "tool",
        status: update.status ?? "running",
        input: update.input,
        output: update.output,
        error: update.error,
        truncated: update.truncated,
      },
    ];
  }

  return parts.map((part, i) =>
    i === index && part.type === "tool" ? { ...part, ...update } : part,
  );
}

function applyEvent(
  parts: AssistantPart[],
  event: AgentStreamEvent,
): AssistantPart[] {
  switch (event.type) {
    case "reasoning":
      return appendDelta(parts, "reasoning", event.text);

    case "text":
      return appendDelta(parts, "text", event.text);

    case "tool-start":
      return upsertTool(parts, event.id, {
        toolName: event.toolName,
        status: "running",
      });

    case "tool-call":
      return upsertTool(parts, event.id, {
        toolName: event.toolName,
        input: event.input,
        status: "running",
      });

    case "tool-result":
      return upsertTool(parts, event.id, {
        toolName: event.toolName,
        output: event.output,
        truncated: event.truncated,
        status: "success",
      });

    case "tool-error":
      return upsertTool(parts, event.id, {
        toolName: event.toolName,
        error: event.error,
        status: "error",
      });

    case "error": {
      const last = parts[parts.length - 1];
      if (last?.type === "error" && last.text === event.message) return parts;
      return [...parts, { type: "error", id: newId(), text: event.message }];
    }

    // start / step-start / step-finish / done / aborted carry no renderable
    // part — they are handled by the hook itself.
    default:
      return parts;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface UseAgentChatResult {
  messages: ChatMessage[];
  send: (input: ChatInput) => Promise<void>;
  stop: () => void;
  reset: () => void;
  isStreaming: boolean;
  error: Error | null;
}

function useAgentChat(): UseAgentChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (input: ChatInput) => {
    // One in-flight turn at a time.
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsStreaming(true);

    const assistantId = newId();

    setMessages((current) => [
      ...current,
      { id: newId(), role: "user", text: input.prompt },
      { id: assistantId, role: "assistant", parts: [], streaming: true },
    ]);

    const patchAssistant = (
      updater: (message: AssistantChatMessage) => AssistantChatMessage,
    ) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.role === "assistant"
            ? updater(message)
            : message,
        ),
      );
    };

    const handleEvent = (event: AgentStreamEvent) => {
      if (event.type === "start") {
        patchAssistant((message) => ({ ...message, modelId: event.modelId }));
        return;
      }

      if (event.type === "done") {
        patchAssistant((message) => {
          const hasVisibleText = message.parts.some(
            (part) => part.type === "text" && part.text.trim().length > 0,
          );

          const parts =
            !hasVisibleText && event.text
              ? [
                  ...message.parts,
                  { type: "text" as const, id: newId(), text: event.text },
                ]
              : message.parts;

          return {
            ...message,
            parts,
            streaming: false,
            steps: event.steps,
            durationMs: event.durationMs,
            usage: event.usage as AgentUsage,
          };
        });
        return;
      }

      if (event.type === "aborted") {
        patchAssistant((message) => ({ ...message, streaming: false }));
        return;
      }

      patchAssistant((message) => ({
        ...message,
        parts: applyEvent(message.parts, event),
      }));
    };

    try {
      const response = await fetch(`${API_BASE_URL}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;

        throw new Error(
          payload?.error
            ? String(payload.error)
            : `Request failed (${response.status})`,
        );
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this browser");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        // Empty separators and SSE heartbeat comments (: ping).
        if (!line || line.startsWith(":")) return;

        const payload = line.startsWith("data:")
          ? line.slice("data:".length).trim()
          : line;
        if (!payload) return;

        let event: AgentStreamEvent;
        try {
          event = JSON.parse(payload) as AgentStreamEvent;
        } catch {
          return;
        }

        handleEvent(event);
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
    } catch (err) {
      if (!isAbortError(err)) {
        const normalized =
          err instanceof Error ? err : new Error(String(err));
        setError(normalized);
        patchAssistant((message) => ({
          ...message,
          parts: applyEvent(message.parts, {
            type: "error",
            message: normalized.message,
          }),
        }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
      patchAssistant((message) =>
        message.streaming ? { ...message, streaming: false } : message,
      );
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setError(null);
  }, []);

  // Cancel any in-flight turn when the chat unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, send, stop, reset, isStreaming, error };
}

export default useAgentChat;
