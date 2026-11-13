// tools/shared/process.ts
// One hardened process runner shared by runCommand / runTests / gitStatus /
// benchmark / tool-foundry / manageProcess.
//
// Properties that matter for an agent harness:
//   - allowlisted executables only (no arbitrary binaries);
//   - argv arrays, not string interpolation, so `; rm -rf` is never a command;
//   - Windows .cmd shims run through cmd.exe with every token validated
//     against shell metacharacters, so `&&`, `|`, `>` cannot be injected;
//   - scrubbed environment (API keys never reach child processes);
//   - hard timeout with process-tree kill;
//   - bounded output that keeps the tail (where build/test errors live);
//   - long-running commands (dev servers, watchers, installs) can be detached
//     after a short wait window and inspected/stopped later instead of hanging
//     the agent until a timeout kills the thing it just started.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, StdioOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  "deno",
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
  "uv",
  "poetry",
  "go",
  "cargo",
  "rustc",
  "make",
  "cmake",
  "gcc",
  "g++",
  "cc",
  "clang",
  "clang++",
  "dotnet",
  "java",
  "javac",
  "mvn",
  "gradle",
  "docker",
  "docker-compose",
  "sqlite3",
  "curl",
  "tar",
  "zip",
  "unzip",
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
  /**
   * Wait at most this long for the process to exit. If it is still running,
   * return immediately with `running: true` and leave it running in the
   * background (id/pid/logFile) instead of blocking or killing it.
   * Omit for the classic "wait until exit or timeout" behaviour.
   */
  waitMs?: number;
}

export interface RunProcessResult {
  ok: boolean;
  /** The command did not exit within waitMs and was left running. */
  running?: boolean;
  /** Background process id (present whenever the command outlived waitMs). */
  id?: string;
  pid?: number | null;
  /** Absolute path to the captured stdout log (background mode). */
  logFile?: string;
  /** An identical command was already running and was reused. */
  reused?: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Background process registry
// ---------------------------------------------------------------------------
// Long-running dev servers must survive both the tool call and (ideally) a
// restart of the API process, so metadata is mirrored to
// `<workspace>/.nimo-procs/<id>.json` next to the stdout/stderr logs.

export type ProcessStatus = "running" | "exited" | "failed" | "stopped";

export interface BackgroundProcessInfo {
  id: string;
  command: string;
  cwd: string;
  relCwd: string;
  pid: number | null;
  status: ProcessStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  logFile: string;
  errLogFile: string;
  relLogFile: string;
  relErrLogFile: string;
}

interface LiveProcess extends BackgroundProcessInfo {
  child?: ChildProcess;
}

const live = new Map<string, LiveProcess>();

function procDir(): string {
  const dir = path.join(ROOT, ".nimo-procs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function metaFile(id: string): string {
  return path.join(procDir(), `${id}.json`);
}

function relOrSelf(full: string): string {
  const rel = path.relative(ROOT, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return full;
  return rel.split(path.sep).join("/");
}

/** Metadata only — never the ChildProcess handle (not serialisable). */
function toPlain(info: BackgroundProcessInfo): BackgroundProcessInfo {
  return {
    id: info.id,
    command: info.command,
    cwd: info.cwd,
    relCwd: info.relCwd,
    pid: info.pid,
    status: info.status,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    exitCode: info.exitCode,
    signal: info.signal,
    logFile: info.logFile,
    errLogFile: info.errLogFile,
    relLogFile: info.relLogFile,
    relErrLogFile: info.relErrLogFile,
  };
}

function persist(info: BackgroundProcessInfo): void {
  try {
    fs.writeFileSync(metaFile(info.id), JSON.stringify(toPlain(info), null, 2), "utf-8");
  } catch {
    /* the registry is best-effort; logs still exist */
  }
}

function readMeta(id: string): BackgroundProcessInfo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(metaFile(id), "utf-8")) as BackgroundProcessInfo;
    if (!raw || typeof raw.id !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (pid === null || pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLogTail(file: string, maxBytes: number): { text: string; truncated: boolean } {
  try {
    const stat = fs.statSync(file);
    if (stat.size === 0) return { text: "", truncated: false };
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return { text: buffer.toString("utf8"), truncated: start > 0 };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { text: "", truncated: false };
  }
}

function killPidTree(pid: number | null | undefined, wait: boolean): void {
  if (pid === null || pid === undefined) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/t", "/f"];
    if (wait) {
      try {
        spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
      } catch {
        /* already gone */
      }
      return;
    }
    try {
      spawn("taskkill", args, { stdio: "ignore", windowsHide: true }).unref();
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/** All known processes, live ones first, newest first. */
export function listBackgroundProcesses(): BackgroundProcessInfo[] {
  const merged = new Map<string, BackgroundProcessInfo>();

  let files: string[] = [];
  try {
    files = fs.readdirSync(procDir());
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const info = readMeta(file.replace(/\.json$/, ""));
    if (!info) continue;
    if (info.status === "running" && !live.has(info.id) && !isPidAlive(info.pid)) {
      // The API restarted (or the machine rebooted) and the pid is gone.
      info.status = "exited";
      info.endedAt = info.endedAt ?? new Date().toISOString();
      persist(info);
    }
    merged.set(info.id, info);
  }

  for (const [id, info] of live) merged.set(id, toPlain(info));

  return [...merged.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getBackgroundProcess(id: string): BackgroundProcessInfo | null {
  const info = live.get(id) ?? readMeta(id);
  return info ? toPlain(info) : null;
}

export interface BackgroundLogResult {
  id: string;
  status: ProcessStatus;
  command: string;
  relCwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logFile: string;
  errLogFile: string;
}

export function readBackgroundLogs(id: string, maxBytes = 20_000): BackgroundLogResult {
  const info = getBackgroundProcess(id);
  if (!info) throw new Error(`No process with id '${id}'. Use action="list" to see ids.`);

  const out = readLogTail(info.logFile, maxBytes);
  const err = readLogTail(info.errLogFile, maxBytes);
  return {
    id: info.id,
    status: info.status,
    command: info.command,
    relCwd: info.relCwd,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    exitCode: info.exitCode ?? null,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    logFile: info.relLogFile,
    errLogFile: info.relErrLogFile,
  };
}

export function stopBackgroundProcess(id: string): BackgroundProcessInfo {
  const info = live.get(id) ?? readMeta(id);
  if (!info) throw new Error(`No process with id '${id}'. Use action="list" to see ids.`);

  if (info.status !== "running") return toPlain(info);

  killPidTree(info.pid, true);
  info.status = "stopped";
  info.endedAt = new Date().toISOString();
  const current = live.get(id);
  if (current) {
    current.status = "stopped";
    current.endedAt = info.endedAt;
  }
  persist(current ?? info);
  return toPlain(current ?? info);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

interface LaunchSpec {
  commandLine: string;
  cwd: string;
  args: string[];
  launchBin: string;
  useCmd: boolean;
  env: NodeJS.ProcessEnv;
  isWindows: boolean;
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

function prepareLaunch(options: RunProcessOptions): LaunchSpec {
  const argv = runnableArgv(options);
  const [rawBin, ...args] = argv;
  const bin = rawBin!;
  const cwd = options.cwd;
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

  return { commandLine: argv.join(" "), cwd, args, launchBin, useCmd, env, isWindows };
}

function spawnChild(
  spec: LaunchSpec,
  stdio: StdioOptions,
  detached: boolean,
): ChildProcess {
  // cmd.exe /s /c strips the first and last quote, so wrap the already-quoted
  // command in one outer pair. Every token was validated by quoteForCmd.
  const cmdLine = `"${[spec.launchBin, ...spec.args].map(quoteForCmd).join(" ")}"`;

  if (spec.useCmd) {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd: spec.cwd,
      env: spec.env,
      windowsHide: true,
      detached,
      // Node's default argument quoting uses backslash escapes that cmd.exe
      // does not understand. Pass the already-quoted command verbatim.
      windowsVerbatimArguments: true,
      stdio,
    });
  }

  return spawn(spec.launchBin, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    windowsHide: true,
    shell: false,
    detached,
    stdio,
  });
}

interface DetachedStart {
  info: LiveProcess;
  child: ChildProcess;
}

function spawnDetached(spec: LaunchSpec, options: RunProcessOptions): DetachedStart {
  const id = `p-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const dir = procDir();
  const logFile = path.join(dir, `${id}.out.log`);
  const errLogFile = path.join(dir, `${id}.err.log`);
  fs.writeFileSync(logFile, "");
  fs.writeFileSync(errLogFile, "");

  const outFd = fs.openSync(logFile, "a");
  const errFd = fs.openSync(errLogFile, "a");
  let child: ChildProcess;
  try {
    child = spawnChild(spec, ["pipe", outFd, errFd], true);
  } finally {
    // The child holds its own duplicate of the descriptors.
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }

  // Never leave a background command waiting on stdin.
  if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  else child.stdin?.end();

  const startedAt = new Date().toISOString();
  const info: LiveProcess = {
    id,
    command: spec.commandLine,
    cwd: spec.cwd,
    relCwd: relOrSelf(spec.cwd),
    pid: child.pid ?? null,
    status: "running",
    startedAt,
    logFile,
    errLogFile,
    relLogFile: relOrSelf(logFile),
    relErrLogFile: relOrSelf(errLogFile),
    child,
  };

  live.set(id, info);
  persist(info);

  const settle = (status: ProcessStatus, code: number | null, signal: NodeJS.Signals | null) => {
    // A stop already marked it, do not resurrect it as "exited".
    const current = live.get(id) ?? info;
    if (current.status === "stopped") {
      current.exitCode = code;
      current.signal = signal ?? null;
      persist(current);
      return;
    }
    current.status = status;
    current.exitCode = code;
    current.signal = signal ?? null;
    current.endedAt = new Date().toISOString();
    persist(current);
  };

  child.once("exit", (code, signal) => {
    settle(code === 0 ? "exited" : "failed", code, signal);
  });
  child.once("error", () => {
    settle("failed", null, null);
  });

  return { info, child };
}

function findRunningByCommand(commandLine: string, cwd: string): LiveProcess | null {
  for (const info of live.values()) {
    if (info.status !== "running") continue;
    if (info.command !== commandLine) continue;
    if (path.resolve(info.cwd) !== path.resolve(cwd)) continue;
    if (!isPidAlive(info.pid)) continue;
    return info;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const spec = prepareLaunch(options);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 600_000);
  const maxBytes = Math.min(Math.max(options.maxOutputBytes ?? 24_000, 1_000), 1_000_000);

  if (options.waitMs !== undefined) {
    const waitMs = Math.min(Math.max(options.waitMs, 0), 600_000);
    return runWithWaitWindow(spec, options, waitMs, maxBytes);
  }
  return runToCompletion(spec, options, timeoutMs, maxBytes);
}

/** Classic behaviour: wait for exit, kill the tree on timeout. */
function runToCompletion(
  spec: LaunchSpec,
  options: RunProcessOptions,
  timeoutMs: number,
  maxBytes: number,
): Promise<RunProcessResult> {
  const child = spawnChild(spec, ["pipe", "pipe", "pipe"], false);

  const started = Date.now();
  let timedOut = false;
  let truncated = false;
  let stdoutBuf: Buffer = Buffer.alloc(0);
  let stderrBuf: Buffer = Buffer.alloc(0);

  const append = (current: Buffer, chunk: Buffer): Buffer => {
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

  if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  else child.stdin?.end();

  const timer = setTimeout(() => {
    timedOut = true;
    killPidTree(child.pid, false);
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
        running: false,
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

/**
 * Long-running behaviour: wait up to `waitMs`, then hand the process back to
 * the caller with an id so it can be inspected (logs) and stopped later.
 * An identical command already running is reused instead of duplicated.
 */
function runWithWaitWindow(
  spec: LaunchSpec,
  options: RunProcessOptions,
  waitMs: number,
  maxBytes: number,
): Promise<RunProcessResult> {
  const started = Date.now();

  const existing = findRunningByCommand(spec.commandLine, spec.cwd);
  if (existing) {
    const out = readLogTail(existing.logFile, maxBytes);
    const err = readLogTail(existing.errLogFile, maxBytes);
    return Promise.resolve({
      ok: true,
      running: true,
      reused: true,
      id: existing.id,
      pid: existing.pid,
      logFile: existing.relLogFile,
      exitCode: null,
      signal: null,
      stdout: out.text,
      stderr: err.text,
      durationMs: 0,
      timedOut: false,
      truncated: out.truncated || err.truncated,
    });
  }

  let start: DetachedStart;
  try {
    start = spawnDetached(spec, options);
  } catch (error) {
    return Promise.reject(error);
  }

  const { info, child } = start;

  return new Promise<RunProcessResult>((resolve, reject) => {
    let settled = false;

    const finish = (running: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);

      const out = readLogTail(info.logFile, maxBytes);
      const err = readLogTail(info.errLogFile, maxBytes);
      const current = live.get(info.id) ?? info;
      const finishedOk = current.status === "exited" || current.exitCode === 0;

      resolve({
        ok: running ? true : finishedOk,
        running,
        id: current.id,
        pid: current.pid,
        logFile: current.relLogFile,
        exitCode: running ? null : (current.exitCode ?? null),
        signal: running ? null : ((current.signal as NodeJS.Signals | null) ?? null),
        stdout: out.text,
        stderr: err.text,
        durationMs: Date.now() - started,
        timedOut: false,
        truncated: out.truncated || err.truncated,
      });
    };

    // waitMs === 0 means "detach immediately, do not wait at all".
    const waitTimer = setTimeout(() => finish(true), waitMs);

    child.once("close", () => finish(false));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);
      reject(error);
    });
  });
}

/** Start a command fully detached and return at once (background: true). */
export function startBackgroundProcess(options: RunProcessOptions): {
  info: BackgroundProcessInfo;
  reused: boolean;
} {
  const spec = prepareLaunch(options);
  const existing = findRunningByCommand(spec.commandLine, spec.cwd);
  if (existing) return { info: toPlain(existing), reused: true };
  return { info: toPlain(spawnDetached(spec, options).info), reused: false };
}
