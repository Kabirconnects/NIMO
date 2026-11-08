import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, safeEnv } from "../shared/workspace.js";
import { spawn } from "node:child_process";

export const gitStatusTool: Tool = tool({
  description:
    "Read-only git inspection: status --short, diff --stat, and recent commits. " +
    "Use to see what the agent changed before committing — verifiable, not just claimable.",

  inputSchema: z.object({
    kind: z.enum(["status", "diff", "log"]).default("status"),
    cwd: z.string().default("."),
  }),

  execute: async ({ kind, cwd }) => {
    try {
      const dir = await resolveSafe(cwd);
      const args =
        kind === "status" ? ["status", "--short"] :
        kind === "diff" ? ["diff", "--stat"] :
        ["log", "--oneline", "-10"];
      const out = await new Promise<string>((resolve, reject) => {
        const c = spawn("git", args, { cwd: dir, env: safeEnv(), timeout: 15_000 });
        let s = "";
        c.stdout?.on("data", (d) => { s += d; });
        c.stderr?.on("data", (d) => { s += d; });
        c.on("error", reject);
        c.on("close", () => resolve(s.trim()));
      });
      return { success: true as const, kind, cwd: toRel(dir), output: out.slice(0, 8_000) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
