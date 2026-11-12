import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, clip, tail } from "../shared/workspace.js";
import { assertCanRunShell } from "../shared/permissions.js";
import { runProcess } from "../shared/process.js";

export const runCommandTool: Tool = tool({
  description:
    "Run a development command inside the workspace and return structured output. " +
    "This is the general-purpose build/test/lint/git executor: 'pnpm build', 'bun run typecheck', " +
    "'git diff', 'npx tsc --noEmit', 'cargo test', 'pytest', etc. " +
    "Commands are parsed into an argv array (no shell), so pipes/redirects/chaining do not work; " +
    "use the dedicated search/read/write tools instead of shell pipelines. " +
    "Executables are allowlisted, the environment is scrubbed of API keys, output is capped " +
    "(keeping the tail where errors live), and a timeout kills the process tree. " +
    "Prefer argv=[...] when arguments contain spaces. Requires Auto mode or AGENT_ALLOW_SHELL=true.",

  inputSchema: z.object({
    command: z.string().min(1).max(4_000).optional()
      .describe("Command line, e.g. 'pnpm build --filter @workspace/agents'. Quotes group arguments."),
    argv: z.array(z.string().min(1).max(1_000)).min(1).max(100).optional()
      .describe("Explicit argument list; use this instead of command for precise arguments"),
    cwd: z.string().default(".").describe("Working directory relative to the workspace"),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000)
      .describe("Hard timeout in milliseconds (process tree is killed)"),
    stdin: z.string().max(1_000_000).optional()
      .describe("Data written to stdin, then stdin is closed"),
    env: z.record(z.string(), z.string()).optional()
      .describe("Extra environment variables (secrets/keys are silently dropped)"),
    maxOutputBytes: z.number().int().min(1_000).max(1_000_000).default(60_000)
      .describe("Per-stream output cap in bytes (the tail is kept)"),
  }),

  execute: async ({ command, argv, cwd, timeoutMs, stdin, env, maxOutputBytes }) => {
    try {
      assertCanRunShell();
      if (!command && !argv) {
        throw new Error("Provide either command or argv");
      }

      const dir = await resolveSafe(cwd);
      const result = await runProcess({
        command: argv ? undefined : command,
        argv,
        cwd: dir,
        timeoutMs,
        stdin,
        env,
        maxOutputBytes,
      });

      return {
        success: result.ok,
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
          ? "Command timed out; narrow the command or raise timeoutMs."
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
