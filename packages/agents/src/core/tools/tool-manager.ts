import type { ToolSet } from "ai";
import { tools } from "../../tools/index.js";
import type { AgentMode } from "./tools-mode-types.js";
import { getModeConfig } from "./tools-mode.config.js";

export function getToolsForMode(mode: AgentMode): ToolSet {
  const config = getModeConfig(mode);

  const out: Record<string, unknown> = {};
  for (const name of config.tools) {
    const t = tools[name as keyof typeof tools];
    if (t) out[name] = t;   // skip if unknown — no undefined for the model
  }
  return out as ToolSet;
}


// const r = getToolsForMode("Plan");

// console.log(r);

//   pnpm --filter @workspace/agents exec tsx src/core/tools/tool-manager.ts
