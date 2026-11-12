import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, ROOT } from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";

import fsp from "node:fs/promises";
import path from "node:path";

export const deleteDirTool: Tool = tool({
  description:
    "Recursively delete a directory inside the workspace. " +
    "Cannot delete the workspace root, .git, secrets, or the memory store. " +
    "Use dryRun=true to list what would be removed first. Requires write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative directory path to delete"),
    dryRun: z.boolean().default(false).describe("Report the target without deleting"),
    maxReport: z.number().int().min(1).max(500).default(50)
      .describe("Maximum entries to list in the dry-run report"),
  }),

  execute: async ({ path: inputPath, dryRun, maxReport }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      assertCanWrite("delete");

      if (path.resolve(full) === path.resolve(ROOT)) {
        throw new Error("Cannot delete the workspace root");
      }

      const stat = await fsp.lstat(full);
      if (!stat.isDirectory()) throw new Error("Path is not a directory");

      if (dryRun) {
        const entries: string[] = [];
        const walk = async (dir: string, depth: number): Promise<void> => {
          if (entries.length >= maxReport || depth > 12) return;
          const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const item of items) {
            if (entries.length >= maxReport) return;
            const child = path.join(dir, item.name);
            entries.push(toRel(child) + (item.isDirectory() ? "/" : ""));
            if (item.isDirectory() && !item.isSymbolicLink()) {
              await walk(child, depth + 1);
            }
          }
        };
        await walk(full, 0);
        return {
          success: true as const,
          operation: "dry-run",
          path: toRel(full),
          entries,
          truncated: entries.length >= maxReport,
        };
      }

      await fsp.rm(full, { recursive: true, force: false });

      return {
        success: true as const,
        operation: "deleted",
        path: toRel(full),
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
