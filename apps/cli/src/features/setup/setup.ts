import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { getConfig, updateConfig } from "../../lib/config";
import {
  DEFAULT_SERVER_ENV,
  describeEnvValue,
  getServerEnvPath,
  readEnvFile,
  readServerEnv,
  SERVER_ENV_KEYS,
  writeServerEnv,
  type EnvValues,
} from "../../lib/server-env";
import { findWorkspaceRoot, SERVICE_DIRS } from "../launcher/targets";
import { configuredProviders, PROVIDERS, providerForModel } from "./providers";

export type SetupOptions = {
  /** Only report whether the saved configuration is complete. */
  check: boolean;
  /** Regenerate secrets instead of keeping the saved ones. */
  force: boolean;
  /** Never prompt; read values from the environment and the saved file. */
  yes: boolean;
};

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

const ok = (message: string) =>
  console.log(`  ${paint(ANSI.green, "✓")} ${message}`);
const warn = (message: string) =>
  console.log(`  ${paint(ANSI.yellow, "!")} ${message}`);
const bad = (message: string) =>
  console.log(`  ${paint(ANSI.red, "✖")} ${message}`);
const dim = (message: string) => console.log(paint(ANSI.dim, message));

/**
 * True when the saved values are enough to boot the API and answer a prompt:
 * a signing secret, a database, a model, and at least one provider key.
 */
export function isServerEnvReady(env: EnvValues): boolean {
  return missingServerEnv(env).length === 0;
}

function missingServerEnv(env: EnvValues): string[] {
  const missing: string[] = [];

  if ((env.JWT_SECRET ?? "").trim().length < 32) missing.push("JWT_SECRET");
  if (!env.MONGODB_URI?.trim()) missing.push("MONGODB_URI");
  if (!env.AI_MODEL?.trim()) missing.push("AI_MODEL");
  if (configuredProviders(env).length === 0) {
    missing.push("one AI provider key");
  }

  return missing;
}

/** The repository's own `.env`, used when running from a source checkout. */
function repoEnvPath(): string | null {
  const root = findWorkspaceRoot();
  return root ? join(root, SERVICE_DIRS.api, ".env") : null;
}

function repoEnv(): EnvValues {
  const path = repoEnvPath();
  return path ? readEnvFile(path) : {};
}

/**
 * Files `nimo setup` writes. The personal file is always written; in a source
 * checkout the server's own `.env` is written too, so `pnpm dev` from
 * `apps/server` sees the same values as the launcher.
 */
function envTargets(): string[] {
  const personal = getServerEnvPath();
  const repo = repoEnvPath();

  if (!repo || resolve(repo) === resolve(personal)) return [personal];
  return [personal, repo];
}

function hasValues(env: EnvValues): boolean {
  return SERVER_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

/** Partial secret shown next to a prompt: enough to recognise, not to reuse. */
function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "(set)";
  return `(${trimmed.slice(0, 4)}…${trimmed.slice(-4)})`;
}

function printExisting(env: EnvValues, targets: string[]): void {
  console.log(paint(ANSI.bold, "  Current configuration"));
  for (const target of targets) dim(`  ${target}`);
  console.log("");

  if (!hasValues(env)) {
    dim("  Nothing saved yet — starting fresh.");
    console.log("");
    return;
  }

  const providers = configuredProviders(env);

  console.log(
    `  ${paint(ANSI.dim, "MongoDB")}   ${describeMongo(env.MONGODB_URI)}`,
  );
  console.log(
    `  ${paint(ANSI.dim, "Model")}     ${env.AI_MODEL?.trim() || "(default)"}`,
  );
  console.log(
    `  ${paint(ANSI.dim, "Providers")} ${
      providers
        .map(
          (provider) =>
            `${provider.label} ${maskSecret(env[provider.env] ?? "")}`,
        )
        .join(", ") || "(none)"
    }`,
  );
  console.log("");
  dim(
    "  Press Enter to keep a value, type a new one to replace it, or “-” to clear a key.",
  );
  console.log("");
}

async function askKeep(
  rl: ReturnType<typeof createInterface>,
): Promise<boolean> {
  const answer = (
    await rl.question("  Keep these values and skip the prompts? [Y/n]: ")
  )
    .trim()
    .toLowerCase();

  return answer === "" || answer === "y" || answer === "yes";
}

function printCheck(env: EnvValues, source: string): number {
  console.log("");
  console.log(paint(ANSI.bold, "◆ Nimo setup"));
  console.log("");
  dim(`  Config: ${source}`);
  console.log("");

  const missing = missingServerEnv(env);

  if (env.JWT_SECRET) {
    const length = env.JWT_SECRET.trim().length;
    if (length >= 32) ok(`JWT_SECRET (${length} chars)`);
    else bad(`JWT_SECRET is too short (${length} chars, need 32+)`);
  } else {
    bad("JWT_SECRET is missing");
  }

  if (env.MONGODB_URI) {
    ok(`MONGODB_URI (${describeEnvValue("MONGODB_URI", env.MONGODB_URI)})`);
  } else {
    bad("MONGODB_URI is missing");
  }

  if (env.AI_MODEL) {
    ok(`AI_MODEL (${env.AI_MODEL})`);
  } else {
    bad("AI_MODEL is missing");
  }

  const providers = configuredProviders(env);
  if (providers.length > 0) {
    ok(`Provider keys: ${providers.map((provider) => provider.label).join(", ")}`);
  } else {
    bad("No AI provider key is set");
  }

  if (env.PORT) ok(`Port ${env.PORT}`);
  if (env.HOST) ok(`Host ${env.HOST}`);

  console.log("");

  if (missing.length === 0) {
    console.log(
      `  ${paint(ANSI.green, "Ready.")} Run ${paint(ANSI.bold, "nimo")} to start the API and open the chat.`,
    );
    console.log("");
    return 0;
  }

  console.log(
    `  Missing: ${missing.join(", ")}. Run ${paint(ANSI.bold, "nimo setup")} to finish configuring.`,
  );
  console.log("");
  return 1;
}

/**
 * First-run configuration.
 *
 * Values are written to `~/.nimo/server.env`. In a source checkout the server's
 * own `apps/server/.env` is written as well, so running the API directly from
 * `apps/server` sees the same configuration. Existing values are shown and kept
 * unless the user replaces them.
 */
export async function runSetup(options: SetupOptions): Promise<number> {
  const path = getServerEnvPath();
  const saved = readServerEnv();
  const targets = envTargets();

  if (options.check) {
    if (Object.keys(saved).length > 0) return printCheck(saved, path);

    const repo = repoEnv();
    if (Object.keys(repo).length > 0 && isServerEnvReady(repo)) {
      console.log("");
      dim("  No personal configuration yet; this checkout uses apps/server/.env.");
      return printCheck(repo, "apps/server/.env (repository)");
    }

    return printCheck(saved, path);
  }

  const interactive =
    !options.yes && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

  // Start from the checkout's `.env` (if any) so contributors can accept the
  // existing values with Enter; the personal file always wins.
  const baseline: EnvValues = { ...repoEnv(), ...saved };

  const next: EnvValues = {
    NODE_ENV: DEFAULT_SERVER_ENV.NODE_ENV ?? "development",
    PORT: DEFAULT_SERVER_ENV.PORT ?? "5000",
    HOST: DEFAULT_SERVER_ENV.HOST ?? "127.0.0.1",
    CLIENT_URL: DEFAULT_SERVER_ENV.CLIENT_URL ?? "http://localhost:5173",
    AI_MODEL: DEFAULT_SERVER_ENV.AI_MODEL ?? "anthropic/claude-sonnet-4-5",
    ...baseline,
  };

  if (!interactive) {
    // Only accept known keys: never copy PATH, HOME, and the rest of the
    // process environment into a file that stores secrets.
    for (const key of SERVER_ENV_KEYS) {
      const value = process.env[key]?.trim();
      if (value) next[key] = value;
    }
  }

  console.log("");
  console.log(
    `${paint(ANSI.bold, "◆ Nimo setup")} ${paint(ANSI.dim, "· first-time configuration")}`,
  );
  console.log("");
  for (const target of targets) dim(`  Writing to ${target}`);
  console.log("");

  if (!interactive) {
    dim("  Non-interactive mode: using environment variables and saved values.");
    console.log("");
    return finishSetup(next, baseline, options, targets);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printExisting(baseline, targets);

    if (hasValues(baseline) && (await askKeep(rl))) {
      return finishSetup(next, baseline, options, targets);
    }

    next.MONGODB_URI = await askMongoUri(rl, next.MONGODB_URI ?? "");
    next.PORT = await askPort(rl, next.PORT ?? "5000");
    next.HOST = await askText(rl, "API host", next.HOST ?? "127.0.0.1");

    console.log("");
    console.log(paint(ANSI.bold, "  AI providers"));
    dim("  Blank keeps a saved key, “-” clears it. Input is visible while pasting.");

    for (const provider of PROVIDERS) {
      const current = next[provider.env] ?? "";
      const answer = (await rl.question(
        `  ${provider.label}${current ? ` [set ${maskSecret(current)}]` : ""}: `,
      )).trim();

      if (answer === "-") {
        delete next[provider.env];
      } else if (answer !== "") {
        next[provider.env] = answer;
      }
    }

    console.log("");
    next.AI_MODEL = await askText(
      rl,
      "Default model",
      next.AI_MODEL ?? "anthropic/claude-sonnet-4-5",
    );
  } finally {
    rl.close();
  }

  return finishSetup(next, baseline, options, targets);
}

function finishSetup(
  next: EnvValues,
  saved: EnvValues,
  options: SetupOptions,
  targets: string[],
): number {
  if (options.force || !next.JWT_SECRET || next.JWT_SECRET.trim().length < 32) {
    next.JWT_SECRET = randomBytes(48).toString("hex");
    dim(
      `  ${options.force && saved.JWT_SECRET ? "Rotated" : "Generated"} JWT_SECRET — existing sessions are signed out.`,
    );
  }

  const modelProvider = providerForModel(next.AI_MODEL ?? "");
  if (modelProvider && !next[modelProvider.env]?.trim()) {
    warn(
      `${next.AI_MODEL} needs ${modelProvider.env}; add it with “nimo setup” when you have a key.`,
    );
  }

  targetCheck(next);

  const paths = targets.map((target) => writeServerEnv(next, target));
  const port = next.PORT?.trim() || "5000";

  if (!process.env.NIMO_API_URL && !getConfig().apiUrl) {
    updateConfig({ apiUrl: `http://localhost:${port}` });
  }

  console.log("");
  console.log(paint(ANSI.bold, "  Saved"));
  for (const path of paths) console.log(`  ${paint(ANSI.dim, path)}`);
  console.log("");
  console.log(
    `  ${paint(ANSI.dim, "MongoDB")}   ${describeMongo(next.MONGODB_URI)}`,
  );
  console.log(`  ${paint(ANSI.dim, "Model")}     ${next.AI_MODEL}`);
  console.log(
    `  ${paint(ANSI.dim, "Providers")} ${
      configuredProviders(next)
        .map((provider) => provider.label)
        .join(", ") || "(none)"
    }`,
  );
  console.log(`  ${paint(ANSI.dim, "API")}       http://localhost:${port}`);
  console.log("");

  if (saved.JWT_SECRET && saved.JWT_SECRET !== next.JWT_SECRET) {
    dim("  JWT_SECRET changed: users will need to sign in again.");
  }

  if (!isServerEnvReady(next)) {
    console.log(
      `  ${paint(ANSI.yellow, "Incomplete.")} Run ${paint(ANSI.bold, "nimo setup")} again to fill the missing values.`,
    );
    console.log("");
    return 1;
  }

  console.log(
    `  ${paint(ANSI.green, "Done.")} Run ${paint(ANSI.bold, "nimo")} to start the API and open the chat.`,
  );
  console.log(
    `  ${paint(ANSI.dim, "Tip: `nimo doctor` checks the install at any time.")}`,
  );
  console.log("");
  return 0;
}

function targetCheck(env: EnvValues): void {
  if (!env.MONGODB_URI?.trim()) {
    bad("MONGODB_URI is required before the API can boot.");
  }

  if (configuredProviders(env).length === 0) {
    bad("At least one AI provider key is required to talk to a model.");
  }
}

/** The saved endpoint, shown in full so it can be compared with a new one. */
function describeMongo(uri: string | undefined): string {
  if (!uri?.trim()) return "(missing)";
  return uri.trim();
}

async function askText(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current: string,
): Promise<string> {
  const suffix = current ? ` [${current}]` : "";
  const answer = (await rl.question(`  ${label}${suffix}: `)).trim();
  return answer === "" ? current : answer;
}

async function askPort(
  rl: ReturnType<typeof createInterface>,
  current: string,
): Promise<string> {
  for (;;) {
    const value = await askText(rl, "API port", current);

    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536) return String(port);

    bad(`“${value}” is not a valid port.`);
  }
}

async function askMongoUri(
  rl: ReturnType<typeof createInterface>,
  current: string,
): Promise<string> {
  dim("  Use MongoDB Atlas (mongodb+srv://…) or a local mongod.");
  dim("  https://www.mongodb.com/products/platform/atlas-database");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const hint = current ? ` [${describeMongo(current)}]` : "";
    const value = (await rl.question(`  MongoDB URI${hint}: `)).trim();

    if (!value) {
      if (current) return current;
      warn("MongoDB URI is required; you can add it later with “nimo setup”.");
      return "";
    }

    if (/^mongodb(\+srv)?:\/\//.test(value)) return value;

    bad("The URI must start with mongodb:// or mongodb+srv://.");
  }

  return current;
}
