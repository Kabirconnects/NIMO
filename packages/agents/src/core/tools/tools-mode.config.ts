import type { AgentMode, ModeConfig } from "./tools-mode-types.js";

const MEMORY_TOOLS = [
  "remember",
  "recall",
  "linkMemories",
  "updateMemory",
  "forgetMemory",
  "getRelatedMemories",
  "getMemoryHistory",
  "teach",
  "teachSkill",
  "useSkill",
  "loadSkills",
  "getRecent",
];

const RESEARCH_TOOLS = ["webFetch", "extractData", "summarize"];
const READ_TOOLS = ["listFiles", "readFile", "search", "explainFile", "listWorkspaceTools", "callWorkspaceTool"];
const WRITE_TOOLS = ["writeFile", "editFile", "deleteFile", "mkdir", "deleteDir", "runTests", "refactor", "runCommand", "gitStatus", "benchmark", "createTool"];

export function getModeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case "Chat":
      return {
        id: "Chat",
        description: "Agent-in-conversation — chat, but still learns and remembers every turn",
        tools: [...MEMORY_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Plan":
      return {
        id: "Plan",
        description: "Analyze tasks and create plans (read-only orientation)",
        tools: [...READ_TOOLS, ...MEMORY_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Auto":
      return {
        id: "Auto",
        description: "Autonomously execute development tasks + verify with tests",
        tools: [...READ_TOOLS, ...WRITE_TOOLS, ...MEMORY_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: true,
        allowShell: false,
      };
  }
}
