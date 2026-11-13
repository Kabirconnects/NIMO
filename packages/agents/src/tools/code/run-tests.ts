import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, clip } from "../shared/workspace.js";
import { assertCanRunShell } from "../shared/permissions.js";
import { runProcess } from "../shared/process.js";

import fsp from "node:fs/promises";
import path from "node:path";

const COMMANDS = [
  "auto",
  "bun test",
  "bun run test",
  "bunx tsc --noEmit",
  "npm test",
  "pnpm test",
  "yarn test",
  "vitest run",
  "jest",
  "npx tsc --noEmit",
  "pytest",
  "go test ./...",
  "cargo test",
] as const;

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

async function detectPackageManager(dir: string): Promise<PackageManager> {
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (
    (await exists(path.join(dir, "bun.lock"))) ||
    (await exists(path.join(dir, "bun.lockb")))
  ) {
    return "bun";
  }
  if (await exists(path.join(dir, "package-lock.json"))) return "npm";

  // No lockfile: trust the packageManager field before guessing.
  try {
    const pkg = JSON.parse(
      await fsp.readFile(path.join(dir, "package.json"), "utf-8"),
    ) as { packageManager?: string };
    const name = pkg.packageManager?.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") {
      return name;
    }
  } catch {
    /* no/invalid package.json */
  }
  return "npm";
}

function typecheckCommand(pm: PackageManager): string {
  return pm === "bun" ? "bunx tsc --noEmit" : "npx tsc --noEmit";
}

/** Detect the project's real test/typecheck command instead of guessing. */
async function detectCommand(
  dir: string,
): Promise<{ command: string; reason: string } | null> {
  const pkgPath = path.join(dir, "package.json");
  if (await exists(pkgPath)) {
    const pm = await detectPackageManager(dir);

    try {
      const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.test && !/no test specified/i.test(pkg.scripts.test)) {
        return {
          command: pm === "bun" ? "bun run test" : `${pm} test`,
          reason: `package.json has a "test" script (${pm})`,
        };
      }
      if (pkg.scripts?.typecheck) {
        return {
          command: pm === "bun" ? "bun run typecheck" : `${pm} run typecheck`,
          reason: `package.json has a "typecheck" script (${pm})`,
        };
      }
    } catch {
      /* malformed package.json - fall through */
    }

    if (await exists(path.join(dir, "tsconfig.json"))) {
      return {
        command: typecheckCommand(pm),
        reason: `tsconfig.json found; typecheck with ${pm}`,
      };
    }
  }

  if (await exists(path.join(dir, "tsconfig.json"))) {
    return {
      command: "npx tsc --noEmit",
      reason: "tsconfig.json found (no package.json); typecheck instead of tests",
    };
  }

  if (
    (await exists(path.join(dir, "pyproject.toml"))) ||
    (await exists(path.join(dir, "pytest.ini"))) ||
    (await exists(path.join(dir, "tox.ini"))) ||
    (await exists(path.join(dir, "setup.py")))
  ) {
    return { command: "pytest", reason: "Python project detected (pytest)" };
  }

  if (await exists(path.join(dir, "Cargo.toml"))) {
    return { command: "cargo test", reason: "Cargo.toml found (cargo test)" };
  }

  if (await exists(path.join(dir, "go.mod"))) {
    return { command: "go test ./...", reason: "go.mod found (go test)" };
  }

  return null;
}

interface Counts {
  passed?: number;
  failed?: number;
}

function parseCounts(output: string): Counts {
  const counts: Counts = {};
  const pass = output.match(/(\d+)\s+(?:pass(?:ed)?|tests?\s+passed)/i);
  const fail = output.match(/(\d+)\s+(?:fail(?:ed)?|tests?\s+failed)/i);
  if (pass) counts.passed = Number(pass[1]);
  if (fail) counts.failed = Number(fail[1]);
  return counts;
}

const FAILURE_LINE =
  /(^|\s)(FAIL|✗|×|●|not ok|AssertionError|error TS\d+|Test failed|Expected:|Received:)/i;

function extractFailures(output: string, limit = 25): string[] {
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;
    if (!FAILURE_LINE.test(line)) continue;
    const clipped = line.slice(0, 300);
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    failures.push(clipped);
    if (failures.length >= limit) break;
  }
  return failures;
}

export const runTestsTool: Tool = tool({
  description:
    "Run the project's tests (or typecheck) and return a structured result: exit code, timing, " +
    "pass/fail counts when detectable, extracted failure lines, and the output tail. " +
    "command='auto' (default) detects the package manager, the package.json test/typecheck script, " +
    "tsconfig, or a Python/Go/Rust project, and fails with a clear message when nothing is configured. " +
    "Use this after every code change to verify the work instead of claiming success. " +
    "Runs through the same allowlisted, timeout-capped, env-scrubbed process sandbox as runCommand.",

  inputSchema: z.object({
    command: z.enum(COMMANDS).default("auto")
      .describe("Test command, or 'auto' to detect from the project"),
    cwd: z.string().default(".").describe("Working directory relative to the workspace"),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000)
      .describe("Hard timeout in milliseconds"),
    maxOutputBytes: z.number().int().min(1_000).max(1_000_000).default(60_000),
  }),

  execute: async ({ command, cwd, timeoutMs, maxOutputBytes }) => {
    try {
      assertCanRunShell();
      const dir = await resolveSafe(cwd);

      const detected = command === "auto" ? await detectCommand(dir) : null;
      if (command === "auto" && !detected) {
        throw new Error(
          `No test/typecheck config found in '${toRel(dir)}' (looked for package.json scripts, ` +
            "tsconfig.json, pyproject.toml/pytest.ini, Cargo.toml, go.mod). " +
            "Pass an explicit command or use runCommand with the project's real test command.",
        );
      }
      const resolved = detected?.command ?? command;

      const result = await runProcess({
        command: resolved,
        cwd: dir,
        timeoutMs,
        maxOutputBytes,
      });

      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const counts = parseCounts(combined);
      const failures = extractFailures(combined);

      return {
        success: result.ok,
        command: resolved,
        detection: detected?.reason,
        cwd: toRel(dir),
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        truncated: result.truncated,
        durationMs: result.durationMs,
        counts,
        failures,
        stdout: clip(result.stdout, 20_000),
        stderr: clip(result.stderr, 20_000),
        hint: result.ok
          ? undefined
          : failures.length > 0
            ? "Fix the extracted failures above, then re-run runTests."
            : "No familiar failure lines were found; inspect the output tail.",
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
