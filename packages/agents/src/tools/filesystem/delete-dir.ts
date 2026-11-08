import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, ALLOW_WRITE, ROOT } from "../shared/workspace.js";

import fsp from "node:fs/promises";
import path from "node:path";

export const deleteDirTool: Tool = tool({
  description:
    "Delete a directory recursively inside the workspace. Requires write permission. " +
    "Cannot delete the workspace root.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative directory path to delete"),
  }),

  execute: async ({ path: inputPath }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      if (!ALLOW_WRITE) throw new Error("Write is disabled for this mode");
      if (path.resolve(full) === path.resolve(ROOT)) throw new Error("Cannot delete workspace root");

      const stat = await fsp.lstat(full);
      if (!stat.isDirectory()) throw new Error("Path is not a directory");

      await fsp.rm(full, { recursive: true, force: false });
      return { success: true as const, operation: "deleted", path: toRel(full) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
