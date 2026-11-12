// tools/shared/glob.ts
// Dependency-free glob matching used by search / listFiles / refactor.
// Supports the subset coding agents actually use:
//   *        any run of characters except "/"
//   ?        one character except "/"
//   **       any number of path segments (including none)
//   {a,b}    alternation
//   [abc]    character class
// Patterns are matched against workspace-relative POSIX paths.

import path from "node:path";

function escapeRegex(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  const close = pattern.indexOf("}", open + 1);
  if (close === -1) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  const options = pattern.slice(open + 1, close).split(",");
  return options.flatMap((opt) => expandBraces(before + opt + after));
}

function globToRegexSource(pattern: string): string {
  let p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  // "**/" matches zero or more directories.
  p = p.replace(/\*\*\//g, "\u0000SLASHSTAR\u0000");
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === "\u0000") {
      const marker = "\u0000SLASHSTAR\u0000";
      if (p.startsWith(marker, i)) {
        out += "(?:[^/]+/)*";
        i += marker.length - 1;
        continue;
      }
    }
    if (ch === "*") {
      if (p[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const close = p.indexOf("]", i + 1);
      if (close === -1) out += "\\[";
      else {
        out += p.slice(i, close + 1);
        i = close;
      }
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

const cache = new Map<string, RegExp>();

/** Compile a glob into a RegExp matched against a POSIX relative path. */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  const alternatives = expandBraces(pattern).map(globToRegexSource);
  const source = `^(?:${alternatives.join("|")})$`;
  const re = new RegExp(source, process.platform === "win32" ? "i" : "");
  cache.set(pattern, re);
  return re;
}

/** True when `relPath` (POSIX or native) matches any of the glob patterns. */
export function matchesGlob(relPath: string, patterns: string | string[]): boolean {
  const normalized = relPath.split(path.sep).join("/").replace(/^\.\//, "");
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((p) => globToRegExp(p).test(normalized));
}

/** True when the pattern looks like a glob rather than a literal file name. */
export function isGlobPattern(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}
