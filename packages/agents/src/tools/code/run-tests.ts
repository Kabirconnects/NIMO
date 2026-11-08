import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, safeEnv, clip } from "../shared/workspace.js";
import { spawn } from "node:child_process";
import path from "node:path";

export const runTestsTool: Tool = tool({
  description:
    "Run the project's test command (bun test / npm test / tsc --noEmit) and return the tail of the output. " +
    "Use after making a change to verify it works. Commands are allowlisted — no arbitrary shell.",

  inputSchema: z.object({
    command: z.enum(["bun test", "bunx tsc --noEmit", "npm test", "pnpm test", "vitest run"]).default("bun test")
      .describe("Test command to run"),
    timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
    cwd: z.string().default(".").describe("Working directory relative to workspace"),
  }),

  execute: async ({ command, timeoutMs, cwd }) => {
    try {
      const dir = await resolveSafe(cwd);
      const [bin, ...args] = command.split(/\s+/);
      if (!["bun", "bunx", "npm", "pnpm", "npx", "node"].includes(bin as string)) {
        throw new Error("Command not allowlisted");
      }
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
        tail: clip(out.stdout + (out.stderr ? "\n[stderr]\n" + out.stderr : ""), 12_000),
      };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
