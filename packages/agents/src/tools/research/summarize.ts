import { tool, type Tool } from "ai";
import { z } from "zod";

import { clip } from "../shared/workspace.js";

export const summarizeTool: Tool = tool({
  description:
    "Extractive summarizer: returns the most salient sentences by term-frequency, no LLM needed. " +
    "Use for research: compress a paper/doc to the sentences that mention the entities and numbers you care about.",

  inputSchema: z.object({
    text: z.string().max(50_000),
    sentences: z.number().int().min(1).max(20).default(5),
    focusTerms: z.array(z.string()).max(10).optional().describe("Terms to weight higher"),
  }),

  execute: async ({ text, sentences, focusTerms }) => {
    try {
      const STOP = new Set(["the","a","an","and","or","but","if","then","else","of","in","on","at","to","for","with","by","from","is","are","was","were","be","been","i","we","you","it","this","that","what","when","where","who","how","why","will","would","can","could","should","must","have","has","had","do","does","did"]);
      const sents = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
      const freq = new Map<string, number>();
      for (const w of text.toLowerCase().match(/[a-z0-9_-]+/g) ?? []) {
        if (w.length < 3 || STOP.has(w)) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
      const focus = new Set((focusTerms ?? []).map((t) => t.toLowerCase()));
      const scored = sents.map((s) => {
        const words = s.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
        let sc = 0;
        for (const w of words) {
          sc += freq.get(w) ?? 0;
          if (focus.has(w)) sc += 10;
        }
        return { s, sc: sc / Math.max(1, words.length) };
      }).sort((a, b) => b.sc - a.sc);
      const top = scored.slice(0, sentences).map((x) => x.s);
      return { success: true as const, summary: top.join(" ") };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
