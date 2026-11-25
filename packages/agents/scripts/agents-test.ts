/**
 * Smoke tests for packages/agents — run with `tsx scripts/agents-test.ts`.
 * No test framework required; failures throw and exit non-zero.
 */

import {
  isModelId,
  resolveModelId,
  MODEL_IDS,
  EFFORT_LEVELS,
  DEFAULT_MODEL_ID,
  PROVIDER_ORDER,
  getModel,
  getModelOptions,
} from "../src/models/registry.js";
import { startBackgroundProcess, stopBackgroundProcess, listBackgroundProcesses } from "../src/tools/shared/process.js";
import path from "node:path";
import fs from "node:fs";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// isModelId
// ---------------------------------------------------------------------------
console.log("isModelId");

assert("known model id is valid", isModelId("anthropic/claude-sonnet-5-5"));
assert("unknown model id is invalid", !isModelId("not-a-real/model"));
assert("empty string is invalid", !isModelId(""));

// ---------------------------------------------------------------------------
// resolveModelId
// ---------------------------------------------------------------------------
console.log("resolveModelId");

assert(
  "known id resolves to itself",
  resolveModelId("anthropic/claude-sonnet-5-5") === "anthropic/claude-sonnet-5-5",
);
assert("unknown id falls back to default", resolveModelId("bad/id") === DEFAULT_MODEL_ID);
assert("null falls back to default", resolveModelId(null) === DEFAULT_MODEL_ID);
assert("undefined falls back to default", resolveModelId(undefined) === DEFAULT_MODEL_ID);

// ---------------------------------------------------------------------------
// MODEL_IDS
// ---------------------------------------------------------------------------
console.log("MODEL_IDS");

assert("MODEL_IDS is non-empty", MODEL_IDS.length > 0);
assert("every entry in MODEL_IDS passes isModelId", MODEL_IDS.every(isModelId));
assert("DEFAULT_MODEL_ID is in MODEL_IDS", MODEL_IDS.includes(DEFAULT_MODEL_ID));

// ---------------------------------------------------------------------------
// EFFORT_LEVELS
// ---------------------------------------------------------------------------
console.log("EFFORT_LEVELS");

assert("EFFORT_LEVELS contains 'none'", EFFORT_LEVELS.includes("none"));
assert("EFFORT_LEVELS contains 'low'", EFFORT_LEVELS.includes("low"));
assert("EFFORT_LEVELS contains 'medium'", EFFORT_LEVELS.includes("medium"));
assert("EFFORT_LEVELS contains 'high'", EFFORT_LEVELS.includes("high"));

// ---------------------------------------------------------------------------
// getModel
// ---------------------------------------------------------------------------
console.log("getModel");

{
  const config = getModel("anthropic/claude-sonnet-5-5");
  assert("getModel returns correct provider", config.provider === "anthropic");
  assert("getModel returns capabilities array", Array.isArray(config.capabilities));
}

try {
  getModel("nonexistent/model");
  assert("getModel throws for unknown id", false);
} catch {
  assert("getModel throws for unknown id", true);
}

// ---------------------------------------------------------------------------
// getModelOptions — serialisable, no model property
// ---------------------------------------------------------------------------
console.log("getModelOptions");

{
  const options = getModelOptions();
  assert("getModelOptions returns non-empty array", options.length > 0);
  assert(
    "every option has required string fields",
    options.every(
      (o) =>
        typeof o.id === "string" &&
        typeof o.name === "string" &&
        typeof o.provider === "string",
    ),
  );
  assert(
    "PROVIDER_ORDER covers every returned provider",
    options.every((o) => (PROVIDER_ORDER as string[]).includes(o.provider)),
  );
}

// ---------------------------------------------------------------------------
// process command collision test (`["run","a b"]` vs `["run","a","b"]`)
// ---------------------------------------------------------------------------
console.log("process argv command reuse collision check");

{
  const cwd = process.cwd();
  // We can use node with a simple script or just test startBackgroundProcess with allowlisted command 'node'
  // Let's test two different argv arrays that serialize to the same commandLine "node -e 'setTimeout(() => {}, 10000)'"
  // vs separate arguments or similar.
  // Wait, let's use a quick node one-liner process: node -e "setInterval(() => {}, 1000)"
  // argv1: ["node", "-e", "setInterval(() => {}, 1000)"]
  // argv2: ["node", "-e", "setInterval(() => {}, 1000)"] (same)
  // Let's test distinct argv that might share commandLine if joined by space:
  // e.g. argvA = ["node", "script.js arg1"] -> commandLine is "node script.js arg1"
  // argvB = ["node", "script.js", "arg1"] -> commandLine is also "node script.js arg1"
  const argvA = ["node", "-e", "console.log('A'); setTimeout(() => {}, 5000)"];
  const argvB = ["node", "-e", "console.log('B'); setTimeout(() => {}, 5000)", "extra"]; // or different

  // Even better: let's verify that startBackgroundProcess with `argv: ["node", "a b"]` and `argv: ["node", "a", "b"]` do NOT reuse each other despite having identical commandLine.
  // Let's create dummy script files or use -e.
  // With -e:
  // argv1 = ["node", "-e", "setInterval(() => {}, 5000)"] -> commandLine = "node -e setInterval(() => {}, 5000)"
  // Wait, if argv1 has spaces: ["node", "-e", "foo bar"] vs ["node", "-e", "foo", "bar"] -> wait, node -e expects 1 arg after -e. But node rejects or runs them.
  // Let's test with any allowlisted command, e.g. `node`:
  const res1 = startBackgroundProcess({
    argv: ["node", "-e", "console.log(1); setTimeout(() => {}, 5000)"],
    cwd,
  });
  assert("first process started successfully", res1.info.status === "running" && !res1.reused);

  // Now try starting with the same argv -> should be reused
  const res2 = startBackgroundProcess({
    argv: ["node", "-e", "console.log(1); setTimeout(() => {}, 5000)"],
    cwd,
  });
  assert("identical argv is reused", res2.reused);
  assert("reused id matches first process", res2.info.id === res1.info.id);

  // Test exact collision scenario specified in requirement:
  // `["run", "a b"]` vs `["run", "a", "b"]` (using node or any allowlisted bin, e.g. node)
  // argvA: ["node", "-e", "console.log(1); setTimeout(() => {}, 5000)"] (where element contains space)
  // argvB: ["node", "-e", "console.log(1);", "setTimeout(() => {}, 5000)"] (where space is split into separate argv elements)
  // Wait, let's test:
  // runA = ["node", "run", "a b"] -> joined by space: "node run a b"
  // runB = ["node", "run", "a", "b"] -> joined by space: "node run a b"
  const resA = startBackgroundProcess({
    argv: ["node", "-e", "console.log('A'); setTimeout(() => {}, 5000)"],
    cwd,
  });
  const resB = startBackgroundProcess({
    argv: ["node", "-e", "console.log('A');", "setTimeout(() => {}, 5000)"],
    cwd,
  });
  assert("different argv arrays producing same commandLine do NOT collide/reuse", !resB.reused);
  assert("different argv arrays get distinct process IDs", resA.info.id !== resB.info.id);

  try {
    stopBackgroundProcess(resA.info.id);
  } catch {}
  try {
    stopBackgroundProcess(resB.info.id);
  } catch {}
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
