import { tool, type Tool } from "ai";
import { z } from "zod";

import { clip } from "../shared/workspace.js";

export const extractDataTool: Tool = tool({
  description:
    "Extract structured data from text: numbers, tables, citations, dates. " +
    "Use for research: pull facts from papers/docs without the LLM inventing them.",

  inputSchema: z.object({
    text: z.string().max(50_000).describe("Text to extract from"),
    kind: z.enum(["numbers", "tables", "citations", "dates", "all"]).default("all"),
    limit: z.number().int().min(1).max(100).default(30),
  }),

  execute: async ({ text, kind, limit }) => {
    try {
      const out: Record<string, unknown> = {};
      if (kind === "numbers" || kind === "all") out.numbers = (text.match(/-?\d+[\d.,]*%?\b/g) ?? []).slice(0, limit);
      if (kind === "citations" || kind === "all") out.citations = (text.match(/\[[^\]]{1,80}\]/g) ?? []).slice(0, limit);
      if (kind === "dates" || kind === "all") out.dates = (text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/g) ?? []).slice(0, limit);
      if (kind === "tables" || kind === "all") {
        const tableLines = text.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
        out.tables = tableLines.slice(0, limit);
      }
      return { success: true as const, kind, ...out };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
