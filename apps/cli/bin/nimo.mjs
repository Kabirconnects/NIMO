#!/usr/bin/env node
/* global process, console */
/**
 * Launcher shim for `nimo`.
 *
 * npm, pnpm, and Bun all create platform-specific shims that run the bin file
 * with Node. This project's real entry point is TypeScript + JSX, which Node
 * cannot execute, so this tiny wrapper forwards argv to Bun and mirrors its
 * exit code. Keeping it dependency-free means the global link works on
 * Windows, macOS, and Linux without extra setup.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "index.tsx");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const bun = process.env.NIMO_BUN || "bun";

const child = spawn(bun, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      "nimo: Bun is required but was not found on PATH. Install it from https://bun.sh, or set NIMO_BUN to its path.",
    );
  } else {
    console.error(`nimo: could not start Bun (${error.message})`);
  }

  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
