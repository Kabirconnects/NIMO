import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, SKIP_DIRS, isSecret } from "../shared/workspace.js";
import { isGlobPattern, matchesGlob } from "../shared/glob.js";

import fsp from "node:fs/promises";
import path from "node:path";

type EntryType = "file" | "directory";
type SortBy = "path" | "name" | "size" | "mtime";

interface Entry {
  path: string;
  name: string;
  type: EntryType;
  depth: number;
  size?: number;
  mtime?: string;
}

const asPatterns = (value?: string | string[]): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

function matchesFilter(relPath: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) =>
    isGlobPattern(p) ? matchesGlob(relPath, p) : relPath.toLowerCase().endsWith(p.toLowerCase()),
  );
}

export const listFilesTool: Tool = tool({
  description:
    "List files and directories in the workspace, like a safe recursive `ls`. " +
    "Supports glob filters, depth limits, metadata (size/mtime), and sorting. " +
    "Use to orient yourself in a project: find source roots, config files, or test folders. " +
    "Skips node_modules/.git/build output, symlinks, secrets, and (by default) dotfiles.",

  inputSchema: z.object({
    path: z.string().default(".").describe("Directory to list, relative to the workspace"),
    recursive: z.boolean().default(false).describe("Descend into subdirectories"),
    maxDepth: z.number().int().min(1).max(12).default(4)
      .describe("Maximum recursion depth (only used when recursive=true)"),
    limit: z.number().int().min(1).max(2_000).default(500)
      .describe("Maximum entries to return"),
    pattern: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Glob(s) or suffix(es) for files, e.g. '**/*.ts' or ['.ts', '.json']"),
    includeFiles: z.boolean().default(true).describe("Include files in the listing"),
    includeDirs: z.boolean().default(true).describe("Include directories in the listing"),
    showHidden: z.boolean().default(false).describe("Include dotfiles/dot-directories"),
    sortBy: z.enum(["path", "name", "size", "mtime"]).default("path")
      .describe("Sort order (size/mtime sort descending, path/name ascending)"),
  }),

  execute: async ({
    path: inputPath,
    recursive,
    maxDepth,
    limit,
    pattern,
    includeFiles,
    includeDirs,
    showHidden,
    sortBy,
  }) => {
    try {
      const root = await resolveSafe(inputPath);
      const rootStat = await fsp.stat(root);

      if (!rootStat.isDirectory()) {
        return {
          error: "Path is not a directory. Use readFile to inspect a file.",
        };
      }

      const patterns = asPatterns(pattern);
      const results: Entry[] = [];
      let truncated = false;

      const scan = async (dir: string, depth: number): Promise<void> => {
        if (results.length >= limit) {
          truncated = true;
          return;
        }

        let entries: import("node:fs").Dirent[];
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= limit) {
            truncated = true;
            return;
          }
          if (entry.isSymbolicLink()) continue;
          if (SKIP_DIRS.has(entry.name)) continue;
          if (!showHidden && entry.name.startsWith(".")) continue;

          const full = path.join(dir, entry.name);
          if (isSecret(full)) continue;

          const rel = toRel(full);

          if (entry.isDirectory()) {
            if (includeDirs) {
              const stat = await fsp.stat(full).catch(() => null);
              results.push({
                path: rel,
                name: entry.name,
                type: "directory",
                depth,
                mtime: stat?.mtime.toISOString(),
              });
            }
            if (recursive && depth < maxDepth) {
              await scan(full, depth + 1);
            }
            continue;
          }

          if (!entry.isFile()) continue;
          if (!includeFiles) continue;
          if (!matchesFilter(rel, patterns)) continue;

          const stat = await fsp.stat(full).catch(() => null);
          results.push({
            path: rel,
            name: entry.name,
            type: "file",
            depth,
            size: stat?.size,
            mtime: stat?.mtime.toISOString(),
          });
        }
      };

      await scan(root, 1);

      results.sort((a, b) => {
        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "size":
            return (b.size ?? 0) - (a.size ?? 0);
          case "mtime":
            return (b.mtime ?? "").localeCompare(a.mtime ?? "");
          case "path":
          default:
            return a.path.localeCompare(b.path);
        }
      });

      const shown = results.slice(0, limit);
      return {
        directory: toRel(root),
        count: shown.length,
        truncated,
        recursive,
        entries: shown,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
