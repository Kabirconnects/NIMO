import {
  listFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  searchTool,
  deleteFileTool,
  mkdirTool,
  deleteDirTool,
} from "./filesystem/index.js";
import {
  runTestsTool, explainFileTool, refactorTool,
  runCommandTool, gitStatusTool, benchmarkTool,
  createToolTool, listWorkspaceToolsTool, callWorkspaceToolTool,
  manageProcessTool,
} from "./code/index.js";
import { webFetchTool, extractDataTool, summarizeTool } from "./research/index.js";
import { memoryTools } from "@workspace/memory";
import type { ToolSet } from "ai";

export const tools: ToolSet = {
  // filesystem
  listFiles: listFilesTool,
  readFile: readFileTool,
  writeFile: writeFileTool,
  editFile: editFileTool,
  search: searchTool,
  deleteFile: deleteFileTool,
  mkdir: mkdirTool,
  deleteDir: deleteDirTool,
  // code (orientation + verify + refactor + benchmark + foundry)
  runTests: runTestsTool,
  explainFile: explainFileTool,
  refactor: refactorTool,
  runCommand: runCommandTool,
  manageProcess: manageProcessTool,
  gitStatus: gitStatusTool,
  benchmark: benchmarkTool,
  createTool: createToolTool,
  listWorkspaceTools: listWorkspaceToolsTool,
  callWorkspaceTool: callWorkspaceToolTool,
  // research
  webFetch: webFetchTool,
  extractData: extractDataTool,
  summarize: summarizeTool,
  // memory (PAME — one endless stream)
  ...memoryTools,
};
