import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, clip } from "../shared/workspace.js";
import { assertCanRunShell } from "../shared/permissions.js";
import { runProcess } from "../shared/process.js";

function parseStatus(output: string): { branch?: string; files: { code: string; path: string }[] } {
  const files: { code: string; path: string }[] = [];
  let branch: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("##")) {
      branch = line.replace(/^##\s*/, "");
      continue;
    }
    const code = line.slice(0, 2).trim();
    const name = line.slice(3).trim();
    if (name) files.push({ code: code || "?", path: name });
  }
  return { branch, files };
}

export const gitStatusTool: Tool = tool({
  description:
    "Read-only git inspection for reviewing your own work: status (with changed files), " +
    "working-tree diff, staged diff, diffstat, recent log, a single commit summary, or branches. " +
    "Use before reporting completion so changes are verified, not just claimed. " +
    "Never mutates the repository (no commit/checkout/reset).",

  inputSchema: z.object({
    kind: z.enum(["status", "diff", "diff-stat", "log", "show", "branch"])
      .default("status")
      .describe("What to inspect"),
    cwd: z.string().default(".").describe("Working directory relative to the workspace"),
    staged: z.boolean().default(false)
      .describe("For diff/diff-stat: show staged changes (git diff --cached)"),
    path: z.string().optional()
      .describe("Optional path filter for diff/diff-stat, relative to cwd"),
    ref: z.string().max(200).optional()
      .describe("Optional revision for log/show/diff, e.g. 'HEAD~1' or a branch name"),
    limit: z.number().int().min(1).max(100).default(20)
      .describe("For log: number of commits"),
    maxChars: z.number().int().min(500).max(100_000).default(20_000)
      .describe("Cap on returned output characters"),
  }),

  execute: async ({ kind, cwd, staged, path: filterPath, ref, limit, maxChars }) => {
    try {
      assertCanRunShell();
      const dir = await resolveSafe(cwd);

      let args: string[];
      switch (kind) {
        case "status":
          args = ["status", "--short", "--branch"];
          break;
        case "diff":
          args = ["diff", "--no-color", ...(staged ? ["--cached"] : [])];
          if (ref) args.push(ref);
          if (filterPath) args.push("--", filterPath);
          break;
        case "diff-stat":
          args = ["diff", "--stat", ...(staged ? ["--cached"] : [])];
          if (ref) args.push(ref);
          if (filterPath) args.push("--", filterPath);
          break;
        case "log":
          args = ["log", "--oneline", "--decorate", `-${limit}`];
          if (ref) args.push(ref);
          break;
        case "show":
          args = ["show", "--stat", "--no-color", ref ?? "HEAD"];
          break;
        case "branch":
        default:
          args = ["branch", "--no-color", "-vv"];
          break;
      }

      const result = await runProcess({
        argv: ["git", ...args],
        cwd: dir,
        timeoutMs: 30_000,
        maxOutputBytes: Math.min(Math.max(maxChars * 2, 20_000), 1_000_000),
      });

      const output = clip(result.stdout.trim() || result.stderr.trim(), maxChars);
      const status = kind === "status" ? parseStatus(result.stdout) : null;

      return {
        success: result.ok,
        kind,
        cwd: toRel(dir),
        args,
        exitCode: result.exitCode,
        ...(status ? { branch: status.branch, changedFiles: status.files } : {}),
        output,
        empty: output.length === 0,
        hint:
          kind === "status" && status?.files.length === 0
            ? "Working tree is clean."
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
