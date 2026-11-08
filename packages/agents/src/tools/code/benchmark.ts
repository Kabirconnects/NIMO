import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, safeEnv, clip } from "../shared/workspace.js";
import { spawn } from "node:child_process";

export const benchmarkTool: Tool = tool({
  description:
    "Run a command N times, time each run, and return stats (mean/min/max). " +
    "Use for research: measure latency, throughput, or test duration, then save the result into memory as an experience.",

  inputSchema: z.object({
    command: z.string().min(1).max(200).describe("Command to measure, e.g. 'bun test'"),
    runs: z.number().int().min(1).max(20).default(3),
    timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
    cwd: z.string().default("."),
  }),

  execute: async ({ command, runs, timeoutMs, cwd }) => {
    try {
      const dir = await resolveSafe(cwd);
      const [bin, ...args] = command.split(/\s+/);
      if (!["bun", "bunx", "npm", "pnpm", "node", "npx"].includes(bin as string)) {
        throw new Error("Command not allowlisted for benchmark");
      }
      const times: number[] = [];
      let lastOut = "";
      for (let i = 0; i < runs; i++) {
        const started = Date.now();
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const c = spawn(bin as string, args as string[], { cwd: dir, env: safeEnv(), timeout: timeoutMs, shell: process.platform === "win32" });
          let so = "", se = "";
          c.stdout?.on("data", (d) => { so += d; });
          c.stderr?.on("data", (d) => { se += d; });
          c.on("error", reject);
          c.on("close", () => resolve({ stdout: so, stderr: se }));
        });
        times.push(Date.now() - started);
        lastOut = stdout + stderr;
      }
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      return {
        success: true as const,
        command,
        runs,
        meanMs: Math.round(mean),
        minMs: Math.min(...times),
        maxMs: Math.max(...times),
        sample: clip(lastOut, 2_000),
      };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
