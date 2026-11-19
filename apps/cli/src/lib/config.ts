import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { AgentMode, Effort } from "../features/chat/types";

/**
 * Persistent CLI preferences.
 *
 * The session cookie is written here because a terminal has no cookie jar and
 * the server issues an httpOnly `jwt` cookie. The file is created with mode
 * 0600 on platforms that support it. Use `NIMO_CLI_CONFIG` to keep it somewhere
 * else (useful for tests and throwaway profiles).
 */
export type CliConfig = {
  apiUrl?: string;
  cookie?: string;
  modelId?: string;
  effort?: Effort;
  mode?: AgentMode;
};

export const CONFIG_PATH =
  process.env.NIMO_CLI_CONFIG ?? join(homedir(), ".nimo", "cli.json");

/**
 * Base URLs tried when the user has not configured one.
 *
 * The API port lives in `apps/server/.env` (5000 here) but the server falls
 * back to 4000 when that file is missing, so the client tries both rather than
 * showing an empty model picker because of a port mismatch.
 */
export const DEFAULT_API_URLS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
] as const;

export const DEFAULT_API_URL = DEFAULT_API_URLS[0];

let cached: CliConfig | null = null;

function readConfigFile(): CliConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as CliConfig;
  } catch {
    // A missing or malformed config is not fatal: start from defaults.
    return {};
  }
}

export function getConfig(): CliConfig {
  if (!cached) cached = readConfigFile();
  return cached;
}

export function getApiUrl(): string {
  const configured = process.env.NIMO_API_URL ?? getConfig().apiUrl;
  return (configured ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

/** True when the API URL was set on purpose (env or saved config). */
export function isApiUrlExplicit(): boolean {
  return Boolean(process.env.NIMO_API_URL ?? getConfig().apiUrl);
}

export function updateConfig(patch: Partial<CliConfig>): void {
  const next: CliConfig = { ...getConfig(), ...patch };

  // `undefined` means "remove this key"; JSON.stringify would otherwise drop it
  // from the object but keep the stale value in our in-memory copy.
  for (const key of Object.keys(next) as Array<keyof CliConfig>) {
    if (next[key] === undefined) delete next[key];
  }

  cached = next;

  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Preferences are a convenience; a read-only home must not break the app.
  }
}
