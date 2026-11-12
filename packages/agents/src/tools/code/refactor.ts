import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  assertWritable,
  readTextFile,
  atomicWrite,
  walkFiles,
} from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";
import { isGlobPattern, matchesGlob } from "../shared/glob.js";

const asPatterns = (value?: string | string[]): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

function filterMatches(rel: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) =>
    isGlobPattern(p) ? matchesGlob(rel, p) : rel.toLowerCase().endsWith(p.toLowerCase()),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function lineAt(text: string, line: number): string {
  return (text.split(/\r?\n/)[line - 1] ?? "").trim().slice(0, 240);
}

export const refactorTool: Tool = tool({
  description:
    "Bulk find-and-replace across workspace files - rename a symbol, update an import path, " +
    "or migrate an API. Dry-run by default: it reports every file, replacement count, and a preview " +
    "line, and only writes when apply=true. " +
    "Uses glob include/exclude filters, skips binary/secret/generated folders, and writes atomically. " +
    "Prefer editFile for a single targeted change; use this for genuine cross-file refactors. " +
    "Requires write permission when apply=true.",

  inputSchema: z.object({
    pattern: z.string().min(1).max(2_000).describe("Text or regular expression to find"),
    replacement: z.string().max(200_000).describe("Replacement text (regex $1 groups allowed)"),
    regex: z.boolean().default(false).describe("Interpret pattern as a regular expression"),
    caseSensitive: z.boolean().default(true)
      .describe("Match case exactly (default true, safest for code identifiers)"),
    include: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Glob(s) or suffix(es) to include, e.g. '**/*.ts' or ['.ts', '.tsx']"),
    exclude: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Glob(s) or suffix(es) to skip, e.g. '**/*.test.ts'"),
    path: z.string().default(".").describe("Directory to refactor, relative to the workspace"),
    apply: z.boolean().default(false).describe("Write changes (default false = dry run)"),
    maxFiles: z.number().int().min(1).max(500).default(100)
      .describe("Maximum files to change"),
    maxFileBytes: z.number().int().min(1_000).max(5_000_000).default(1_000_000)
      .describe("Skip files larger than this"),
  }),

  execute: async ({
    pattern,
    replacement,
    regex,
    caseSensitive,
    include,
    exclude,
    path: inputPath,
    apply,
    maxFiles,
    maxFileBytes,
  }) => {
    try {
      if (apply) assertCanWrite("refactor");

      const root = await resolveSafe(inputPath);
      const includePatterns = asPatterns(include);
      const excludePatterns = asPatterns(exclude);
      const flags = `g${caseSensitive ? "" : "i"}`;
      const matcher = new RegExp(regex ? pattern : escapeRegExp(pattern), flags);

      const perFile: {
        path: string;
        replacements: number;
        preview: { line: number; before: string; after: string };
      }[] = [];

      let totalReplacements = 0;
      let filesScanned = 0;
      let truncated = false;
      let skippedBinary = 0;

      for await (const full of walkFiles(root, 0, {
        pattern: includePatterns,
        maxFiles: 20_000,
      })) {
        const rel = toRel(full);
        if (!filterMatches(rel, includePatterns)) continue;
        if (excludePatterns && filterMatches(rel, excludePatterns)) continue;

        filesScanned++;
        const file = await readTextFile(full, maxFileBytes);
        if (file.binary) {
          skippedBinary++;
          continue;
        }

        matcher.lastIndex = 0;
        const first = matcher.exec(file.text);
        if (!first) continue;

        matcher.lastIndex = 0;
        let count = 0;
        let hit: RegExpExecArray | null;
        while ((hit = matcher.exec(file.text)) !== null) {
          count++;
          if (hit[0].length === 0) matcher.lastIndex++;
          if (count >= 100_000) break;
        }
        if (count === 0) continue;

        const line = lineNumberAt(file.text, first.index);
        const before = lineAt(file.text, line);
        const after = before.replace(
          new RegExp(regex ? pattern : escapeRegExp(pattern), caseSensitive ? "" : "i"),
          regex ? replacement : replacement.replace(/\$/g, "$$$$"),
        );

        perFile.push({ path: rel, replacements: count, preview: { line, before, after } });
        totalReplacements += count;

        if (apply) {
          assertWritable(full);
          matcher.lastIndex = 0;
          const updated = file.text.replace(
            matcher,
            regex ? replacement : replacement.replace(/\$/g, "$$$$"),
          );
          await atomicWrite(full, updated);
        }

        if (perFile.length >= maxFiles) {
          truncated = true;
          break;
        }
      }

      return {
        success: true as const,
        applied: apply,
        pattern,
        root: toRel(root),
        filesScanned,
        filesChanged: perFile.length,
        totalReplacements,
        skippedBinary,
        truncated,
        perFile,
        hint: apply
          ? "Run runTests and gitStatus to verify the refactor."
          : "Dry run only. Re-call with apply=true to write these changes.",
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
