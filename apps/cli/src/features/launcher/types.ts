/**
 * Types shared by the argv launcher and the in-app `/dashboard` and
 * `/backend` commands.
 */

/** Long-running services the CLI can start for you. */
export type ServiceId = "api" | "web";

/** How the requested invocation should run. */
export type LaunchKind = "tui" | "headless";

export type LaunchPlan = {
  kind: LaunchKind;
  /** Services that must be running before the target becomes usable. */
  services: ServiceId[];
  /** Open the dashboard in the default browser once it answers. */
  openBrowser: boolean;
};

/** Result of reading the words typed after `nimo`. */
export type Invocation =
  | { kind: "launch"; plan: LaunchPlan }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export type ServiceStatus =
  | "idle"
  | "starting"
  | "ready"
  | "failed"
  | "stopped";

export type ServiceState = {
  id: ServiceId;
  status: ServiceStatus;
  /** Base URL the service answers on, once it is ready. */
  url?: string;
  /** PID of the process this CLI spawned, when it started the service. */
  pid?: number;
  /** False when the service was already running before Nimo looked. */
  startedHere: boolean;
  /** Human-readable reason a service could not start. */
  error?: string;
  /** Path to the service's log file in `~/.nimo/logs`. */
  logPath?: string;
  /** Last lines of output, used to explain failures. */
  recent: string[];
};

export type ServiceOptions = {
  /** Repository root that contains `apps/server` and `apps/web`. */
  root: string;
  /** How long a service may take to answer before it is considered failed. */
  timeoutMs?: number;
  /** Where to write log files. Defaults to `~/.nimo/logs`. */
  logDir?: string;
  /** Called for every line of service output (already stripped of ANSI). */
  onLine?: (id: ServiceId, line: string) => void;
  /** Called whenever a service changes state. */
  onState?: (state: ServiceState) => void;
  /** Called if a running service exits on its own. */
  onExit?: (state: ServiceState) => void;
};
