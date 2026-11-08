import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, isSecret } from "../shared/workspace.js";

import fsp from "node:fs/promises";

export const explainFileTool: Tool = tool({
  description:
    "Read a file and return a structural skeleton: imports, exports, function names, and line ranges. " +
    "Use for orientation before editing — 'what's in this file?' without dumping the whole file.",

  inputSchema: z.object({
    path: z.string().min(1).describe("File to explain"),
  }),

  execute: async ({ path: inputPath }) => {
    try {
      const full = await resolveSafe(inputPath);
      if (isSecret(full)) throw new Error("Secret files are blocked");
      const text = await fsp.readFile(full, "utf-8");
      const lines = text.split(/\r?\n/);
      const exports: string[] = [];
      const imports: string[] = [];
      const fns: string[] = [];
      lines.forEach((line, i) => {
        const t = line.trim();
        if (/^(import |export |const |function |class )/.test(t)) {
          if (t.startsWith("import")) imports.push(t.slice(0, 120));
          else if (t.startsWith("export")) exports.push(t.slice(0, 120));
          else if (/(function |= )/.test(t) && /\(/.test(t)) fns.push(`${i + 1}: ${t.slice(0, 120)}`);
        }
      });
      return {
        path: toRel(full),
        lines: lines.length,
        imports: imports.slice(0, 20),
        exports: exports.slice(0, 20),
        functions: fns.slice(0, 50),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
