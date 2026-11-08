import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  assertWritable,
} from "../shared/workspace.js";

import fsp from "node:fs/promises";
import path from "node:path";

export const writeFileTool: Tool = tool({
  description:
    "Create a new file inside the agent workspace. " +
    "Creates any missing parent directories. " +
    "Will not overwrite existing files. Requires workspace write permission.",

  inputSchema: z.object({
    path: z.string().min(1).describe(
      "Relative path of the new file",
    ),

    content: z.string().max(1_000_000).describe(
      "Content to write into the new file",
    ),
  }),

  execute: async ({ path: inputPath, content }) => {
    try {
      const full = await resolveSafe(inputPath);

      assertWritable(full);

      await fsp.mkdir(path.dirname(full), { recursive: true });

      const handle = await fsp.open(full, "wx");

      try {
        await handle.writeFile(content, "utf-8");
      } catch (error) {
        await handle.close();

        await fsp.unlink(full).catch(() => {});

        throw error;
      }

      await handle.close();

      return {
        success: true,
        operation: "created",
        path: toRel(full),
        bytes: Buffer.byteLength(content, "utf-8"),
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