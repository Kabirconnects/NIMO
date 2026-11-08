import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, ALLOW_WRITE } from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const mkdirTool: Tool = tool({
  description:
    "Create a directory inside the workspace (recursive). Requires write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative directory path to create"),
  }),

  execute: async ({ path: inputPath }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      if (!ALLOW_WRITE) throw new Error("Write is disabled for this mode");

      await fsp.mkdir(full, { recursive: true });
      return { success: true as const, path: toRel(full) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
