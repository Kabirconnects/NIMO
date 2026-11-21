import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { updateConfig } from "../../lib/config";
import {
  apiCandidateUrls,
  findWorkspaceRoot,
  SERVICE_DIRS,
  SERVICE_LABELS,
  webCandidateUrls,
} from "./targets";
import type { ServiceId, ServiceOptions, ServiceState } from "./types";

type Child = Bun.Subprocess<"ignore", "pipe", "pipe">;

const DEFAULT_API_TIMEOUT = 120_000;
const DEFAULT_WEB_TIMEOUT = 90_000;
const MAX_RECENT_LINES = 12;

const states = new Map<ServiceId, ServiceState>();
const children = new Map<ServiceId, Child>();
const pending = new Map<ServiceId, Promise<ServiceState>>();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Where service logs are written. Shared with the TUI so it can tell users. */
export function getLogDir(): string {
  return process.env.NIMO_LOG_DIR ?? join(homedir(), ".nimo", "logs");
}

export function getServiceState(id: ServiceId): ServiceState | undefined {
  const state = states.get(id);
  return state ? { ...state, recent: [...state.recent] } : undefined;
}

/**
 * Start one service, reusing it when it is already running.
 *
 * Concurrent calls for the same service share one attempt, so spamming
 * `/backend` cannot spawn two servers on the same port.
 */
export function ensureService(
  id: ServiceId,
  options: ServiceOptions,
): Promise<ServiceState> {
  const running = pending.get(id);
  if (running) return running;

  const attempt = doEnsure(id, options).finally(() => {
    pending.delete(id);
  });

  pending.set(id, attempt);
  return attempt;
}

/** Start services in order, so the API is ready before the dashboard opens. */
export async function ensureServices(
  ids: ServiceId[],
  options: ServiceOptions,
): Promise<ServiceState[]> {
  const results: ServiceState[] = [];

  for (const id of ids) {
    results.push(await ensureService(id, options));
  }

  return results;
}

async function doEnsure(
  id: ServiceId,
  options: ServiceOptions,
): Promise<ServiceState> {
  const current = states.get(id);
  if (current?.status === "ready" && current.url) return current;

  setState(
    {
      id,
      status: "starting",
      startedHere: false,
      logPath: current?.logPath,
      recent: [],
    },
    options,
  );

  const existingUrl =
    id === "api" ? await findApi(options.root) : await findWeb();

  if (existingUrl) {
    if (id === "api" && !process.env.NIMO_API_URL) {
      updateConfig({ apiUrl: existingUrl });
    }

    return setState(
      {
        id,
        status: "ready",
        url: existingUrl,
        startedHere: false,
        logPath: current?.logPath,
        recent: [],
      },
      options,
    );
  }

  return spawnService(id, options);
}

async function spawnService(
  id: ServiceId,
  options: ServiceOptions,
): Promise<ServiceState> {
  const pnpm = resolvePnpm();
  if (!pnpm) {
    return setState(
      failure(id, "pnpm is not on PATH. Install pnpm, then try again."),
      options,
    );
  }

  const logDir = options.logDir ?? getLogDir();
  const logPath = join(logDir, `${id}.log`);

  try {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logPath, "");
  } catch {
    // A read-only home should not stop the service from running.
  }

  const workspaceDir = join(options.root, SERVICE_DIRS[id]);
  const state: ServiceState = {
    id,
    status: "starting",
    startedHere: true,
    logPath,
    recent: [],
  };
  setState(state, options);

  let child: Child;
  try {
    child = Bun.spawn([pnpm, "run", "dev"], {
      cwd: workspaceDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Keep child output readable when the console supports colour; strip
        // it for pipes so log files and captured output stay clean.
        FORCE_COLOR: childSupportsColor() ? "1" : "0",
      },
      // A detached process group can be stopped as a unit on POSIX.
      detached: process.platform !== "win32",
    });
  } catch (error) {
    return setState(failure(id, messageOf(error)), options);
  }

  state.pid = child.pid;
  children.set(id, child);
  setState(state, options);

  appendLog(logPath, `$ pnpm run dev  (${workspaceDir})`);

  let webUrl: string | undefined;

  const handleLine = (raw: string) => {
    const line = stripAnsi(raw).replace(/\r$/, "");
    if (!line.trim()) return;

    appendLog(logPath, line);
    remember(state, line);
    options.onLine?.(id, line);

    if (id === "web") {
      webUrl = extractLocalUrl(line) ?? webUrl;
    }
  };

  watchStream(child.stdout, handleLine);
  watchStream(child.stderr, handleLine);

  const url = await waitForReady(id, child, () => webUrl, options);

  if (!url) {
    const code = child.exitCode;
    children.delete(id);
    killTree(child);

    const timeout =
      options.timeoutMs ??
      (id === "api" ? DEFAULT_API_TIMEOUT : DEFAULT_WEB_TIMEOUT);
    const reason =
      code !== null
        ? `exited with code ${code}`
        : `did not answer within ${Math.round(timeout / 1000)}s`;

    return setState(failure(id, reason, state), options);
  }

  if (id === "api" && !process.env.NIMO_API_URL) {
    updateConfig({ apiUrl: url });
  }

  state.status = "ready";
  state.url = url;
  setState(state, options);

  void child.exited
    .then((code) => {
      // Removed from the map when we killed it ourselves.
      if (children.get(id) !== child) return;
      children.delete(id);

      const stopped = code === 0;
      const next: ServiceState = {
        ...state,
        status: stopped ? "stopped" : "failed",
        error: stopped ? undefined : `exited with code ${code}`,
      };

      setState(next, options);
      options.onExit?.(next);
    })
    .catch(() => {
      // `exited` rejects only when the process failed to spawn; the failure
      // path above already reported that.
    });

  return state;
}

async function waitForReady(
  id: ServiceId,
  child: Child,
  getWebUrl: () => string | undefined,
  options: ServiceOptions,
): Promise<string | null> {
  const timeout =
    options.timeoutMs ??
    (id === "api" ? DEFAULT_API_TIMEOUT : DEFAULT_WEB_TIMEOUT);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null;

    if (id === "api") {
      const url = await findApi(options.root);
      if (url) return url;
    } else {
      const discovered = getWebUrl();
      const candidates = discovered
        ? [...new Set([discovered, ...webCandidateUrls()])]
        : webCandidateUrls();

      for (const candidate of candidates) {
        if (await isHttpUp(candidate)) return candidate;
      }
    }

    await sleep(400);
  }

  return null;
}

async function findApi(root: string): Promise<string | null> {
  for (const base of apiCandidateUrls(root)) {
    if (await probeApi(base)) return base;
  }

  return null;
}

/**
 * Find an API that is already answering, without needing a checkout.
 * Used when the CLI is installed globally and cannot spawn the server itself.
 */
export async function findRunningApi(): Promise<string | null> {
  return findApi(findWorkspaceRoot() ?? process.cwd());
}

async function probeApi(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return false;
    }

    const body = (await response.json().catch(() => null)) as {
      service?: unknown;
      status?: unknown;
    } | null;

    return body?.service === "Nimo-api" || body?.status === "healthy";
  } catch {
    return false;
  }
}

async function findWeb(): Promise<string | null> {
  for (const base of webCandidateUrls()) {
    if (await isHttpUp(base)) return base;
  }

  return null;
}

async function isHttpUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1500),
    });
    await response.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function setState(state: ServiceState, options: ServiceOptions): ServiceState {
  states.set(state.id, state);
  options.onState?.({ ...state, recent: [...state.recent] });
  return state;
}

function failure(
  id: ServiceId,
  reason: string,
  from?: ServiceState,
): ServiceState {
  return {
    id,
    status: "failed",
    startedHere: from?.startedHere ?? true,
    pid: from?.pid,
    logPath: from?.logPath,
    recent: from?.recent ?? [],
    error: reason,
  };
}

function remember(state: ServiceState, line: string): void {
  state.recent.push(line);
  if (state.recent.length > MAX_RECENT_LINES) state.recent.shift();
}

function watchStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let index = buffer.indexOf("\n");
        while (index !== -1) {
          onLine(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
        }
      }

      if (buffer.length > 0) onLine(buffer);
    } catch {
      // The stream closes when the child exits; there is nothing to report.
    }
  })();
}

function appendLog(path: string, line: string): void {
  try {
    appendFileSync(path, `${line}\n`);
  } catch {
    // Logging is a convenience and must never break a launch.
  }
}

function resolvePnpm(): string | null {
  return (
    Bun.which("pnpm") ??
    Bun.which(process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  );
}

function childSupportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

/** Stop every service this CLI started. Services found already running stay up. */
export async function stopAll(): Promise<void> {
  const tracked = [...children.entries()];
  if (tracked.length === 0) return;

  for (const [id, child] of tracked) {
    children.delete(id);
    killTree(child);

    const state = states.get(id);
    if (state) states.set(id, { ...state, status: "stopped" });
  }

  // Give taskkill / signals a moment, but never hang the exit path.
  await Promise.race([
    Promise.allSettled(tracked.map(([, child]) => child.exited)),
    sleep(2500),
  ]);
}

function killTree(child: Child): void {
  if (child.exitCode !== null) return;

  if (process.platform === "win32") {
    try {
      Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      // Fall through to the direct kill below.
    }

    try {
      child.kill();
    } catch {
      // Already gone.
    }

    return;
  }

  try {
    // Negative PID targets the whole process group (spawned detached).
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

/** A one-line explanation for a service that refused to start. */
export function describeFailure(state: ServiceState): string {
  const label = SERVICE_LABELS[state.id];
  const tail = state.recent
    .slice(-3)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");

  const parts = [`${label} ${state.error ?? "failed to start"}`];
  if (tail) parts.push(tail);
  if (state.logPath) parts.push(`logs: ${state.logPath}`);

  return parts.join(" — ");
}

const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
const CSI =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function stripAnsi(value: string): string {
  return value.replace(OSC, "").replace(CSI, "");
}

/** Pull the local dev-server URL out of Vite's startup banner. */
function extractLocalUrl(line: string): string | undefined {
  const match = line.match(/https?:\/\/[^\s]+/);
  if (!match) return undefined;

  try {
    const url = new URL(match[0]);
    const host = url.hostname.replace(/^\[|\]$/g, "");

    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      return undefined;
    }

    return url.origin;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
