import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, atomicWrite } from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";

import fsp from "node:fs/promises";

export const writeFileTool: Tool = tool({
  description:
    "Create or overwrite a file inside the workspace. Creates missing parent directories. " +
    "By default it refuses to overwrite an existing file - pass overwrite=true only when you intend to replace it. " +
    "Writes are atomic (temp file + rename) so a crash cannot leave a half-written file. " +
    "Requires write permission (Auto mode or AGENT_ALLOW_WRITE=true).",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative path of the file to write"),
    content: z.string().max(2_000_000).describe("Full file content"),
    overwrite: z.boolean().default(false)
      .describe("Replace an existing file (default false; new files only)"),
  }),

  execute: async ({ path: inputPath, content, overwrite }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      assertCanWrite("write");

      const existing = await fsp.lstat(full).catch(() => null);
      if (existing) {
        if (existing.isSymbolicLink()) {
          throw new Error("Refusing to write through a symbolic link");
        }
        if (!existing.isFile()) {
          throw new Error("Path exists and is not a regular file");
        }
        if (!overwrite) {
          throw new Error(
            "File already exists. Use editFile for a targeted change, or pass overwrite=true to replace it.",
          );
        }
      }

      await atomicWrite(full, content);

      const bytes = Buffer.byteLength(content, "utf-8");
      const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;

      return {
        success: true as const,
        operation: existing ? "overwritten" : "created",
        path: toRel(full),
        bytes,
        lines,
        hint:
          existing && overwrite
            ? "Overwrote an existing file. Consider editFile for smaller, reviewable changes."
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
