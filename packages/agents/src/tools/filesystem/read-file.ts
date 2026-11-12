import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, isSecret, readTextFile, numberLines } from "../shared/workspace.js";

export const readFileTool: Tool = tool({
  description:
    "Read a file inside the agent workspace with line numbers. " +
    "Supports offset/limit for large files, detects binary content, and reports truncation. " +
    "Always read before editing so oldString matches exactly. Secret files are blocked.",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative file path inside the workspace"),
    offset: z.number().int().min(1).optional()
      .describe("First line to return (1-based). Omit to start at line 1."),
    limit: z.number().int().min(1).max(5_000).optional()
      .describe("Maximum number of lines to return (default 2000)."),
    withLineNumbers: z.boolean().default(true)
      .describe("Prefix each line with its line number (default true)."),
    maxBytes: z.number().int().min(1).max(2_000_000).default(500_000)
      .describe("Byte cap for the read (default 500 KB)."),
  }),

  execute: async ({ path: inputPath, offset, limit, withLineNumbers, maxBytes }) => {
    try {
      const full = await resolveSafe(inputPath);
      if (isSecret(full)) throw new Error("Secret files are blocked");

      const stat = await import("node:fs/promises").then((m) => m.stat(full));
      if (!stat.isFile()) throw new Error("Path is not a file");

      const file = await readTextFile(full, maxBytes);
      if (file.binary) {
        return {
          path: toRel(full),
          size: file.size,
          binary: true,
          message: "Binary file — not shown. Use runCommand with a dedicated inspector if needed.",
        };
      }

      const allLines = file.text.split(/\r?\n/);
      const totalLines = allLines.length === 1 && allLines[0] === "" ? 0 : allLines.length;
      const start = Math.min(offset ?? 1, Math.max(1, totalLines + 1));
      const maxLines = limit ?? 2_000;
      const slice = allLines.slice(start - 1, start - 1 + maxLines);
      const numbered = withLineNumbers
        ? numberLines(slice, start)
        : slice.join("\n");
      const end = start + slice.length - 1;
      const nextOffset = end < totalLines ? end + 1 : null;

      return {
        path: toRel(full),
        size: file.size,
        totalLines,
        startLine: start,
        endLine: slice.length > 0 ? end : null,
        nextOffset,
        truncated: file.truncated || nextOffset !== null,
        truncatedReason: file.truncated
          ? `Byte cap reached (${maxBytes} bytes); use offset/limit to read further.`
          : nextOffset !== null
            ? `Line limit reached (${maxLines} lines); continue at offset ${nextOffset}.`
            : undefined,
        content: numbered,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
