export type Effort = "none" | "low" | "medium" | "high";

export interface ChatInput {
  prompt: string;
  modelId?: string;
  mode?: "Chat" | "Plan" | "Auto";
  effort?: Effort;
  confirmDestructive?: boolean;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/** Mirror of the server-side `AgentStreamEvent` union. */
export type AgentStreamEvent =
  | { type: "start"; modelId: string; mode: string; effort: Effort }
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

export type ToolStatus = "running" | "success" | "error";

export type ReasoningPart = { type: "reasoning"; id: string; text: string };

export type TextPart = { type: "text"; id: string; text: string };

export type ToolPart = {
  type: "tool";
  id: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  truncated?: boolean;
  status: ToolStatus;
};

export type ErrorPart = { type: "error"; id: string; text: string };

export type AssistantPart =
  | ReasoningPart
  | TextPart
  | ToolPart
  | ErrorPart;

export type UserChatMessage = {
  id: string;
  role: "user";
  text: string;
};

export type AssistantChatMessage = {
  id: string;
  role: "assistant";
  parts: AssistantPart[];
  streaming: boolean;
  modelId?: string;
  steps?: number;
  durationMs?: number;
  usage?: AgentUsage;
};

export type ChatMessage = UserChatMessage | AssistantChatMessage;
