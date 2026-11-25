import type { AgentMode, ModeConfig } from "./tools-mode-types.js";

// Memory tools are split by capability. Reads are available in every mode.
// Writes are Auto-only: Chat and Plan run on untrusted input, and a memory
// written there becomes durable context for every later session, so an
// injected instruction could poison the brain. Deletion is Auto-only too, and
// additionally needs explicit human confirmation, which is what makes
// forgetMemory Auto-only.
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
        description: "Agent-in-conversation — reads memory, no writes",
        tools: [...MEMORY_READ_TOOLS, ...RESEARCH_TOOLS],
        allowWrite: false,
        allowShell: false,
      };

    case "Plan":
      return {
        id: "Plan",
        description: "Analyze tasks and create plans (read-only orientation)",
        tools: [
          ...READ_TOOLS,
          ...MEMORY_READ_TOOLS,
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
