import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  isSecret,
} from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const readFileTool: Tool = tool({
  description:
    "Read the contents of a file inside the agent workspace. " +
    "Secret files are blocked and large files are truncated.",

  inputSchema: z.object({
    path: z.string().min(1).describe(
      "Relative file path inside the workspace",
    ),

    maxBytes: z.number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(100_000),
  }),

  execute: async ({ path: inputPath, maxBytes }) => {
    try {
      const full = await resolveSafe(inputPath);

      if (isSecret(full)) {
        throw new Error("Secret files are blocked");
      }

      const stat = await fsp.stat(full);

      if (!stat.isFile()) {
        throw new Error("Path is not a file");
      }

      const buffer = await fsp.readFile(full);

      const truncated = buffer.length > maxBytes;

      const content = buffer
        .subarray(0, maxBytes)
        .toString("utf-8");

      return {
        path: toRel(full),
        size: stat.size,
        truncated,
        content,
      };
    } catch (error) {
      return {
        error: error instanceof Error
          ? error.message
          : String(error),
      };
    }
  },
});