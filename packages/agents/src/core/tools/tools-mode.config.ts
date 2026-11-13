import type { AgentMode, ModeConfig } from "./tools-mode-types.js";

// Memory tools are split by capability. Reading AND writing memory is how the
// agent learns, so both are available in every mode; only destructive
// operations are gated (Auto + explicit human confirmation).
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
const READ_TOOLS = [
  "listFiles",
  "readFile",
  "search",
  "explainFile",
  "listWorkspaceTools",
  "callWorkspaceTool",
  // Process inspection (list/logs) is read-only; stop is gated inside the tool.
  "manageProcess",
];
const WRITE_TOOLS = [
  "writeFile",
  "editFile",
  "deleteFile",
  "mkdir",
  "deleteDir",
  "runTests",
  "refactor",
  "runCommand",
  "gitStatus",
  "benchmark",
  "createTool",
];

export function getModeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case "Chat":
      return {
        id: "Chat",
        description: "Agent-in-conversation — learns every turn through memory, no file writes",
        tools: [...MEMORY_READ_TOOLS, ...MEMORY_WRITE_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Plan":
      return {
        id: "Plan",
        description: "Analyze tasks and create plans (read-only orientation, memory still learns)",
        tools: [
          ...READ_TOOLS,
          ...MEMORY_READ_TOOLS,
          ...MEMORY_WRITE_TOOLS,
          ...RESEARCH_TOOLS,
        ],
        allowWrite: false,
        allowShell: false,
      };

    case "Auto":
      return {
        id: "Auto",
        description: "Autonomously execute development tasks, run long-lived processes, verify with tests",
        tools: [
          ...READ_TOOLS,
          ...WRITE_TOOLS,
          ...MEMORY_READ_TOOLS,
          ...MEMORY_WRITE_TOOLS,
          ...MEMORY_DESTRUCTIVE_TOOLS,
          ...RESEARCH_TOOLS,
        ],
        allowWrite: true,
        allowShell: true,
      };
  }
}
