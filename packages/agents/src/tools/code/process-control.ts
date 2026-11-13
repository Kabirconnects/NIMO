import { tool, type Tool } from "ai";
import { z } from "zod";

import { assertCanRunShell } from "../shared/permissions.js";
import {
  listBackgroundProcesses,
  readBackgroundLogs,
  stopBackgroundProcess,
  type BackgroundProcessInfo,
} from "../shared/process.js";

function uptime(info: BackgroundProcessInfo): number {
  const started = Date.parse(info.startedAt);
  const end = info.endedAt ? Date.parse(info.endedAt) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - started);
}

function summarize(info: BackgroundProcessInfo) {
  return {
    id: info.id,
    status: info.status,
    command: info.command,
    cwd: info.relCwd,
    pid: info.pid,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    exitCode: info.exitCode ?? null,
    uptimeMs: uptime(info),
    logFile: info.relLogFile,
  };
}

const ACTIONS = ["list", "logs", "stop", "stopAll"] as const;

export const manageProcessTool: Tool = tool({
  description:
    "Inspect and control long-running commands started by runCommand (dev servers, watchers, installs). " +
    'action="list" shows every known process with its status, id, pid, command, cwd and log file. ' +
    'action="logs" returns the captured stdout/stderr tail for one process id - use this to check whether a server started, ' +
    "what port it chose, or why it crashed, WITHOUT re-running the command. " +
    'action="stop" kills one process tree; action="stopAll" kills every running one. ' +
    "Never start the same command twice: if a process with the same command is already running, runCommand reuses it. " +
    "Listing and logs are read-only; stopping requires Auto mode or AGENT_ALLOW_SHELL=true.",

  inputSchema: z.object({
    action: z.enum(ACTIONS).default("list")
      .describe("list | logs | stop | stopAll"),
    id: z.string().min(1).max(120).optional()
      .describe("Process id from action=\"list\" (required for logs/stop)"),
    tailBytes: z.number().int().min(1_000).max(200_000).default(24_000)
      .describe("How many bytes of each log stream to return (logs)"),
  }),

  execute: async ({ action, id, tailBytes }) => {
    try {
      if (action === "list") {
        const processes = listBackgroundProcesses().map(summarize);
        const running = processes.filter((p) => p.status === "running").length;
        return {
          success: true as const,
          count: processes.length,
          running,
          processes,
          hint:
            running > 0
              ? 'Use action="logs" with an id to read output, or action="stop" to kill it.'
              : processes.length === 0
                ? "No background processes yet. Long commands (dev servers, watchers) appear here after runCommand."
                : undefined,
        };
      }

      if (action === "logs") {
        if (!id) throw new Error('action="logs" requires an id (see action="list")');
        const logs = readBackgroundLogs(id, tailBytes);
        return {
          success: true as const,
          ...logs,
          note:
            logs.status === "running"
              ? "Still running. Call logs again later for newer output instead of starting another server."
              : undefined,
        };
      }

      if (action === "stop") {
        if (!id) throw new Error('action="stop" requires an id (see action="list")');
        assertCanRunShell();
        const stopped = stopBackgroundProcess(id);
        return {
          success: true as const,
          id: stopped.id,
          command: stopped.command,
          status: stopped.status,
          logFile: stopped.relLogFile,
        };
      }

      // stopAll
      assertCanRunShell();
      const running = listBackgroundProcesses().filter((p) => p.status === "running");
      const stopped = running.map((p) => {
        try {
          return stopBackgroundProcess(p.id).id;
        } catch {
          return null;
        }
      });
      return {
        success: true as const,
        stopped: stopped.filter(Boolean),
        count: stopped.filter(Boolean).length,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
