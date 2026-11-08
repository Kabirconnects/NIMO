import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, isSecret, assertWritable, ALLOW_WRITE, walkFiles } from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const refactorTool: Tool = tool({
  description:
    "Bulk rename/replace across the workspace: find all matches of a pattern and replace them in every file. " +
    "Dry-run first by default — set apply=true to write. Uses the same sandbox/proven guards as editFile.",

  inputSchema: z.object({
    pattern: z.string().min(1).describe("Plain text or regex to find"),
    regex: z.boolean().default(false).describe("If true, pattern is regex"),
    replacement: z.string().describe("Replacement text (regex capture refs like $1 allowed when regex=true)"),
    include: z.string().optional().describe("File extension filter, e.g. '.ts'"),
    apply: z.boolean().default(false).describe("If false (default), dry-run only and report matches. If true, write the changes."),
    maxFiles: z.number().int().min(1).max(100).default(30),
  }),

  execute: async ({ pattern, regex, replacement, include, apply, maxFiles }) => {
    try {
      const root = await resolveSafe(".");
      const re = regex ? new RegExp(pattern, "g") : null;
      const needle = pattern.toLowerCase();

      const perFile: { path: string; matches: number }[] = [];
      let totalMatches = 0;

      for await (const full of walkFiles(root)) {
        if (isSecret(full)) continue;
        if (include && !full.toLowerCase().endsWith(include.toLowerCase())) continue;

        let text: string;
        try { text = await fsp.readFile(full, "utf-8"); } catch { continue; }

        const matches = re
          ? (text.match(re) ?? []).length
          : text.toLowerCase().split(needle).length - 1;

        if (matches === 0) continue;
        perFile.push({ path: toRel(full), matches });
        totalMatches += matches;

        if (apply) {
          assertWritable(full);
          if (ALLOW_WRITE) {
            const updated = re ? text.replace(re, replacement) : text.split(pattern).join(replacement);
            await fsp.writeFile(full, updated, "utf-8");
          }
        }
        if (perFile.length >= maxFiles) break;
      }

      return {
        success: true as const,
        applied: apply,
        pattern,
        totalMatches,
        filesChanged: apply ? perFile.length : 0,
        perFile,
      };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
