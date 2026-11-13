import { generateText, isStepCount, streamText } from "ai";
import {
  getModel,
  getProviderOptions,
  type ModelId,
  type Effort,
} from "../models/registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolsForMode } from "./tools/tool-manager.js";
import type { AgentMode } from "./tools/tools-mode-types.js";
import {
  buildMemoryContext,
  MEMORY_CONTEXT_GUIDANCE,
  memoryService,
  runWithMemoryContext,
  localOwnerId,
} from "@workspace/memory";

/**
 * @deprecated Mode is now request-scoped through the memory runtime context.
 * Kept only so older callers do not break; it no longer changes permissions.
 */
export function setAgentMode(_m: AgentMode) {
  /* no-op — see runWithMemoryContext */
}

export interface RunAgentOptions {
  /**
   * Authenticated owner id. Required in multi-user deployments; ignored as a
   * fallback in deliberate local-dev mode. The model NEVER supplies this.
   */
  ownerId?: string | null;
  /**
   * Set by the server only when the human explicitly confirmed destructive
   * operations for this turn. The model cannot set this.
   */
  destructiveConfirmed?: boolean;
  /**
   * Lets the caller cancel the in-flight model/tool run (client disconnect,
   * "stop generating", request timeout).
   */
  abortSignal?: AbortSignal;
  /**
   * Receives every incremental piece of the run: model reasoning, answer text,
   * tool calls, tool results and step/usage notifications.
   */
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/**
 * Everything the UI needs to render a turn live, one chunk at a time.
 * Serialized as newline-delimited SSE `data:` frames by the server.
 */
export type AgentStreamEvent =
  | { type: "start"; modelId: string; mode: AgentMode; effort: Effort }
  | { type: "step-start"; index: number }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool-start"; id: string; toolName: string }
  | { type: "tool-call"; id: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      id: string;
      toolName: string;
      output: unknown;
      truncated?: boolean;
    }
  | { type: "tool-error"; id: string; toolName: string; error: string }
  | {
      type: "step-finish";
      index: number;
      finishReason: string;
      tools: string[];
      usage: AgentUsage;
    }
  | {
      type: "done";
      text: string;
      usage: AgentUsage;
      steps: number;
      durationMs: number;
    }
  | { type: "error"; message: string }
  | { type: "aborted" };

export interface AgentRunResult {
  text: string;
  usage: AgentUsage;
  steps: number;
}

const CLOSING_INSTRUCTION =
  "\n\nAfter all tool calls, end your turn with a short natural-language summary (1-2 sentences) of what you did. Blank text is never acceptable — always summarize, in plain English, what tools you called and what you learned.";

function buildSystemMessage(
  ownerId: string,
  prompt: string,
  modelId: ModelId,
  mode: AgentMode,
): string {
  // PAME: recall memories relevant to THIS message — the brain remembers
  // the connections, not the whole graph.
  const ctx = buildMemoryContext(ownerId, prompt);
  // Loading skills also records access, so keep the call even though the text
  // is not injected into the prompt yet.
  memoryService.loadSkills(ownerId, prompt, 3);
  const memoryBlock = ctx.promptBlock
    ? `${MEMORY_CONTEXT_GUIDANCE}\n\n${ctx.promptBlock}`
    : "";

  return (
    buildSystemPrompt(modelId, mode) +
    CLOSING_INSTRUCTION +
    (memoryBlock ? `\n\n${memoryBlock}` : "")
  );
}

function toUsage(usage?: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  outputTokenDetails?: { reasoningTokens?: number | null } | null;
}): AgentUsage {
  return {
    inputTokens: usage?.inputTokens ?? undefined,
    outputTokens: usage?.outputTokens ?? undefined,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? undefined,
    totalTokens: usage?.totalTokens ?? undefined,
  };
}

/** Make tool payloads safe and small enough to ship to a browser. */
function previewPayload(
  value: unknown,
  maxChars = 4_000,
): { value: unknown; truncated: boolean } {
  if (value === undefined) return { value: undefined, truncated: false };

  try {
    const json = JSON.stringify(value);
    if (json === undefined) return { value: String(value), truncated: false };
    if (json.length <= maxChars) return { value, truncated: false };
    return {
      value: `${json.slice(0, maxChars)}… (${json.length - maxChars} more chars)`,
      truncated: true,
    };
  } catch {
    const text = String(value);
    return {
      value: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
      truncated: text.length > maxChars,
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

/**
 * PAME: persist the turn and return the text that should be shown to the user.
 * If the model produced no prose, synthesize a summary of what it actually did
 * so the UI is never left blank.
 */
function persistExperience({
  ownerId,
  prompt,
  text,
  toolsUsed,
}: {
  ownerId: string;
  prompt: string;
  text: string;
  toolsUsed: string[];
}): string {
  let finalText = text;

  try {
    // The user's message is first-hand evidence → may form facts.
    memoryService.remember({
      ownerId,
      content: prompt,
      type: "message",
      role: "user",
    });

    if (text) {
      // The assistant's own output is preserved for continuity but is
      // NOT independent evidence: extraction yields zero facts for it.
      memoryService.remember({
        ownerId,
        content: text,
        type: "message",
        role: "assistant",
      });

      // Distill a candidate skill only when real tools were used — an
      // assistant-only answer is not evidence that a procedure works.
      if (toolsUsed.length > 0) {
        const proposed = memoryService.proposeSkillFromExperience({
          ownerId,
          prompt,
          response: text,
          toolsUsed,
        });
        if (proposed.length > 0 && proposed[0]) {
          console.log(`[agent] autonomous skill proposed: ${proposed[0].name}`);
        }
      }

      // Evolve: promote/demote/archive skills by track record.
      const evo = memoryService.evolveSkills(ownerId);
      if (evo.promoted || evo.archived) {
        console.log(
          `[agent] skills evolved: +${evo.promoted} promoted, -${evo.archived} archived`,
        );
      }
    }
  } catch (err) {
    console.error("[agent] memory write failed:", err);
  }

  if (!finalText.trim()) {
    finalText =
      toolsUsed.length > 0
        ? `I used tools: ${toolsUsed.join(", ")}. See memory for details.`
        : "I processed your request but had no additional output.";
    console.log(`[agent] empty-text fallback: "${finalText}"`);
  }

  return finalText;
}

/**
 * Non-streaming entry point, kept for CLI / programmatic callers.
 */
export async function runAgent(
  prompt: string,
  mode: AgentMode,
  modelId: ModelId = "anthropic/claude-sonnet-4-5",
  effort: Effort = "medium",
  options: RunAgentOptions = {},
) {
  const ownerId = options.ownerId ?? localOwnerId();

  // Establish identity + permissions for this request. Everything inside —
  // including tool execution — inherits this context. Concurrent requests
  // cannot see each other's owner.
  return runWithMemoryContext(
    {
      ownerId,
      mode,
      destructiveConfirmed: options.destructiveConfirmed === true,
    },
    async () => {
      const config = getModel(modelId);
      const agentMode = getToolsForMode(mode);
      const start = Date.now();

      const system = buildSystemMessage(ownerId, prompt, modelId, mode);

      console.log(`[agent] start model=${modelId} effort=${effort} mode=${mode}`);

      const result = await generateText({
        model: config.model,
        system,
        prompt,
        stopWhen: isStepCount(30),
        tools: agentMode,
        providerOptions: getProviderOptions(modelId, effort),
        abortSignal: options.abortSignal,
        onStepFinish: (step) => {
          console.log(
            `[agent] +${Date.now() - start}ms`,
            "tools:",
            step.toolCalls?.map((c) => c.toolName).join(", ") || "-",
            "in:",
            step.usage.inputTokens,
            "out:",
            step.usage.outputTokens,
            "think:",
            step.usage.outputTokenDetails?.reasoningTokens,
          );
        },
      });

      const toolsUsed = result.steps.flatMap(
        (s) => s.toolCalls?.map((c) => c.toolName) ?? [],
      );
      const finalText = persistExperience({
        ownerId,
        prompt,
        text: result.text ?? "",
        toolsUsed,
      });

      // Fallback: never return blank text.
      if (!result.text.trim()) {
        (result as { text: string }).text = finalText;
      }

      console.log(
        `[agent] done in ${Date.now() - start}ms, steps=${result.steps.length}`,
      );

      return result;
    },
  );
}

/**
 * Streaming entry point: emits `AgentStreamEvent`s through `options.onEvent`
 * as the model thinks, talks, and calls tools. Resolves when the turn is done.
 */
export async function runAgentStream(
  prompt: string,
  mode: AgentMode,
  modelId: ModelId = "anthropic/claude-sonnet-4-5",
  effort: Effort = "medium",
  options: RunAgentOptions = {},
): Promise<AgentRunResult> {
  const ownerId = options.ownerId ?? localOwnerId();

  return runWithMemoryContext(
    {
      ownerId,
      mode,
      destructiveConfirmed: options.destructiveConfirmed === true,
    },
    async () => {
      const start = Date.now();
      const config = getModel(modelId);
      const agentMode = getToolsForMode(mode);
      const system = buildSystemMessage(ownerId, prompt, modelId, mode);

      const emit = (event: AgentStreamEvent) => {
        try {
          options.onEvent?.(event);
        } catch (err) {
          // A broken transport must never kill the agent run.
          console.error("[agent] onEvent failed:", err);
        }
      };

      console.log(`[agent] stream start model=${modelId} effort=${effort} mode=${mode}`);
      emit({ type: "start", modelId, mode, effort });

      let stepIndex = 0;
      let stepTools: string[] = [];
      let usage: AgentUsage = {};
      const toolsUsed = new Set<string>();
      let streamError: string | null = null;
      let aborted = false;

      const result = streamText({
        model: config.model,
        system,
        prompt,
        stopWhen: isStepCount(30),
        tools: agentMode,
        providerOptions: getProviderOptions(modelId, effort),
        abortSignal: options.abortSignal,
        onStepFinish: (step) => {
          console.log(
            `[agent] +${Date.now() - start}ms`,
            "tools:",
            step.toolCalls?.map((c) => c.toolName).join(", ") || "-",
            "in:",
            step.usage.inputTokens,
            "out:",
            step.usage.outputTokens,
            "think:",
            step.usage.outputTokenDetails?.reasoningTokens,
          );
        },
      });

      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "start-step": {
              stepIndex += 1;
              stepTools = [];
              emit({ type: "step-start", index: stepIndex });
              break;
            }

            case "text-delta": {
              if (part.text) emit({ type: "text", text: part.text });
              break;
            }

            case "reasoning-delta": {
              if (part.text) emit({ type: "reasoning", text: part.text });
              break;
            }

            case "tool-input-start": {
              emit({ type: "tool-start", id: part.id, toolName: part.toolName });
              break;
            }

            case "tool-call": {
              toolsUsed.add(part.toolName);
              stepTools.push(part.toolName);
              const input = previewPayload(part.input, 2_000);
              emit({
                type: "tool-call",
                id: part.toolCallId,
                toolName: part.toolName,
                input: input.value,
              });
              break;
            }

            case "tool-result": {
              const output = previewPayload(part.output);
              emit({
                type: "tool-result",
                id: part.toolCallId,
                toolName: part.toolName,
                output: output.value,
                truncated: output.truncated || undefined,
              });
              break;
            }

            case "tool-error": {
              emit({
                type: "tool-error",
                id: part.toolCallId,
                toolName: part.toolName,
                error: errorMessage(part.error),
              });
              break;
            }

            case "finish-step": {
              const stepUsage = toUsage(part.usage);
              usage = stepUsage;
              emit({
                type: "step-finish",
                index: stepIndex,
                finishReason: part.finishReason,
                tools: [...stepTools],
                usage: stepUsage,
              });
              break;
            }

            case "error": {
              streamError = errorMessage(part.error);
              console.error("[agent] stream error:", part.error);
              emit({ type: "error", message: streamError });
              break;
            }

            case "abort": {
              aborted = true;
              console.log("[agent] stream aborted by client");
              emit({ type: "aborted" });
              break;
            }

            default:
              break;
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          aborted = true;
          console.log("[agent] stream aborted by client");
          emit({ type: "aborted" });
        } else {
          streamError = errorMessage(error);
          console.error("[agent] stream failed:", error);
          emit({ type: "error", message: streamError });
        }
      }

      // These resolve once the stream has been (fully or partially) consumed.
      let text = "";
      try {
        text = (await result.text) ?? "";
      } catch (error) {
        if (!isAbortError(error) && !streamError) {
          console.error("[agent] failed to read final text:", error);
        }
      }

      try {
        usage = toUsage(await result.totalUsage);
      } catch {
        /* keep last step usage */
      }

      let steps = stepIndex;
      try {
        steps = (await result.steps).length || stepIndex;
      } catch {
        /* keep counted steps */
      }

      const finalText = aborted
        ? text
        : persistExperience({
            ownerId,
            prompt,
            text,
            toolsUsed: [...toolsUsed],
          });

      // The model sometimes answers only through tool calls. Push the
      // synthesized summary through the stream so the UI isn't blank.
      if (!aborted && !text.trim() && finalText) {
        emit({ type: "text", text: finalText });
      }

      const durationMs = Date.now() - start;
      console.log(
        `[agent] stream ${aborted ? "aborted" : "done"} in ${durationMs}ms, steps=${steps}`,
      );

      emit({
        type: "done",
        text: finalText,
        usage,
        steps,
        durationMs,
      });

      return { text: finalText, usage, steps };
    },
  );
}
