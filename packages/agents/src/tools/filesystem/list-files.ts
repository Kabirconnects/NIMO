import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  SKIP_DIRS,
  isSecret,
} from "../shared/workspace.js";

import fsp from "node:fs/promises";
import path from "node:path";

export const listFilesTool: Tool = tool({
  description:
    "List files and directories inside the agent workspace. " +
    "Can recursively inspect directories. Secret files and excluded directories are hidden.",

  inputSchema: z.object({
    path: z.string().default(".").describe(
      "Relative directory path inside the workspace",
    ),

    recursive: z.boolean().default(false).describe(
      "Whether to recursively list subdirectories",
    ),

    maxDepth: z.number().int().min(1).max(8).default(3),

    limit: z.number().int().min(1).max(1000).default(200),
  }),

  execute: async ({ path: inputPath, recursive, maxDepth, limit }) => {
    try {
      const root = await resolveSafe(inputPath);
      const rootStat = await fsp.stat(root);

      if (!rootStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const results: {
        path: string;
        name: string;
        type: "file" | "directory";
      }[] = [];

      let truncated = false;

      async function scan(dir: string, depth: number): Promise<void> {
        if (results.length >= limit) {
          truncated = true;
          return;
        }

        const entries = await fsp.readdir(dir, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          if (results.length >= limit) {
            truncated = true;
            return;
          }

          if (SKIP_DIRS.has(entry.name)) continue;

          const full = path.join(dir, entry.name);

          if (isSecret(full)) continue;

          // Ignore symbolic links.
          if (entry.isSymbolicLink()) continue;

          if (entry.isDirectory()) {
            results.push({
              path: toRel(full),
              name: entry.name,
              type: "directory",
            });

            if (recursive && depth < maxDepth) {
              await scan(full, depth + 1);
            }
          } else if (entry.isFile()) {
            results.push({
              path: toRel(full),
              name: entry.name,
              type: "file",
            });
          }
        }
      }

      await scan(root, 0);

      return {
        directory: toRel(root),
        count: results.length,
        truncated,
        files: results,
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