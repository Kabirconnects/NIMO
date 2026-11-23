import { join, resolve } from "node:path";

import {
  getServerEnvPath,
  readEnvFile,
  readServerEnv,
  SERVER_ENV_KEYS,
  type EnvValues,
} from "../../lib/server-env";
import { findWorkspaceRoot, SERVICE_DIRS } from "../launcher/targets";

/**
 * Where the API configuration lives.
 *
 * The terminal wizard (`nimo setup`) and the in-app setup screen share these
 * helpers so both write the exact same files with the exact same rules.
 */

/** The repository's own `.env`, used when running from a source checkout. */
export function repoEnvPath(): string | null {
  const root = findWorkspaceRoot();
  return root ? join(root, SERVICE_DIRS.api, ".env") : null;
}

export function repoEnv(): EnvValues {
  const path = repoEnvPath();
  return path ? readEnvFile(path) : {};
}

/**
 * Files `nimo setup` writes. The personal file is always written; in a source
 * checkout the server's own `.env` is written too, so `pnpm dev` from
 * `apps/server` sees the same values as the launcher.
 */
export function envTargets(): string[] {
  const personal = getServerEnvPath();
  const repo = repoEnvPath();

  if (!repo || resolve(repo) === resolve(personal)) return [personal];
  return [personal, repo];
}

export function hasValues(env: EnvValues): boolean {
  return SERVER_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

/**
 * The effective configuration: the checkout's `.env` with the personal file
 * layered on top, so the personal file always wins per key.
 */
export function currentEnv(): EnvValues {
  return { ...repoEnv(), ...readServerEnv() };
}

/** Partial secret shown next to a prompt: enough to recognise, not to reuse. */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "(set)";
  return `(${trimmed.slice(0, 4)}…${trimmed.slice(-4)})`;
}

/** The saved endpoint, shown in full so it can be compared with a new one. */
export function describeMongoUri(uri: string | undefined): string {
  if (!uri?.trim()) return "(missing)";
  return uri.trim();
}
