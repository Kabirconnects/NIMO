import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  assertWritable,
} from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const editFileTool: Tool = tool({
  description:
    "Edit an existing file inside the agent workspace by replacing an exact string. " +
    "The old text must occur exactly once. Requires workspace write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe(
      "Relative path of the file to edit",
    ),

    oldString: z.string().min(1).describe(
      "Exact existing text to replace",
    ),

    newString: z.string().describe(
      "Replacement text",
    ),
  }),

  execute: async ({ path: inputPath, oldString, newString }) => {
    try {
      const full = await resolveSafe(inputPath);

      assertWritable(full);

      const stat = await fsp.lstat(full);

      if (stat.isSymbolicLink()) {
        throw new Error("Symbolic links cannot be edited");
      }

      if (!stat.isFile()) {
        throw new Error("Path is not a regular file");
      }

      if (stat.size > 1_000_000) {
        throw new Error("File is too large to edit (maximum 1 MB)");
      }

      const content = await fsp.readFile(full, "utf-8");

      const firstIndex = content.indexOf(oldString);

      if (firstIndex === -1) {
        throw new Error("Target text was not found");
      }

      const secondIndex = content.indexOf(
        oldString,
        firstIndex + oldString.length,
      );

      if (secondIndex !== -1) {
        throw new Error(
          "Target text occurs multiple times. Provide a more specific string.",
        );
      }

      const updated = content.replace(oldString, newString);

      await fsp.writeFile(full, updated, "utf-8");

      return {
        success: true,
        operation: "edited",
        path: toRel(full),
        replacements: 1,
        bytes: Buffer.byteLength(updated, "utf-8"),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : String(error),
      };
    }
  },
});