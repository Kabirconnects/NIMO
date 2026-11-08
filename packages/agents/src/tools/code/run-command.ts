import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, safeEnv, clip } from "../shared/workspace.js";
import { spawn } from "node:child_process";

const ALLOW = new Set(["bun", "bunx", "npm", "pnpm", "node", "npx", "tsc", "git"]);

export const runCommandTool: Tool = tool({
  description:
    "Run an allowlisted command (bun/npm/pnpm/node/git/tsc) inside the workspace and return structured results. " +
    "Same sandbox as runTests: env-stripped, timeout-capped, output-capped. Use npm scripts, git status/diff, typecheck, builds.",

  inputSchema: z.object({
    command: z.string().min(1).max(200).describe("Command, e.g. 'bun run build' or 'git status --short'"),
    cwd: z.string().default(".").describe("Working directory relative to workspace"),
    timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
  }),

  execute: async ({ command, cwd, timeoutMs }) => {
    try {
      const dir = await resolveSafe(cwd);
      const [bin, ...args] = command.split(/\s+/);
      if (!ALLOW.has(bin as string)) throw new Error(`Command '${bin}' is not allowlisted`);
      const started = Date.now();
      const out = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        const child = spawn(bin as string, args as string[], {
          cwd: dir,
          env: safeEnv(),
          timeout: timeoutMs,
          shell: process.platform === "win32",
        });
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d) => { stdout += d; });
        child.stderr?.on("data", (d) => { stderr += d; });
        child.on("error", reject);
        child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
      });
      return {
        success: out.code === 0,
        exitCode: out.code,
        cwd: toRel(dir),
        durationMs: Date.now() - started,
        stdout: clip(out.stdout, 12_000),
        stderr: clip(out.stderr, 4_000),
      };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
