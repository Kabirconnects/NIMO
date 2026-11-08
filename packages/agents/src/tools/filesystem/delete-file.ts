import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, ALLOW_WRITE } from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const deleteFileTool: Tool = tool({
  description:
    "Delete a file inside the workspace. Requires write permission (allowWrite mode). " +
    "Directories and secret files are blocked.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative file path to delete"),
  }),

  execute: async ({ path: inputPath }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      // Write permission is enforced by tool-mode: Chat/Plan don't include
      // deleteFile at all; Auto includes it. ALLOW_WRITE is a belt-and-
      // suspenders env check for CLI/manual runs where mode isn't in scope.
      if (!ALLOW_WRITE && !process.env.AGENT_ALLOW_WRITE && process.env.PAME_MODE && process.env.PAME_MODE !== "Auto") {
        throw new Error("Write is disabled for this mode");
      }

      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be deleted");
      if (stat.isDirectory()) throw new Error("Use deleteDir for directories");

      await fsp.unlink(full);
      return { success: true as const, operation: "deleted", path: toRel(full) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
