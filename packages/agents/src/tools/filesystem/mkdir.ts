import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable } from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";

import fsp from "node:fs/promises";

export const mkdirTool: Tool = tool({
  description:
    "Create a directory (and any missing parents) inside the workspace. " +
    "Safe to call when it already exists. Requires write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative directory path to create"),
  }),

  execute: async ({ path: inputPath }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      assertCanWrite("mkdir");

      const existing = await fsp.stat(full).catch(() => null);
      if (existing && !existing.isDirectory()) {
        throw new Error("Path exists and is not a directory");
      }

      await fsp.mkdir(full, { recursive: true });

      return {
        success: true as const,
        operation: existing ? "exists" : "created",
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
