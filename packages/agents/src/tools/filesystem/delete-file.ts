import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable } from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";

import fsp from "node:fs/promises";

export const deleteFileTool: Tool = tool({
  description:
    "Delete a single file inside the workspace. " +
    "Refuses directories, symbolic links, .git contents, secrets, and memory-store files. " +
    "Use dryRun=true to confirm the target first. Requires write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative path of the file to delete"),
    dryRun: z.boolean().default(false).describe("Report what would be deleted without deleting"),
  }),

  execute: async ({ path: inputPath, dryRun }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      assertCanWrite("delete");

      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be deleted");
      if (!stat.isFile()) throw new Error("Path is not a regular file");

      if (!dryRun) await fsp.unlink(full);

      return {
        success: true as const,
        operation: dryRun ? "dry-run" : "deleted",
        path: toRel(full),
        bytes: stat.size,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
