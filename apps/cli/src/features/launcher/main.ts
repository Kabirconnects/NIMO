import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openUrl } from "../../lib/open-url";
import { ensureServices, describeFailure, getLogDir, stopAll } from "./runner";
import { findWorkspaceRoot, SERVICE_LABELS } from "./targets";
import type {
  LaunchPlan,
  ServiceId,
  ServiceOptions,
  ServiceState,
} from "./types";

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
} as const;

const useColor = (): boolean =>
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string, value: string): string {
  return useColor() ? `${code}${value}${ANSI.reset}` : value;
}

const LOG_PREFIX: Record<ServiceId, string> = {
  api: paint("\u001B[36m", "[api]"),
  web: paint("\u001B[35m", "[web]"),
};

export function getVersion(): string {
  try {
    const raw = readFileSync(
      join(import.meta.dir, "../../../package.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.1";
  } catch {
    return "0.0.1";
  }
}

export function printVersion(): void {
  console.log(`nimo ${getVersion()}`);
}

export function printHelp(): void {
  const lines = [
    "",
    `${paint(ANSI.bold, "◆ Nimo")} · AI agent in your terminal`,
    "",
    paint(ANSI.bold, "USAGE"),
    "  nimo                 Open the terminal chat",
    "  nimo cli             Start the API if needed, then open the chat",
    "  nimo dashboard       Start the API and web dashboard, then open it",
    "  nimo web | ui        Aliases for dashboard",
    "  nimo api             Start the Nimo API only",
    "  nimo backend|server  Aliases for api",
    "  nimo dev | start | all",
    "                       Start the API and dashboard together",
    "  nimo help            Show this help",
    "  nimo version         Print the version",
    "",
    paint(ANSI.bold, "OPTIONS"),
    "  --no-browser         Do not open a browser (dashboard / dev / all)",
    "",
    paint(ANSI.bold, "ENVIRONMENT"),
    "  NIMO_API_URL         Point the CLI at a running API",
    "  NIMO_WORKSPACE_ROOT  Repository root when run from outside it",
    "  NIMO_NO_BROWSER=1    Never open a browser",
    "  NIMO_LOG_DIR         Where service logs are written",
    "",
    paint(ANSI.bold, "EXAMPLES"),
    "  nimo dashboard       API + web dashboard, ready to use",
    "  nimo cli             API + terminal chat",
    "  nimo api             Just the backend",
    "",
    paint(ANSI.dim, `Logs: ${getLogDir()}`),
    "",
  ];

  console.log(lines.join("\n"));
}

/**
 * Start the API before handing the terminal to the TUI.
 *
 * The API's stdout is piped to a log file, so it cannot corrupt the renderer.
 * If the service cannot start, we bail out with a readable message instead of
 * opening a chat that cannot reach anything.
 */
export async function prepareTui(plan: LaunchPlan): Promise<boolean> {
  if (plan.services.length === 0) return true;

  const root = findWorkspaceRoot();
  if (!root) {
    console.error(
      "✖ Cannot find the Nimo workspace. Run this from the repository, or set NIMO_WORKSPACE_ROOT.",
    );
    return false;
  }

  const states = await ensureServices(plan.services, {
    root,
    onState: (state) => {
      if (state.status === "starting" && state.startedHere) {
        console.log(
          paint(
            ANSI.dim,
            `  Starting the ${SERVICE_LABELS[state.id]} (logs: ${
              state.logPath ?? getLogDir()
            })…`,
          ),
        );
      }

      if (state.status === "ready" && state.url) {
        const prefix = state.startedHere ? "ready at" : "already running at";
        console.log(
          paint(ANSI.green, `  ${SERVICE_LABELS[state.id]} ${prefix} ${state.url}`),
        );
      }
    },
  });

  const failed = states.find((state) => state.status === "failed");
  if (failed) {
    console.error(paint(ANSI.red, `✖ ${describeFailure(failed)}`));
    await stopAll();
    return false;
  }

  return true;
}

/**
 * Run a target that does not use the TUI (`dashboard`, `api`, `all`…).
 *
 * Logs are streamed with a service prefix and also written to `~/.nimo/logs`.
 * The promise resolves only when ctrl+c is pressed or a service dies, so the
 * caller can set a process exit code.
 */
export async function runHeadless(plan: LaunchPlan): Promise<number> {
  const root = findWorkspaceRoot();
  if (!root) {
    console.error(
      "✖ Cannot find the Nimo workspace. Run this from the repository, or set NIMO_WORKSPACE_ROOT.",
    );
    return 1;
  }

  const targets = plan.services
    .map((id) => SERVICE_LABELS[id])
    .join(" + ");

  console.log(
    `${paint(ANSI.bold, "◆ Nimo")} ${paint(ANSI.dim, `· starting ${targets}`)}`,
  );

  let cancelled = false;
  let finish: ((code: number) => void) | null = null;

  const finished = new Promise<number>((resolve) => {
    finish = resolve;
  });

  const onSignal = () => {
    if (cancelled) return;
    cancelled = true;
    finish?.(0);
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const seen = new Map<ServiceId, string>();

  const options: ServiceOptions = {
    root,
    onState: (state) => printTransition(state, seen),
    onLine: (id, line) => {
      if (!line.trim()) return;
      console.log(`${LOG_PREFIX[id]} ${line}`);
    },
    onExit: (state) => {
      if (cancelled) return;
      cancelled = true;

      console.error(
        paint(
          ANSI.red,
          `✖ ${SERVICE_LABELS[state.id]} stopped unexpectedly${
            state.logPath ? ` (logs: ${state.logPath})` : ""
          }`,
        ),
      );
      finish?.(1);
    },
  };

  const cleanup = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await stopAll();
  };

  const states = await ensureServices(plan.services, options);

  if (cancelled) {
    await cleanup();
    return 0;
  }

  const failed = states.find((state) => state.status === "failed");
  if (failed) {
    console.error(paint(ANSI.red, `✖ ${describeFailure(failed)}`));
    await cleanup();
    return 1;
  }

  const web = states.find((state) => state.id === "web");

  if (web?.url) {
    if (plan.openBrowser) {
      const opened = openUrl(web.url);
      console.log(
        paint(
          ANSI.dim,
          opened
            ? `  Opened ${web.url} in your browser.`
            : `  Open ${web.url} in your browser.`,
        ),
      );
    } else {
      console.log(paint(ANSI.dim, `  Open ${web.url} in your browser.`));
    }
  }

  console.log(paint(ANSI.dim, `  Logs: ${getLogDir()}`));
  console.log(paint(ANSI.dim, "  Press ctrl+c to stop."));

  const code = await finished;

  console.log(paint(ANSI.dim, "\nStopping services…"));
  await cleanup();

  return code;
}

function printTransition(
  state: ServiceState,
  seen: Map<ServiceId, string>,
): void {
  if (seen.get(state.id) === state.status) return;
  seen.set(state.id, state.status);

  const label = SERVICE_LABELS[state.id].padEnd(3);

  switch (state.status) {
    case "starting":
      console.log(paint(ANSI.yellow, `  ◌ ${label} starting…`));
      break;
    case "ready":
      console.log(
        paint(
          ANSI.green,
          `  ● ${label} ${state.url ?? ""}${
            state.startedHere ? "" : "  (already running)"
          }`,
        ),
      );
      break;
    case "failed":
      console.log(
        paint(ANSI.red, `  ✖ ${label} ${state.error ?? "failed to start"}`),
      );
      break;
    case "stopped":
      console.log(paint(ANSI.dim, `  · ${label} stopped`));
      break;
    default:
      break;
  }
}
