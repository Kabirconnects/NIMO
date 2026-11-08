export type AgentMode = "Chat" | "Plan" | "Auto";

export interface ModeConfig {
  id: AgentMode;
  description: string;
  tools: string[];
  allowWrite: boolean;
  allowShell: boolean;
}
