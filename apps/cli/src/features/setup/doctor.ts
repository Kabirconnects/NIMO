import { existsSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_PATH, getConfig } from "../../lib/config";
import {
  describeEnvValue,
  getServerEnvPath,
  readEnvFile,
  readServerEnv,
  type EnvValues,
} from "../../lib/server-env";
import {
  apiCandidateUrls,
  findWorkspaceRoot,
  SERVICE_DIRS,
} from "../launcher/targets";
import { getLogDir } from "../launcher/runner";
import { configuredProviders } from "./providers";

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

type Status = "ok" | "warn" | "fail";

function line(status: Status, label: string, detail = ""): void {
  const glyph =
    status === "ok" ? "✓" : status === "warn" ? "!" : "✖";
  const color =
    status === "ok"
      ? ANSI.green
      : status === "warn"
        ? ANSI.yellow
        : ANSI.red;

  console.log(
    `  ${paint(color, glyph)} ${label}${detail ? ` ${paint(ANSI.dim, detail)}` : ""}`,
  );
}

/** Matches the API's `/health` payload, without trusting any other service. */
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

function majorVersion(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0] ?? 0);
}

/**
 * Diagnose the local install: runtime, configuration, and a running API.
 *
 * Exit code 1 only for problems that prevent the CLI from working at all;
 * a backend that is simply not started yet is a warning.
 */
export async function runDoctor(): Promise<number> {
  console.log("");
  console.log(paint(ANSI.bold, "◆ Nimo doctor"));
  console.log("");

  let failures = 0;

  // ------------------------------------------------------------------ runtime
  console.log(paint(ANSI.bold, "  Runtime"));

  const bun = process.versions.bun;
  if (bun) line("ok", "Bun", bun);
  else {
    failures += 1;
    line("fail", "Bun", "not running under Bun — install it from https://bun.sh");
  }

  const node = process.versions.node;
  if (majorVersion(node) >= 20) line("ok", "Node", node);
  else {
    failures += 1;
    line("fail", "Node", `${node} (need 20.9+)`);
  }

  const pnpm = Bun.which("pnpm");
  if (pnpm) line("ok", "pnpm", pnpm);
  else line("warn", "pnpm", "not on PATH — needed to start services from a checkout");

  const root = findWorkspaceRoot();
  if (root) line("ok", "Workspace", root);
  else {
    line(
      "warn",
      "Workspace",
      "no checkout found — set NIMO_API_URL to use a hosted API",
    );
  }

  console.log("");

  // ------------------------------------------------------------------- config
  console.log(paint(ANSI.bold, "  Configuration"));

  const personal = readServerEnv();
  const personalPath = getServerEnvPath();
  const repo: EnvValues =
    root ? readEnvFile(join(root, SERVICE_DIRS.api, ".env")) : {};

  const env = Object.keys(personal).length > 0 ? personal : repo;
  const source =
    Object.keys(personal).length > 0
      ? personalPath
      : Object.keys(repo).length > 0
        ? join(root ?? ".", SERVICE_DIRS.api, ".env")
        : "(missing)";

  if (Object.keys(personal).length > 0) {
    line("ok", "Server env", personalPath);
  } else if (Object.keys(repo).length > 0) {
    line("warn", "Server env", `${source} — run “nimo setup” for a personal config`);
  } else {
    failures += 1;
    line("fail", "Server env", "missing — run “nimo setup”");
  }

  if (!Object.keys(env).length) {
    console.log("");
    console.log(
      `  ${paint(ANSI.yellow, "Nothing configured.")} Run ${paint(ANSI.bold, "nimo setup")}.`,
    );
    console.log("");
    return 1;
  }

  if ((env.JWT_SECRET ?? "").trim().length >= 32) {
    line("ok", "JWT_SECRET", `(${env.JWT_SECRET?.trim().length} chars)`);
  } else {
    failures += 1;
    line("fail", "JWT_SECRET", "missing or shorter than 32 chars");
  }

  if (env.MONGODB_URI?.trim()) {
    line("ok", "MONGODB_URI", `(${describeEnvValue("MONGODB_URI", env.MONGODB_URI)})`);
  } else {
    failures += 1;
    line("fail", "MONGODB_URI", "missing");
  }

  if (env.AI_MODEL?.trim()) {
    line("ok", "AI_MODEL", env.AI_MODEL);
  } else {
    failures += 1;
    line("fail", "AI_MODEL", "missing");
  }

  const providers = configuredProviders(env);
  if (providers.length > 0) {
    line("ok", "Providers", providers.map((provider) => provider.label).join(", "));
  } else {
    failures += 1;
    line("fail", "Providers", "no AI provider key is set");
  }

  if (env.PORT) {
    line("ok", "Network", `${env.HOST ?? "127.0.0.1"}:${env.PORT}`);
  } else {
    line("warn", "Network", "PORT is unset; the API will fall back to 4000");
  }

  if (existsSync(CONFIG_PATH)) {
    line("ok", "CLI preferences", CONFIG_PATH);
  } else {
    line("warn", "CLI preferences", "not created yet — saved on first run");
  }

  console.log("");

  // ------------------------------------------------------------------ backend
  console.log(paint(ANSI.bold, "  Backend"));

  const urls = apiCandidateUrls(root ?? process.cwd());
  let healthy: string | null = null;

  for (const url of urls) {
    if (await probeApi(url)) {
      healthy = url;
      break;
    }
  }

  if (healthy) {
    line("ok", "API", `healthy at ${healthy}`);
  } else {
    const configured = process.env.NIMO_API_URL ?? getConfig().apiUrl;
    line(
      "warn",
      "API",
      `not reachable${configured ? ` at ${configured}` : ""} — start it with “nimo api”`,
    );
  }

  line("ok", "Logs", getLogDir());

  console.log("");

  if (failures > 0) {
    console.log(
      `  ${paint(ANSI.red, "Not ready.")} Fix the ${failures} problem${failures === 1 ? "" : "s"} above, then run “nimo doctor” again.`,
    );
    console.log("");
    return 1;
  }

  console.log(
    `  ${paint(ANSI.green, "Ready.")} Run ${paint(ANSI.bold, "nimo")} to start the API and open the chat.`,
  );
  console.log("");
  return 0;
}
