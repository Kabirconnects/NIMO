/**
 * Smoke tests for apps/server — run with `tsx scripts/server-test.ts`.
 * No test framework required; failures throw and exit non-zero.
 */

import { createUserSchema, loginSchema } from "../src/modules/user/users.schema.js";
import { chatSchema } from "../src/modules/agent/agents.schema.js";

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
// createUserSchema
// ---------------------------------------------------------------------------
console.log("createUserSchema");

{
  const r = createUserSchema.safeParse({
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "secretsecret",
  });
  assert("valid user parses successfully", r.success);
}

{
  const r = createUserSchema.safeParse({
    name: "",
    email: "not-an-email",
    password: "short",
  });
  assert("invalid user is rejected", !r.success);
}

{
  const r = createUserSchema.safeParse({
    name: "Ada",
    email: "ADA@EXAMPLE.COM",
    password: "secretsecret",
    role: "admin",
  });
  assert("email is lowercased", r.success && r.data.email === "ada@example.com");
}

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------
console.log("loginSchema");

{
  const r = loginSchema.safeParse({ email: "ada@example.com", password: "x" });
  assert("login allows single-char password", r.success);
}

{
  const r = loginSchema.safeParse({ email: "bad", password: "x" });
  assert("login rejects invalid email", !r.success);
}

// ---------------------------------------------------------------------------
// chatSchema
// ---------------------------------------------------------------------------
console.log("chatSchema");

{
  const r = chatSchema.safeParse({ prompt: "hello" });
  assert("chat with only prompt is valid", r.success);
}

{
  const r = chatSchema.safeParse({ prompt: "" });
  assert("chat with empty prompt is rejected", !r.success);
}

{
  const r = chatSchema.safeParse({ prompt: "hi", mode: "Chat" });
  assert("chat with mode Chat is valid", r.success);
}

{
  const r = chatSchema.safeParse({ prompt: "hi", mode: "Invalid" });
  assert("chat with unknown mode is rejected", !r.success);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
