import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchesGlob, isGlobPattern } from "./glob.js";

// Portable default: ~/.nimo. AGENT_WORKSPACE (or NIMO_WORKSPACE, the name the
// server .env uses) wins, so server/CLI runs can point the sandbox anywhere
// without editing code.
const DEFAULT_WORKSPACE = path.join(os.homedir(), ".nimo");

const configuredRoot = path.resolve(
  process.env.AGENT_WORKSPACE ?? process.env.NIMO_WORKSPACE ?? DEFAULT_WORKSPACE,
);

export const ROOT = fs.existsSync(configuredRoot)
  ? fs.realpathSync(configuredRoot)
  : configuredRoot;

export const ALLOW_WRITE = process.env.AGENT_ALLOW_WRITE === "true";
export const ALLOW_SHELL = process.env.AGENT_ALLOW_SHELL === "true";

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
  ".nimo-procs",
]);

/** Files that commonly contain credentials; never readable/writable by tools. */
const SECRET =
  /(^|[\\/])(\.env(\..*)?|\.npmrc|\.yarnrc|\.netrc|\.pypirc|credentials|id_(rsa|ed25519|ecdsa|dsa)|.*\.(pem|key|p12|pfx|keystore)|service-account.*\.json)$/i;
export const isSecret = (full: string) => SECRET.test(full);

function inside(p: string, root = ROOT) {
  const r = path.relative(root, p);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

// Windows may hand back an 8.3 short path (C:\Users\HIMANS~1\...) from the
// environment while realpath resolves the long form. Canonicalise once so the
// two forms can be compared safely.
let canonicalRoot: string | null = null;
async function getCanonicalRoot(): Promise<string> {
  if (!canonicalRoot) {
    canonicalRoot = await fsp.realpath(ROOT).catch(() => ROOT);
  }
  return canonicalRoot;
}

/** Resolve a workspace-relative path, rejecting traversal and symlink escapes. */
export async function resolveSafe(input: string): Promise<string> {
  if (input.includes("\u0000")) throw new Error("Path contains a NUL byte");
  const full = path.resolve(ROOT, input);
  if (!inside(full)) throw new Error("Path is outside the workspace");

  const realRoot = await getCanonicalRoot();

  // Follow symlinks on the closest existing ancestor.
  let probe = full;
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      if (!inside(real, realRoot)) throw new Error("Path is outside the workspace");
      break;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return full;
}

export const toRel = (full: string) =>
  path.relative(ROOT, full).split(path.sep).join("/") || ".";

export function assertWritable(full: string) {
  if (isSecret(full)) throw new Error("Secret files are blocked");
  const r = toRel(full);
  if (r === ".git" || r.startsWith(".git/")) throw new Error(".git is protected");
  if (
    r === "memories" ||
    r.startsWith("memories/") ||
    r === "sessions.db" ||
    r === "pame.db" ||
    r === "pame.db-wal" ||
    r === "pame.db-shm"
  ) {
    throw new Error("Managed by the memory system. Use the memory tool.");
  }
}

export function fail(e: unknown) {
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Detect binary content the way git does: a NUL byte in the sample. */
export function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_000);
  return sample.includes(0);
}

export interface TextFile {
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

/** Read a file as UTF-8 with a hard byte cap and binary detection. */
export async function readTextFile(full: string, maxBytes = 200_000): Promise<TextFile> {
  const handle = await fsp.open(full, "r");
  try {
    const stat = await handle.stat();
    const size = stat.size;
    const take = Math.min(size, Math.max(1, maxBytes));
    const buffer = Buffer.alloc(take);
    await handle.read(buffer, 0, take, 0);
    if (isBinary(buffer)) {
      return { text: "", size, truncated: size > take, binary: true };
    }
    return {
      text: buffer.toString("utf8"),
      size,
      truncated: size > take,
      binary: false,
    };
  } finally {
    await handle.close();
  }
}

/** Atomic write: temp file in the same directory, then rename over target. */
export async function atomicWrite(full: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const temp = path.join(
    path.dirname(full),
    `.pame-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fsp.writeFile(temp, content, "utf-8");
  try {
    await fsp.rename(temp, full);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") {
      await fsp.unlink(temp).catch(() => {});
      throw e;
    }
    // Windows can refuse to replace an open file; fall back to remove+rename.
    await fsp.unlink(full).catch(() => {});
    await fsp.rename(temp, full);
  }
}

export interface WalkOptions {
  maxDepth?: number;
  /** Only yield files matching this glob (or these globs). */
  pattern?: string | string[];
  /** Stop after this many files. */
  maxFiles?: number;
  /** Include the starting directory itself. */
  includeRoot?: boolean;
}

export async function* walkFiles(
  dir: string,
  depth = 0,
  opts: WalkOptions = {},
): AsyncGenerator<string> {
  const maxDepth = opts.maxDepth ?? 12;
  const maxFiles = opts.maxFiles ?? 20_000;
  const patterns = opts.pattern
    ? Array.isArray(opts.pattern)
      ? opts.pattern
      : [opts.pattern]
    : null;
  let yielded = 0;

  const matches = (full: string) => {
    if (!patterns) return true;
    const rel = toRel(full);
    return patterns.some((p) => (isGlobPattern(p) ? matchesGlob(rel, p) : rel.endsWith(p)));
  };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, vanished mid-walk): skip it rather
    // than failing the whole search.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (isSecret(full)) continue;

    if (entry.isDirectory()) {
      if (depth < maxDepth) yield* walkFiles(full, depth + 1, opts);
      continue;
    }
    if (!entry.isFile()) continue;
    if (matches(full)) {
      yield full;
      yielded++;
      if (yielded >= maxFiles) return;
    }
  }
}

// Child processes must not inherit your API keys.
export function safeEnv(): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "ComSpec",
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "PNPM_HOME",
    "NODE_ENV",
    "CI",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
  ];
  return Object.fromEntries(
    keep
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
}

export const clip = (s: string, max = 12_000) =>
  s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
export const tail = (s: string, max = 8_000) =>
  s.length > max ? "…(truncated)\n" + s.slice(-max) : s;

/** Format lines with 1-based numbers, like `cat -n` / Claude's read tool. */
export function numberLines(lines: string[], start = 1, width = 0): string {
  const pad = Math.max(width, String(start + lines.length - 1).length);
  return lines
    .map((line, i) => `${String(start + i).padStart(pad, " ")}\t${line}`)
    .join("\n");
}
