// tools/shared/process.ts
// One hardened process runner shared by runCommand / runTests / gitStatus /
// benchmark / tool-foundry.
//
// Properties that matter for an agent harness:
//   - allowlisted executables only (no arbitrary binaries);
//   - argv arrays, not string interpolation, so `; rm -rf` is never a command;
//   - Windows .cmd shims run through cmd.exe with every token validated
//     against shell metacharacters, so `&&`, `|`, `>` cannot be injected;
//   - scrubbed environment (API keys never reach child processes);
//   - hard timeout with process-tree kill;
//   - bounded output that keeps the tail (where build/test errors live).

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, safeEnv } from "./workspace.js";

/** Dev commands a coding agent legitimately needs. Extend with AGENT_SHELL_ALLOW. */
const DEFAULT_ALLOWED = new Set([
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "tsx",
  "tsc",
  "vitest",
  "jest",
  "eslint",
  "prettier",
  "next",
  "vite",
  "turbo",
  "esbuild",
  "webpack",
  "rollup",
  "python",
  "python3",
  "pip",
  "pip3",
  "pytest",
  "go",
  "cargo",
  "rustc",
  "make",
  "cmake",
  "dotnet",
  "java",
  "javac",
  "mvn",
  "gradle",
]);

/** Commands that are read-only shell basics; useful for quick inspection. */
const SAFE_READONLY = new Set([
  "pwd",
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "wc",
  "where",
  "which",
  "rg",
  "findstr",
]);

function allowlist(): Set<string> {
  const extra = (process.env.AGENT_SHELL_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED, ...SAFE_READONLY, ...extra]);
}

function commandName(bin: string): string {
  const base = path.basename(bin).toLowerCase();
  return base.replace(/\.(exe|com|cmd|bat)$/i, "");
}

export function isAllowedCommand(bin: string): boolean {
  return allowlist().has(commandName(bin));
}

/**
 * Tokenise a command line without invoking a shell. Quotes group words;
 * backslashes stay literal so Windows paths survive.
 */
export function tokenizeCommand(command: string): string[] {
  if (command.includes("\u0000")) throw new Error("Command contains a NUL byte");
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      started = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (quote) throw new Error("Unterminated quote in command");
  if (started) tokens.push(current);
  if (tokens.length === 0) throw new Error("Empty command");
  return tokens;
}

/**
 * Reject only what cmd.exe expands or mis-parses even inside double quotes.
 * Everything else (&, |, >, <, parentheses) is safe once every token is
 * quoted, which is what coding commands need for `node -e "..."`.
 */
const CMD_UNSAFE = /["%\r\n\u0000]/;
const SHELL_OPERATOR = new Set(["&&", "||", "|", "&", ";", ">", ">>", "<"]);
function assertCmdTokenSafe(token: string): void {
  if (CMD_UNSAFE.test(token) || SHELL_OPERATOR.has(token)) {
    throw new Error(
      `Unsafe shell character in argument '${token}'. Use the dedicated tools (search, readFile, writeFile) instead of shell pipelines.`,
    );
  }
}

function quoteForCmd(token: string): string {
  assertCmdTokenSafe(token);
  return `"${token}"`;
}

const executableCache = new Map<string, string | null>();

/** Project-local node_modules/.bin directories from cwd up to the workspace root. */
function localBinDirs(cwd: string): string[] {
  const dirs: string[] = [];
  const root = path.resolve(ROOT);
  let current = path.resolve(cwd);

  const rel = path.relative(root, current);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return [path.join(current, "node_modules", ".bin")];
  }

  for (;;) {
    dirs.push(path.join(current, "node_modules", ".bin"));
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function searchPath(): string {
  return process.env.PATH ?? process.env.Path ?? "";
}

/**
 * Resolve a bare command name against local node_modules/.bin, then PATH +
 * PATHEXT on Windows.
 * Passing the absolute path to cmd.exe keeps `.cmd` shims working: npm.cmd
 * derives its install directory from %~dp0, which breaks when it is invoked
 * as the quoted bare word `"npm"`.
 */
function locateExecutable(bin: string, extraDirs: string[] = []): string | null {
  const cacheKey = `${bin}\u0000${extraDirs.join(";")}`;
  const cached = executableCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  const names = path.extname(bin) ? [bin] : exts.map((ext) => `${bin}${ext.toLowerCase()}`);
  const dirs = [
    ...extraDirs,
    ...searchPath()
      .split(path.delimiter)
      .map((dir) => dir.replace(/^"|"$/g, ""))
      .filter(Boolean),
  ];

  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isFile()) {
          executableCache.set(cacheKey, full);
          return full;
        }
      } catch {
        /* not here */
      }
    }
  }

  executableCache.set(cacheKey, null);
  return null;
}

export interface RunProcessOptions {
  /** Command string OR argv array. Prefer argv when you control the pieces. */
  command?: string;
  argv?: string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Data written to stdin, then stdin is closed. */
  stdin?: string;
  /** Extra non-secret environment variables (CI=1, NODE_ENV=test, ...). */
  env?: Record<string, string>;
}

export interface RunProcessResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

function runnableArgv(options: RunProcessOptions): string[] {
  const argv = options.argv ?? (options.command !== undefined ? tokenizeCommand(options.command) : []);
  if (argv.length === 0) throw new Error("Empty command");
  const bin = argv[0]!;
  if (/[\\/]/.test(bin)) {
    throw new Error("Use a command name (e.g. 'pnpm'), not a filesystem path");
  }
  if (!isAllowedCommand(bin)) {
    throw new Error(
      `Command '${bin}' is not allowlisted. Allowed: ${[...allowlist()].sort().join(", ")}`,
    );
  }
  return argv;
}

function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env = safeEnv();
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (/(key|token|secret|password|credential|authorization|auth)/i.test(key)) continue;
    env[key] = value;
  }
  // Deterministic, non-interactive output for agent tooling.
  env.CI = env.CI ?? "1";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  return env;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const argv = runnableArgv(options);
  const cwd = options.cwd;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 600_000);
  const maxBytes = Math.min(Math.max(options.maxOutputBytes ?? 24_000, 1_000), 1_000_000);

  const [rawBin, ...args] = argv;
  const bin = rawBin!;
  const isWindows = process.platform === "win32";

  // Project binaries (tsc, eslint, vitest, ...) live in node_modules/.bin and
  // are not on the global PATH. npm scripts get this for free; agent commands
  // need it explicitly.
  const localDirs = localBinDirs(cwd);
  const env = childEnv(options.env);
  const augmentedPath = [...localDirs, searchPath()].filter(Boolean).join(path.delimiter);
  if (env.Path !== undefined) env.Path = augmentedPath;
  else env.PATH = augmentedPath;

  // On Windows resolve to a real file so .exe commands bypass cmd.exe and
  // .cmd shims keep their %~dp0 intact.
  let launchBin = bin;
  let useCmd = false;
  if (isWindows) {
    const found = locateExecutable(bin, localDirs);
    if (!found) {
      throw new Error(`Command '${bin}' was not found on PATH or node_modules/.bin`);
    }
    launchBin = found;
    useCmd = !/\.(exe|com)$/i.test(found);
  }

  const child = useCmd
    ? spawn(process.env.ComSpec ?? "cmd.exe", [
        "/d",
        "/s",
        "/c",
        // /s strips the first/last quote, so add an outer pair around the
        // already-quoted command. This is the standard cmd /c quoting form.
        `"${[launchBin, ...args].map(quoteForCmd).join(" ")}"`,
      ], {
        cwd,
        env,
        windowsHide: true,
        // Node's default argument quoting uses backslash escapes that cmd.exe
        // does not understand. Pass the already-quoted command verbatim.
        windowsVerbatimArguments: true,
      })
    : spawn(launchBin, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
      });

  const started = Date.now();
  let timedOut = false;
  let truncated = false;
  let stdoutBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderrBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer): Buffer<ArrayBufferLike> => {
    const next = Buffer.concat([current, chunk]);
    if (next.length > maxBytes) {
      truncated = true;
      return next.subarray(next.length - maxBytes);
    }
    return next;
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf = append(stdoutBuf, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf = append(stderrBuf, chunk);
  });

  if (options.stdin !== undefined) {
    child.stdin?.end(options.stdin);
  } else {
    child.stdin?.end();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, timeoutMs);

  return new Promise<RunProcessResult>((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal: signal ?? null,
        stdout: stdoutBuf.toString("utf8"),
        stderr: stderrBuf.toString("utf8"),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
  });
}
