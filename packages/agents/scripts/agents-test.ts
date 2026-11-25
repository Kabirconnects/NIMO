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
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
