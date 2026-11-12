import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, readTextFile } from "../shared/workspace.js";

import path from "node:path";

type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "struct"
  | "trait"
  | "impl";

interface SymbolInfo {
  kind: SymbolKind;
  name: string;
  line: number;
  endLine?: number;
  exported?: boolean;
  methodOf?: string;
}

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
};

interface StripState {
  blockComment: boolean;
}

/** Remove strings and comments so brace counting is not fooled by them. */
function stripCode(line: string, state: StripState): string {
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const next = line[i + 1];

    if (state.blockComment) {
      if (ch === "*" && next === "/") {
        state.blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "*") {
      state.blockComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function braceDelta(cleaned: string): number {
  let delta = 0;
  for (const ch of cleaned) {
    if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

const TS_SYMBOL_PATTERNS: {
  re: RegExp;
  kind: SymbolKind;
  group?: number;
}[] = [
  { re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/, kind: "function" },
  { re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/, kind: "interface" },
  { re: /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*[=<]/, kind: "type" },
  { re: /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/, kind: "enum" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?\s*=>/, kind: "function" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?function\b/, kind: "function" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:tool|defineTool|\w+Tool)\s*\(/, kind: "variable" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*/, kind: "variable" },
];

const METHOD_PATTERN =
  /^(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/;

const GENERIC_PATTERNS: { re: RegExp; kind: SymbolKind }[] = [
  { re: /^(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:func|fn|def|function)\s+([A-Za-z0-9_$]+)/, kind: "function" },
  { re: /^(?:export\s+)?(?:pub\s+)?(?:abstract\s+)?(?:class|struct)\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^(?:pub\s+)?(?:trait|interface)\s+([A-Za-z0-9_$]+)/, kind: "interface" },
  { re: /^(?:pub\s+)?impl(?:<[^>]*>)?\s+([A-Za-z0-9_$<>:]+)/, kind: "impl" },
  { re: /^(?:export\s+)?(?:type|enum)\s+([A-Za-z0-9_$]+)/, kind: "type" },
];

function outlineTypeScript(lines: string[], maxSymbols: number): {
  symbols: SymbolInfo[];
  imports: { source: string; line: number }[];
  truncated: boolean;
} {
  const symbols: SymbolInfo[] = [];
  const imports: { source: string; line: number }[] = [];
  const state: StripState = { blockComment: false };
  const open: { sym: SymbolInfo; targetDepth: number }[] = [];

  let depth = 0;
  let classStack: SymbolInfo | null = null;
  let truncated = false;

  const pushSymbol = (sym: SymbolInfo) => {
    if (symbols.length >= maxSymbols) {
      truncated = true;
      return false;
    }
    symbols.push(sym);
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const cleaned = stripCode(raw, state);
    const code = cleaned.trim();
    const lineNo = i + 1;

    if (/^(?:import|export)\b/.test(trimmed)) {
      const from = trimmed.match(/\bfrom\s+['"]([^'"]+)['"]/);
      const side = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
      if (from) imports.push({ source: from[1]!, line: lineNo });
      else if (side) imports.push({ source: side[1]!, line: lineNo });
    }

    const before = depth;
    const isTopLevel = before === 0;
    let declared: SymbolInfo | null = null;

    if (isTopLevel) {
      for (const { re, kind } of TS_SYMBOL_PATTERNS) {
        const match = code.match(re);
        if (!match) continue;
        const name = match[1];
        if (!name) continue;
        // `const x = ...` is only interesting when it holds a function/tool,
        // otherwise it is noise in a large module.
        if (kind === "variable" && !/(?:=>|function|tool|defineTool|\w+Tool)\b/.test(code)) {
          continue;
        }
        declared = {
          kind,
          name,
          line: lineNo,
          exported: /^export\b/.test(trimmed),
        };
        break;
      }
    } else if (before === 1 && classStack) {
      const match = code.match(METHOD_PATTERN);
      if (match && !/^(?:if|for|while|switch|catch|return|function)\b/.test(code)) {
        declared = {
          kind: "method",
          name: match[1]!,
          line: lineNo,
          methodOf: classStack.name,
          exported: classStack.exported,
        };
      }
    }

    const delta = braceDelta(code);
    depth = Math.max(0, depth + delta);

    if (declared) {
      if (pushSymbol(declared) && delta > 0) {
        open.push({ sym: declared, targetDepth: before });
        if (declared.kind === "class") classStack = declared;
      } else if (declared && delta <= 0) {
        declared.endLine = lineNo;
      }
    }

    while (open.length > 0 && depth <= open[open.length - 1]!.targetDepth) {
      const item = open.pop()!;
      if (item.sym.line !== lineNo) item.sym.endLine = lineNo;
      if (item.sym === classStack) classStack = null;
    }
  }

  return { symbols, imports, truncated };
}

function outlinePython(lines: string[], maxSymbols: number): {
  symbols: SymbolInfo[];
  imports: { source: string; line: number }[];
  truncated: boolean;
} {
  const symbols: SymbolInfo[] = [];
  const imports: { source: string; line: number }[] = [];
  let truncated = false;

  const stack: { sym: SymbolInfo; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();

    const imp = text.match(/^(?:from\s+(\S+)\s+import|import\s+(.+))/);
    if (imp) imports.push({ source: (imp[1] ?? imp[2] ?? "").split(/\s+/)[0]!, line: i + 1 });

    const decl = text.match(/^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/);
    if (decl) {
      while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) {
        const item = stack.pop()!;
        item.sym.endLine = i; // previous line
      }
      const sym: SymbolInfo = {
        kind: text.startsWith("class") ? "class" : stack.length > 0 && stack[stack.length - 1]!.sym.kind === "class" ? "method" : "function",
        name: decl[1]!,
        line: i + 1,
        methodOf: stack[stack.length - 1]?.sym.name,
      };
      if (symbols.length >= maxSymbols) {
        truncated = true;
      } else {
        symbols.push(sym);
        stack.push({ sym, indent });
      }
    }
  }

  for (const item of stack) item.sym.endLine = lines.length;
  return { symbols, imports, truncated };
}

function outlineGeneric(lines: string[], maxSymbols: number): {
  symbols: SymbolInfo[];
  imports: { source: string; line: number }[];
  truncated: boolean;
} {
  const symbols: SymbolInfo[] = [];
  const imports: { source: string; line: number }[] = [];
  let truncated = false;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    if (!text || text.startsWith("//") || text.startsWith("#") || text.startsWith("*")) continue;

    const imp =
      text.match(/^(?:import|use|require|package)\s+['"]?([^'";\s]+)/) ??
      text.match(/^from\s+(\S+)\s+import/);
    if (imp) imports.push({ source: imp[1]!, line: i + 1 });

    for (const { re, kind } of GENERIC_PATTERNS) {
      const match = text.match(re);
      if (!match) continue;
      if (symbols.length >= maxSymbols) {
        truncated = true;
        break;
      }
      symbols.push({ kind, name: match[1]!, line: i + 1 });
      break;
    }
  }

  return { symbols, imports, truncated };
}

export const explainFileTool: Tool = tool({
  description:
    "Return a structural outline of a source file instead of dumping it: imports, exported symbols, " +
    "functions/classes/methods with line numbers (and end lines where brace matching allows). " +
    "Use this to orient in an unfamiliar file before reading or editing it. " +
    "Supports TypeScript/JavaScript in detail, Python, and a generic outline for Go/Rust/Java/etc. " +
    "Reports binary files and unsupported languages explicitly.",

  inputSchema: z.object({
    path: z.string().min(1).describe("File to outline, relative to the workspace"),
    maxSymbols: z.number().int().min(1).max(1_000).default(300)
      .describe("Maximum symbols to return"),
    maxBytes: z.number().int().min(1_000).max(5_000_000).default(2_000_000)
      .describe("Maximum bytes to read"),
  }),

  execute: async ({ path: inputPath, maxSymbols, maxBytes }) => {
    try {
      const full = await resolveSafe(inputPath);
      const file = await readTextFile(full, maxBytes);

      if (file.binary) {
        return {
          path: toRel(full),
          size: file.size,
          binary: true,
          message: "Binary file — no outline available.",
        };
      }

      const ext = path.extname(full).toLowerCase();
      const language = LANGUAGES[ext] ?? "unknown";
      const lines = file.text.split(/\r?\n/);

      const parsed =
        language === "typescript" || language === "javascript"
          ? outlineTypeScript(lines, maxSymbols)
          : language === "python"
            ? outlinePython(lines, maxSymbols)
            : outlineGeneric(lines, maxSymbols);

      const exports = parsed.symbols
        .filter((s) => s.exported && s.kind !== "method")
        .map((s) => s.name);
      const counts: Record<string, number> = {};
      for (const sym of parsed.symbols) counts[sym.kind] = (counts[sym.kind] ?? 0) + 1;

      return {
        path: toRel(full),
        language,
        size: file.size,
        lines: lines.length,
        imports: parsed.imports.slice(0, 100),
        importCount: parsed.imports.length,
        exports,
        counts,
        symbols: parsed.symbols,
        truncated: parsed.truncated || file.truncated,
        hint:
          language === "unknown"
            ? "Language not recognised; a generic declaration scan was used."
            : undefined,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
