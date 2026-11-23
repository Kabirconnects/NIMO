import { existsSync } from "node:fs";

import { CONFIG_PATH, getConfig } from "../../lib/config";
import {
  describeEnvValue,
  getServerEnvPath,
  readEnvFile,
  readServerEnv,
  type EnvValues,
} from "../../lib/server-env";
import { apiCandidateUrls, findWorkspaceRoot, SERVICE_DIRS } from "../launcher/targets";
import { getLogDir } from "../launcher/runner";
import { configuredProviders } from "./providers";
import { join } from "node:path";

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  status: DoctorStatus;
  label: string;
  detail?: string;
};

export type DoctorSection = {
  title: string;
  checks: DoctorCheck[];
};

export type DoctorReport = {
  sections: DoctorSection[];
  /** Problems that stop the CLI from working at all. */
  failures: number;
  /** The API that answered a health check, when one did. */
  healthyApi: string | null;
  /** True when there is no configuration to inspect yet. */
  empty: boolean;
};

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
 * Inspect the local install and return everything that is worth showing.
 *
 * The terminal `nimo doctor` and the in-app `/doctor` screen render the same
 * report, so both always agree on what is broken.
 */
export async function collectDoctorReport(): Promise<DoctorReport> {
  const sections: DoctorSection[] = [];
  let failures = 0;

  const fail = (check: DoctorCheck): DoctorCheck => {
    if (check.status === "fail") failures += 1;
    return check;
  };

  // ------------------------------------------------------------------ runtime
  const runtime: DoctorCheck[] = [];

  const bun = process.versions.bun;
  if (bun) runtime.push({ status: "ok", label: "Bun", detail: bun });
  else {
    runtime.push(
      fail({
        status: "fail",
        label: "Bun",
        detail: "not running under Bun — install it from https://bun.sh",
      }),
    );
  }

  const node = process.versions.node;
  if (majorVersion(node) >= 20) {
    runtime.push({ status: "ok", label: "Node", detail: node });
  } else {
    runtime.push(
      fail({
        status: "fail",
        label: "Node",
        detail: `${node} (need 20.9+)`,
      }),
    );
  }

  const pnpm = Bun.which("pnpm");
  if (pnpm) runtime.push({ status: "ok", label: "pnpm", detail: pnpm });
  else {
    runtime.push({
      status: "warn",
      label: "pnpm",
      detail: "not on PATH — needed to start services from a checkout",
    });
  }

  const root = findWorkspaceRoot();
  if (root) {
    runtime.push({ status: "ok", label: "Workspace", detail: root });
  } else {
    runtime.push({
      status: "warn",
      label: "Workspace",
      detail: "no checkout found — set NIMO_API_URL to use a hosted API",
    });
  }

  sections.push({ title: "Runtime", checks: runtime });

  // ------------------------------------------------------------------- config
  const configuration: DoctorCheck[] = [];

  const personal = readServerEnv();
  const personalPath = getServerEnvPath();
  const repoPath = root ? join(root, SERVICE_DIRS.api, ".env") : null;
  const repo: EnvValues = repoPath ? readEnvFile(repoPath) : {};

  const env = Object.keys(personal).length > 0 ? personal : repo;

  if (Object.keys(personal).length > 0) {
    configuration.push({ status: "ok", label: "Server env", detail: personalPath });
    if (repoPath && Object.keys(repo).length > 0) {
      configuration.push({
        status: "ok",
        label: "Checkout env",
        detail: repoPath,
      });
    }
  } else if (Object.keys(repo).length > 0) {
    configuration.push({
      status: "warn",
      label: "Server env",
      detail: `${repoPath ?? "(missing)"} — run “nimo setup” for a personal config`,
    });
  } else {
    configuration.push(
      fail({
        status: "fail",
        label: "Server env",
        detail: "missing — run “nimo setup”",
      }),
    );
  }

  const empty = Object.keys(env).length === 0;

  if (!empty) {
    if ((env.JWT_SECRET ?? "").trim().length >= 32) {
      configuration.push({
        status: "ok",
        label: "JWT_SECRET",
        detail: `(${env.JWT_SECRET?.trim().length} chars)`,
      });
    } else {
      configuration.push(
        fail({
          status: "fail",
          label: "JWT_SECRET",
          detail: "missing or shorter than 32 chars",
        }),
      );
    }

    if (env.MONGODB_URI?.trim()) {
      configuration.push({
        status: "ok",
        label: "MONGODB_URI",
        detail: `(${describeEnvValue("MONGODB_URI", env.MONGODB_URI)})`,
      });
    } else {
      configuration.push(
        fail({ status: "fail", label: "MONGODB_URI", detail: "missing" }),
      );
    }

    if (env.AI_MODEL?.trim()) {
      configuration.push({
        status: "ok",
        label: "AI_MODEL",
        detail: env.AI_MODEL,
      });
    } else {
      configuration.push(
        fail({ status: "fail", label: "AI_MODEL", detail: "missing" }),
      );
    }

    const providers = configuredProviders(env);
    if (providers.length > 0) {
      configuration.push({
        status: "ok",
        label: "Providers",
        detail: providers.map((provider) => provider.label).join(", "),
      });
    } else {
      configuration.push(
        fail({
          status: "fail",
          label: "Providers",
          detail: "no AI provider key is set",
        }),
      );
    }

    if (env.PORT) {
      configuration.push({
        status: "ok",
        label: "Network",
        detail: `${env.HOST ?? "127.0.0.1"}:${env.PORT}`,
      });
    } else {
      configuration.push({
        status: "warn",
        label: "Network",
        detail: "PORT is unset; the API will fall back to 4000",
      });
    }
  }

  if (existsSync(CONFIG_PATH)) {
    configuration.push({
      status: "ok",
      label: "CLI preferences",
      detail: CONFIG_PATH,
    });
  } else {
    configuration.push({
      status: "warn",
      label: "CLI preferences",
      detail: "not created yet — saved on first run",
    });
  }

  sections.push({ title: "Configuration", checks: configuration });

  // ------------------------------------------------------------------ backend
  const backend: DoctorCheck[] = [];

  const urls = apiCandidateUrls(root ?? process.cwd());
  let healthy: string | null = null;

  for (const url of urls) {
    if (await probeApi(url)) {
      healthy = url;
      break;
    }
  }

  if (healthy) {
    backend.push({ status: "ok", label: "API", detail: `healthy at ${healthy}` });
  } else {
    const configured = process.env.NIMO_API_URL ?? getConfig().apiUrl;
    backend.push({
      status: "warn",
      label: "API",
      detail: `not reachable${
        configured ? ` at ${configured}` : ""
      } — start it with “nimo api”`,
    });
  }

  backend.push({ status: "ok", label: "Logs", detail: getLogDir() });

  sections.push({ title: "Backend", checks: backend });

  return { sections, failures, healthyApi: healthy, empty };
}
