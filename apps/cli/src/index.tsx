#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { App } from "./app/App";
import {
  prepareTui,
  printHelp,
  printVersion,
  resolveInvocation,
  runHeadless,
} from "./features/launcher";

const invocation = resolveInvocation(process.argv.slice(2));

if (invocation.kind === "help") {
  printHelp();
  process.exit(0);
}

if (invocation.kind === "version") {
  printVersion();
  process.exit(0);
}

if (invocation.kind === "error") {
  console.error(`nimo: ${invocation.message}\n`);
  printHelp();
  process.exit(1);
}

if (invocation.plan.kind === "headless") {
  process.exit(await runHeadless(invocation.plan));
}

// Both `nimo` and `nimo cli` start the API first, so the chat is usable.
if (!(await prepareTui(invocation.plan))) {
  process.exit(1);
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});

createRoot(renderer).render(<App />);
