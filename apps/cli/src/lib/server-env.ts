import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The API reads its configuration from environment variables. In a source
 * checkout those live in `apps/server/.env`; for an installed CLI they live in
 * `~/.nimo/server.env` (override with `NIMO_SERVER_ENV`).
 *
 * The file is a plain dotenv file so it can be inspected and edited by hand.
 * It is written with mode 0600 because it contains API keys.
 */
export type EnvValues = Record<string, string>;

export const SERVER_ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "HOST",
  "CLIENT_URL",
  "MONGODB_URI",
  "JWT_SECRET",
  "AI_MODEL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];

export const DEFAULT_SERVER_ENV: Partial<EnvValues> = {
  NODE_ENV: "development",
  PORT: "5000",
  HOST: "127.0.0.1",
  CLIENT_URL: "http://localhost:5173",
  AI_MODEL: "anthropic/claude-sonnet-4-5",
};

export function getServerEnvPath(): string {
  return (
    process.env.NIMO_SERVER_ENV ?? join(homedir(), ".nimo", "server.env")
  );
}

/** Parse `KEY=value` lines, ignoring comments and blank lines. */
export function parseEnv(raw: string): EnvValues {
  const values: EnvValues = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = (match[2] ?? "").trim();
    if (!key) continue;

    values[key] = unquote(rawValue);
  }

  return values;
}

function unquote(value: string): string {
  const first = value.charAt(0);
  if (first !== '"' && first !== "'") {
    // Strip an inline comment only when it is clearly separated.
    return value.replace(/\s+#.*$/, "").trim();
  }

  const last = value.lastIndexOf(first);
  if (last <= 0) return value;

  const body = value.slice(1, last);
  return first === '"' ? body.replace(/\\n/g, "\n") : body;
}

function quote(value: string): string {
  return /[\s#'"]/.test(value) ? JSON.stringify(value) : value;
}

/** Read a dotenv file; a missing or unreadable file yields `{}`. */
export function readEnvFile(path: string): EnvValues {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function readServerEnv(): EnvValues {
  return readEnvFile(getServerEnvPath());
}

/**
 * Merge `~/.nimo/server.env` into the current process environment.
 *
 * Real environment variables win, so `PORT=6000 nimo api` still works, and a
 * child service spawned with `...process.env` inherits the merged values.
 */
export function loadServerEnv(): void {
  for (const [key, value] of Object.entries(readServerEnv())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Keep known keys in a stable order, preserve anything the user added. */
export function writeServerEnv(values: EnvValues): string {
  const path = getServerEnvPath();
  const ordered: EnvValues = {};

  for (const key of SERVER_ENV_KEYS) {
    const value = values[key];
    if (value !== undefined && value !== "") ordered[key] = value;
  }

  for (const [key, value] of Object.entries(values)) {
    if (ordered[key] === undefined && value !== "") ordered[key] = value;
  }

  const body = Object.entries(ordered)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join("\n");

  const contents = `${body}\n`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });

  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some filesystems do not support POSIX modes.
  }

  return path;
}

/** Human-readable value that never prints a secret. */
export function describeEnvValue(key: string, value: string): string {
  if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key)) {
    return `set (${value.length} chars)`;
  }

  if (key === "MONGODB_URI") {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return "set";
    }
  }

  return value;
}
