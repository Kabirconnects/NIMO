import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, assertWritable, atomicWrite } from "../shared/workspace.js";
import { assertCanWrite } from "../shared/permissions.js";

import fsp from "node:fs/promises";

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function previewLine(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text
    .slice(start, end === -1 ? undefined : end)
    .replace(/\r$/, "")
    .trim()
    .slice(0, 240);
}

export const editFileTool: Tool = tool({
  description:
    "Edit an existing file by replacing an exact string - the primary way to change code. " +
    "By default oldString must occur exactly once (this prevents editing the wrong place); " +
    "set replaceAll=true for a deliberate global replacement. " +
    "Read the file first so oldString matches exactly, including indentation. " +
    "Line endings are adapted automatically, writes are atomic, and dryRun lets you preview. " +
    "Requires write permission (Auto mode or AGENT_ALLOW_WRITE=true).",

  inputSchema: z.object({
    path: z.string().min(1).describe("Relative path of the file to edit"),
    oldString: z.string().min(1).max(200_000).describe("Exact existing text to replace"),
    newString: z.string().max(200_000).describe("Replacement text (empty string deletes)"),
    replaceAll: z.boolean().default(false)
      .describe("Replace every occurrence instead of requiring a unique match"),
    dryRun: z.boolean().default(false)
      .describe("Validate and preview without writing"),
  }),

  execute: async ({ path: inputPath, oldString, newString, replaceAll, dryRun }) => {
    try {
      const full = await resolveSafe(inputPath);
      assertWritable(full);
      assertCanWrite("edit");

      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be edited");
      if (!stat.isFile()) throw new Error("Path is not a regular file");
      if (stat.size > 2_000_000) throw new Error("File is too large to edit (maximum 2 MB)");

      const content = await fsp.readFile(full, "utf-8");

      // Tolerate a model that used \n while the file uses \r\n (or vice versa).
      let target = oldString;
      let replacement = newString;
      if (!content.includes(target)) {
        const usesCrlf = content.includes("\r\n");
        const adapted = usesCrlf
          ? oldString.replace(/\r?\n/g, "\r\n")
          : oldString.replace(/\r\n/g, "\n");
        if (content.includes(adapted)) {
          target = adapted;
          replacement = usesCrlf ? newString.replace(/\r?\n/g, "\r\n") : newString.replace(/\r\n/g, "\n");
        }
      }

      const occurrences = content.split(target).length - 1;
      if (occurrences === 0) {
        throw new Error(
          "Target text was not found. Read the file and copy the exact text, including whitespace.",
        );
      }
      if (occurrences > 1 && !replaceAll) {
        throw new Error(
          `Target text occurs ${occurrences} times. Add surrounding context to make it unique, or set replaceAll=true.`,
        );
      }

      const firstIndex = content.indexOf(target);
      const replaceIndex = firstIndex;
      const updated = replaceAll
        ? content.split(target).join(replacement)
        : content.slice(0, firstIndex) + replacement + content.slice(firstIndex + target.length);

      const preview = {
        line: lineOf(content, replaceIndex),
        before: previewLine(content, replaceIndex),
        after: replacement.split(/\r?\n/)[0]?.trim().slice(0, 240) ?? "",
      };

      if (dryRun) {
        return {
          success: true as const,
          operation: "dry-run",
          path: toRel(full),
          replacements: replaceAll ? occurrences : 1,
          preview,
          previewOnly: true,
        };
      }

      await atomicWrite(full, updated);

      return {
        success: true as const,
        operation: "edited",
        path: toRel(full),
        replacements: replaceAll ? occurrences : 1,
        bytes: Buffer.byteLength(updated, "utf-8"),
        preview,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
