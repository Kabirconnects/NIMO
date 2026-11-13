import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, clip, tail } from "../shared/workspace.js";
import { assertCanRunShell } from "../shared/permissions.js";
import { runProcess, startBackgroundProcess } from "../shared/process.js";

export const runCommandTool: Tool = tool({
  description:
    "Run a development command inside the workspace and return its output. " +
    "This is the general-purpose build/test/lint/git/install/run executor: 'pnpm build', 'pnpm install', " +
    "'git diff', 'npx tsc --noEmit', 'cargo test', 'pytest', 'npm run dev', etc. " +
    "Commands are parsed into an argv array (no shell), so pipes/redirects/chaining do not work; " +
    "use the dedicated search/read/write tools instead of shell pipelines. " +
    "Executables are allowlisted and the environment is scrubbed of API keys. " +
    "LONG-RUNNING COMMANDS (dev servers, watchers, 'pnpm dev', 'npm start', docker compose up): " +
    "the tool waits up to waitMs (default 15s) for exit, then returns { running: true, id, pid, logFile } " +
    "and leaves the process running in the background - it does NOT hang and does NOT kill it. " +
    "Inspect it later with manageProcess (action='logs') and stop it with action='stop'; never start the " +
    "same server twice (an identical running command is reused automatically). " +
    "Use background=true to detach immediately, or waitMs=0 to do the same. " +
    "Prefer argv=[...] when arguments contain spaces. Requires Auto mode or AGENT_ALLOW_SHELL=true.",

  inputSchema: z.object({
    command: z.string().min(1).max(4_000).optional()
      .describe("Command line, e.g. 'pnpm build --filter @workspace/agents'. Quotes group arguments."),
    argv: z.array(z.string().min(1).max(1_000)).min(1).max(100).optional()
      .describe("Explicit argument list; use this instead of command for precise arguments"),
    cwd: z.string().default(".").describe("Working directory relative to the workspace"),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000)
      .describe("Kill the process tree if it is still running after this long (only when waitMs is omitted)"),
    waitMs: z.number().int().min(0).max(600_000).default(15_000)
      .describe(
        "Wait this long for the command to finish. If it is still running, return and leave it in the " +
          "background (id/logFile). Use 0 for servers/watchers so you get control back immediately.",
      ),
    background: z.boolean().default(false)
      .describe("Start detached and return immediately without waiting at all (same as waitMs=0)"),
    stdin: z.string().max(1_000_000).optional()
      .describe("Data written to stdin, then stdin is closed"),
    env: z.record(z.string(), z.string()).optional()
      .describe("Extra environment variables (secrets/keys are silently dropped)"),
    maxOutputBytes: z.number().int().min(1_000).max(1_000_000).default(60_000)
      .describe("Per-stream output cap in bytes (the tail is kept)"),
  }),

  execute: async ({
    command,
    argv,
    cwd,
    timeoutMs,
    waitMs,
    background,
    stdin,
    env,
    maxOutputBytes,
  }) => {
    try {
      assertCanRunShell();
      if (!command && !argv) {
        throw new Error("Provide either command or argv");
      }

      const dir = await resolveSafe(cwd);
      const base = {
        command: argv ? undefined : command,
        argv,
        cwd: dir,
        stdin,
        env,
        maxOutputBytes,
      };

      if (background) {
        const { info, reused } = startBackgroundProcess(base);
        return {
          success: true,
          running: true,
          reused,
          id: info.id,
          pid: info.pid,
          command: info.command,
          cwd: toRel(dir),
          logFile: info.relLogFile,
          startedAt: info.startedAt,
          note: reused
            ? "This exact command was already running; that process was reused. Use manageProcess " +
              "action='logs', id='" +
              info.id +
              "' to read output and action='stop' to kill it - do NOT start it again."
            : "Detached immediately. Check output with manageProcess action='logs', id='" +
              info.id +
              "' and stop it with action='stop'. Do not start it again.",
        };
      }

      const result = await runProcess({ ...base, timeoutMs, waitMs });

      if (result.running) {
        return {
          success: true,
          running: true,
          reused: result.reused === true,
          id: result.id,
          pid: result.pid,
          command: command ?? argv?.join(" "),
          cwd: toRel(dir),
          logFile: result.logFile,
          durationMs: result.durationMs,
          stdout: clip(result.stdout, 20_000),
          stderr: clip(result.stderr, 20_000),
          tail: tail(
            [result.stdout, result.stderr].filter(Boolean).join("\n--- stderr ---\n"),
            12_000,
          ),
          note: result.reused
            ? "This exact command was already running; that process was reused. Use manageProcess " +
              "action='logs' to read its output or action='stop' to kill it - do NOT start it again."
            : "Still running after the wait window; left in the background on purpose. Use manageProcess " +
              "action='logs' to check progress, or action='stop' when done. Do NOT start it again.",
        };
      }

      return {
        success: result.ok,
        running: false,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        truncated: result.truncated,
        cwd: toRel(dir),
        durationMs: result.durationMs,
        stdout: clip(result.stdout, 20_000),
        stderr: clip(result.stderr, 20_000),
        tail: tail(
          [result.stdout, result.stderr].filter(Boolean).join("\n--- stderr ---\n"),
          12_000,
        ),
        hint: result.timedOut
          ? "Command timed out and was killed. For a server/watcher use background=true so it keeps running; otherwise narrow the command or raise timeoutMs."
          : result.truncated
            ? "Output was capped; the tail is shown so errors remain visible."
            : undefined,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
