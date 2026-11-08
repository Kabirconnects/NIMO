import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  resolveSafe,
  toRel,
  isSecret,
  walkFiles,
} from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const searchTool: Tool = tool({
  description:
    "Search the workspace for a text pattern in file contents (grep). " +
    "Plain substring by default; regex when regex=true; case-sensitive optional. " +
    "Find where a function, variable, or test lives before editing. Skips node_modules/.git and secrets.",

  inputSchema: z.object({
    pattern: z.string().min(1).describe("Text or regex to search for"),
    path: z.string().default(".").describe("Directory to search inside, relative to workspace"),
    regex: z.boolean().default(false).describe("If true, pattern is regex; otherwise plain substring"),
    caseSensitive: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50).describe("Max matches to return"),
    include: z.string().optional().describe("File extension filter, e.g. '.ts'"),
  }),

  execute: async ({ pattern, path: inputPath, regex, caseSensitive, limit, include }) => {
    try {
      const root = await resolveSafe(inputPath);
      const re = regex ? new RegExp(pattern, caseSensitive ? "" : "i") : null;
      const needle = pattern.toLowerCase();

      const matches: { path: string; line: number; text: string }[] = [];

      for await (const full of walkFiles(root)) {
        if (isSecret(full)) continue;
        if (include && !full.toLowerCase().endsWith(include.toLowerCase())) continue;

        let text: string;
        try { text = await fsp.readFile(full, "utf-8"); } catch { continue; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const hit = caseSensitive
            ? (regex && re ? re.test(line) : line.includes(pattern))
            : (regex && re ? re.test(line) : line.toLowerCase().includes(needle));
          if (!hit) continue;
          matches.push({ path: toRel(full), line: i + 1, text: line.trim().slice(0, 200) });
          if (matches.length >= limit) break;
        }
        if (matches.length >= limit) break;
      }

      return { pattern, count: matches.length, matches };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
