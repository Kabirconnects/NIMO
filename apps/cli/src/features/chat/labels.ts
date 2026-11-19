import type { AgentMode, Effort } from "./types";

export const MODE_LABELS: Record<AgentMode, string> = {
  Chat: "Chat",
  Plan: "Plan",
  Auto: "Auto",
};

export const EFFORT_LABELS: Record<Effort, string> = {
  none: "None",
  low: "Fast",
  medium: "Balanced",
  high: "Deep",
};

/** `anthropic/claude-sonnet-4-5` -> `claude sonnet 4 5`. */
export function prettyModelId(modelId: string): string {
  const name = modelId.split("/").pop() ?? modelId;
  return name.replace(/[-_]/g, " ");
}
