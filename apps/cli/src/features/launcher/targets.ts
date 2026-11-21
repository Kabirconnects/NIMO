import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  DEFAULT_API_URLS,
  getConfig,
  getApiUrl,
} from "../../lib/config";
import type { Invocation, LaunchPlan, ServiceId } from "./types";

export const SERVICE_LABELS: Record<ServiceId, string> = {
  api: "API",
  web: "Web",
};

/** Folders relative to the workspace root that own each service. */
export const SERVICE_DIRS: Record<ServiceId, string> = {
  api: "apps/server",
  web: "apps/web",
};

/** Vite's default dev-server port, used only as a fallback probe. */
export const WEB_PORT = 5173;

const TUI_TARGETS = new Set(["cli", "chat", "tui"]);
const DASHBOARD_TARGETS = new Set([
  "dashboard",
  "dash",
  "web",
  "ui",
  "frontend",
]);
const API_TARGETS = new Set(["api", "backend", "server"]);
const ALL_TARGETS = new Set(["dev", "start", "all", "run"]);
const HELP_TARGETS = new Set(["help"]);
const VERSION_TARGETS = new Set(["version"]);

function helpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h" || arg === "-?";
}

function versionFlag(arg: string): boolean {
  return arg === "--version" || arg === "-v";
}

function tuiPlan(services: ServiceId[]): LaunchPlan {
  return { kind: "tui", services, openBrowser: false };
}

function headlessPlan(
  services: ServiceId[],
  openBrowser: boolean,
): LaunchPlan {
  return { kind: "headless", services, openBrowser };
}

/**
 * Turn the words after `nimo` into a launch plan.
 *
 * Kept pure and free of I/O so it can be unit tested, and so `--help` works
 * even when the CLI is run outside a checkout.
 */
export function resolveInvocation(args: string[]): Invocation {
  const words = args
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => arg.toLowerCase());
  const flags = args.filter((arg) => arg.startsWith("-"));

  if (args.some(helpFlag) || words.includes("help")) {
    return { kind: "help" };
  }

  if (args.some(versionFlag) || words.includes("version")) {
    return { kind: "version" };
  }

  const knownFlags = new Set(["--no-browser", "--no-open"]);
  const unknownFlag = flags.find((flag) => !knownFlags.has(flag));

  if (unknownFlag) {
    return { kind: "error", message: `unknown option “${unknownFlag}”` };
  }

  const noBrowser = flags.some((flag) => knownFlags.has(flag));
  const [word, ...rest] = words;

  if (rest.length > 0) {
    return {
      kind: "error",
      message: `unexpected argument “${rest[0]}”`,
    };
  }

  // No words at all: start the API (reusing one that is already running) and
  // open the terminal chat. This mirrors `nimo cli`, so `nimo` works out of the
  // box instead of opening a chat whose backend was never started.
  if (!word) {
    if (noBrowser) {
      return {
        kind: "error",
        message: "“--no-browser” only applies to the dashboard",
      };
    }
    return { kind: "launch", plan: tuiPlan(["api"]) };
  }

  if (TUI_TARGETS.has(word)) {
    if (noBrowser) {
      return {
        kind: "error",
        message: "“--no-browser” only applies to the dashboard",
      };
    }
    return { kind: "launch", plan: tuiPlan(["api"]) };
  }

  if (DASHBOARD_TARGETS.has(word) || ALL_TARGETS.has(word)) {
    return {
      kind: "launch",
      plan: headlessPlan(["api", "web"], !noBrowser),
    };
  }

  if (API_TARGETS.has(word)) {
    if (noBrowser) {
      return {
        kind: "error",
        message: "“--no-browser” only applies to the dashboard",
      };
    }
    return { kind: "launch", plan: headlessPlan(["api"], false) };
  }

  return {
    kind: "error",
    message: unknownCommandMessage(word),
  };
}

const KNOWN_TARGETS = [
  ...TUI_TARGETS,
  ...DASHBOARD_TARGETS,
  ...API_TARGETS,
  ...ALL_TARGETS,
  "help",
  "version",
];

function unknownCommandMessage(word: string): string {
  const suggestion = closestTarget(word);

  return suggestion
    ? `unknown command “${word}” — did you mean “${suggestion}”?`
    : `unknown command “${word}” — try “nimo help”`;
}

function closestTarget(word: string): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of KNOWN_TARGETS) {
    const distance = editDistance(word, target);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }

  return bestDistance <= 2 ? best : null;
}

/** Levenshtein distance, used only for “did you mean” suggestions. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const diagonal = previous[j - 1] ?? 0;
      const left = current[j - 1] ?? 0;
      const substitution =
        diagonal + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1);

      current[j] = Math.min(above + 1, left + 1, substitution);
    }

    previous = current;
  }

  return previous[b.length] ?? b.length;
}

/**
 * Locate the monorepo root.
 *
 * `nimo` is usually run from the repository (or from `apps/cli` during
 * development), but a globally linked binary can be started from anywhere.
 * Walk up from the current directory first, then from the module location.
 */
export function findWorkspaceRoot(): string | null {
  const override = process.env.NIMO_WORKSPACE_ROOT;
  if (override && isWorkspaceRoot(override)) return resolve(override);

  const starts = [process.cwd(), import.meta.dir];

  for (const start of starts) {
    let dir = resolve(start);

    for (let depth = 0; depth < 12; depth += 1) {
      if (isWorkspaceRoot(dir)) return dir;

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

function isWorkspaceRoot(dir: string): boolean {
  return (
    existsSync(join(dir, "pnpm-workspace.yaml")) &&
    existsSync(join(dir, SERVICE_DIRS.api, "package.json")) &&
    existsSync(join(dir, SERVICE_DIRS.web, "package.json"))
  );
}

/** Read only the port from `apps/server/.env`; never logs other values. */
export function readApiPort(root: string): number | null {
  try {
    const raw = readFileSync(join(root, SERVICE_DIRS.api, ".env"), "utf8");
    const match = raw.match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m);
    if (!match) return null;

    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * API base URLs worth probing, most likely first.
 *
 * The port belongs to `apps/server/.env`; the defaults cover a fresh checkout
 * where that file is missing. `NIMO_API_URL` and a saved preference stay at the
 * front so a deliberately hosted API is never overridden by a local one.
 */
export function apiCandidateUrls(root: string): string[] {
  const configured = process.env.NIMO_API_URL ?? getConfig().apiUrl;
  const urls: string[] = [];

  if (configured) urls.push(configured.replace(/\/+$/, ""));

  const port = readApiPort(root);
  if (port) {
    urls.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }

  urls.push(getApiUrl(), ...DEFAULT_API_URLS);

  return [...new Set(urls)];
}

export function webCandidateUrls(): string[] {
  return [
    `http://localhost:${WEB_PORT}`,
    `http://127.0.0.1:${WEB_PORT}`,
  ];
}
