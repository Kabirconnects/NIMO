import type { AgentMode, ModeConfig } from "./tools-mode-types.js";

// Memory tools are split by capability so Chat/Plan cannot write or delete.
const MEMORY_READ_TOOLS = [
  "recall",
  "getRelatedMemories",
  "getMemoryHistory",
  "loadSkills",
  "getRecent",
];

const MEMORY_WRITE_TOOLS = [
  "remember",
  "linkMemories",
  "updateMemory",
  "teach",
  "teachSkill",
  "useSkill",
];

const MEMORY_DESTRUCTIVE_TOOLS = ["forgetMemory"];

const RESEARCH_TOOLS = ["webFetch", "extractData", "summarize"];
const READ_TOOLS = ["listFiles", "readFile", "search", "explainFile", "listWorkspaceTools", "callWorkspaceTool"];
const WRITE_TOOLS = ["writeFile", "editFile", "deleteFile", "mkdir", "deleteDir", "runTests", "refactor", "runCommand", "gitStatus", "benchmark", "createTool"];

export function getModeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case "Chat":
      return {
        id: "Chat",
        description: "Agent-in-conversation — read-only memory, still learns via server-side capture",
        tools: [...MEMORY_READ_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Plan":
      return {
        id: "Plan",
        description: "Analyze tasks and create plans (read-only orientation)",
        tools: [...READ_TOOLS, ...MEMORY_READ_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Auto":
      return {
        id: "Auto",
        description: "Autonomously execute development tasks + verify with tests",
        tools: [
          ...READ_TOOLS,
          ...WRITE_TOOLS,
          ...MEMORY_READ_TOOLS,
          ...MEMORY_WRITE_TOOLS,
          ...MEMORY_DESTRUCTIVE_TOOLS,
          ...RESEARCH_TOOLS,
        ],
        allowWrite: true,
        allowShell: false,
      };
  }
}
