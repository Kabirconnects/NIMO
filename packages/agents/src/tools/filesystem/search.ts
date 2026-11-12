import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  readTextFile,
  walkFiles,
} from "../shared/workspace.js";
import { isGlobPattern, matchesGlob } from "../shared/glob.js";
import fsp from "node:fs/promises";

const MAX_LINE_CHARS = 400;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const asPatterns = (value?: string | string[]): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

function matchesFilter(relPath: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) =>
    isGlobPattern(p) ? matchesGlob(relPath, p) : relPath.toLowerCase().endsWith(p.toLowerCase()),
  );
}

export const searchTool: Tool = tool({
  description:
    "Search file contents across the workspace (grep/rg style). " +
    "Plain substring by default, regex when regex=true; optional whole-word, case sensitivity, " +
    "glob include/exclude filters, and surrounding context lines. " +
    "outputMode='content' returns matches, 'files' returns only matching paths, 'count' returns per-file counts. " +
    "Use this before editing to locate functions, strings, configs, or tests. " +
    "Skips node_modules/.git/build output, binary files, and secrets.",

  inputSchema: z.object({
    pattern: z.string().min(1).max(2_000).describe("Text or regular expression to find"),
    path: z.string().default(".").describe("Directory or file to search, relative to the workspace"),
    regex: z.boolean().default(false).describe("Interpret pattern as a regular expression"),
    caseSensitive: z.boolean().default(false).describe("Match case exactly (default insensitive)"),
    wholeWord: z.boolean().default(false).describe("Only match whole words"),
    include: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Glob(s) or suffix(es) for files to include, e.g. '**/*.ts' or ['.ts', '.tsx']"),
    exclude: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Glob(s) or suffix(es) for files to skip, e.g. '**/*.test.ts'"),
    contextLines: z.number().int().min(0).max(5).default(0)
      .describe("Lines of context to include before and after each match"),
    limit: z.number().int().min(1).max(500).default(100)
      .describe("Maximum matches (or files) to return"),
    maxFileBytes: z.number().int().min(1_000).max(5_000_000).default(1_000_000)
      .describe("Skip files larger than this many bytes"),
    outputMode: z.enum(["content", "files", "count"]).default("content")
      .describe("content = match lines; files = unique paths; count = per-file match counts"),
  }),

  execute: async ({
    pattern,
    path: inputPath,
    regex,
    caseSensitive,
    wholeWord,
    include,
    exclude,
    contextLines,
    limit,
    maxFileBytes,
    outputMode,
  }) => {
    try {
      const root = await resolveSafe(inputPath);
      const flags = `${caseSensitive ? "" : "i"}g`;
      const source = regex
        ? pattern
        : `(?:${escapeRegExp(pattern)})`;
      const bounded = wholeWord ? `\\b${source}\\b` : source;
      const matcher = new RegExp(bounded, flags);

      const includePatterns = asPatterns(include);
      const excludePatterns = asPatterns(exclude);

      const rootStat = await fsp.stat(root);
      const candidates: AsyncIterable<string> = rootStat.isFile()
        ? (async function* () {
            yield root;
          })()
        : walkFiles(root, 0, {
            pattern: includePatterns,
            maxFiles: 20_000,
          });

      const matches: {
        path: string;
        line: number;
        text: string;
        before?: string[];
        after?: string[];
      }[] = [];
      const files: { path: string; matches: number }[] = [];
      let filesSearched = 0;
      let filesMatched = 0;
      let matchCount = 0;
      let skippedBinary = 0;
      let truncated = false;

      for await (const full of candidates) {
        const rel = toRel(full);
        if (!rootStat.isFile() && !matchesFilter(rel, includePatterns)) continue;
        if (excludePatterns && matchesFilter(rel, excludePatterns)) continue;

        filesSearched++;
        const file = await readTextFile(full, maxFileBytes);
        if (file.binary) {
          skippedBinary++;
          continue;
        }

        const lines = file.text.split(/\r?\n/);
        let fileMatches = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          matcher.lastIndex = 0;
          if (!matcher.test(line)) continue;

          fileMatches++;
          matchCount++;

          if (outputMode === "content") {
            const entry: (typeof matches)[number] = {
              path: rel,
              line: i + 1,
              text: line.trim().slice(0, MAX_LINE_CHARS),
            };
            if (contextLines > 0) {
              entry.before = lines
                .slice(Math.max(0, i - contextLines), i)
                .map((l) => l.slice(0, MAX_LINE_CHARS));
              entry.after = lines
                .slice(i + 1, i + 1 + contextLines)
                .map((l) => l.slice(0, MAX_LINE_CHARS));
            }
            matches.push(entry);
          } else if (outputMode === "count") {
            // Per-file counts are finalised below; keep scanning the file.
          }

          if (matchCount >= limit && outputMode !== "count") {
            truncated = true;
            break;
          }
        }

        if (fileMatches > 0) {
          filesMatched++;
          files.push({ path: rel, matches: fileMatches });
        }

        if (matchCount >= limit && outputMode !== "count") break;
        // In count mode the limit is a file cap, not a match cap.
        if (outputMode === "count" && filesMatched >= limit) {
          truncated = true;
          break;
        }
      }

      const base = {
        pattern,
        root: toRel(root),
        regex,
        outputMode,
        filesSearched,
        filesMatched,
        matchCount,
        skippedBinary,
        truncated,
      };

      if (outputMode === "files") {
        return { ...base, files: files.slice(0, limit).map((f) => f.path) };
      }
      if (outputMode === "count") {
        return { ...base, files: files.slice(0, limit) };
      }
      return { ...base, matches: matches.slice(0, limit) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
