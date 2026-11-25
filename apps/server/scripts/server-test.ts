/**
 * Smoke tests for apps/server — run with `tsx scripts/server-test.ts`.
 * No test framework required; failures throw and exit non-zero.
 */

import { createUserSchema, loginSchema } from "../src/modules/user/users.schema.js";
import { chatSchema } from "../src/modules/agent/agents.schema.js";
import { createApp } from "../src/app.js";
import { listUsers, getUserById, updateUser, deleteUser } from "../src/modules/user/users.controller.js";

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
// API Authentication & Stubs Tests (with timeout and dynamic import for env validation)
// ---------------------------------------------------------------------------
async function runApiTests() {
  console.log("API Authentication & Stubs");

  // Set required env vars for env validation before importing app/db
  process.env.JWT_SECRET = "super-secret-key-that-is-at-least-thirty-two-chars-long";
  process.env.AI_MODEL = "gemini-2.5-flash";

  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;

  try {
    const fetchWithTimeout = async (url: string, options: RequestInit = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
      } finally {
        clearTimeout(timeout);
      }
    };

    // Test GET /users/ without auth -> 401
    const resGetUsers = await fetchWithTimeout(`${baseUrl}/users/`);
    assert("GET /users/ without auth returns 401", resGetUsers.status === 401);

    // Test GET /users/123 without auth -> 401
    const resGetUser = await fetchWithTimeout(`${baseUrl}/users/123`);
    assert("GET /users/:id without auth returns 401", resGetUser.status === 401);

    // Test PATCH /users/123 without auth -> 401
    const resPatchUser = await fetchWithTimeout(`${baseUrl}/users/123`, { method: "PATCH" });
    assert("PATCH /users/:id without auth returns 401", resPatchUser.status === 401);

    // Test DELETE /users/123 without auth -> 401
    const resDeleteUser = await fetchWithTimeout(`${baseUrl}/users/123`, { method: "DELETE" });
    assert("DELETE /users/:id without auth returns 401", resDeleteUser.status === 401);

    // Test GET /users/ with auth -> 501 (testing controller directly since db is absent)
    const mockRes = () => {
      let statusCode = 200;
      let jsonBody: any = null;
      return {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonBody = body;
          return this;
        },
        getStatus: () => statusCode,
        getJson: () => jsonBody,
      };
    };

    const reqStub = {} as any;

    const res1 = mockRes();
    await listUsers(reqStub, res1 as any);
    assert("listUsers controller returns 501", res1.getStatus() === 501);
    assert("listUsers error message is clear", res1.getJson().error === "Listing users is not available in this build");

    const res2 = mockRes();
    await getUserById(reqStub, res2 as any);
    assert("getUserById controller returns 501", res2.getStatus() === 501);
    assert("getUserById error message is clear", res2.getJson().error === "Getting user details is not available in this build");

    const res3 = mockRes();
    await updateUser(reqStub, res3 as any);
    assert("updateUser controller returns 501", res3.getStatus() === 501);
    assert("updateUser error message is clear", res3.getJson().error === "Updating users is not available in this build");

    const res4 = mockRes();
    await deleteUser(reqStub, res4 as any);
    assert("deleteUser controller returns 501", res4.getStatus() === 501);
    assert("deleteUser error message is clear", res4.getJson().error === "Deleting users is not available in this build");

  } catch (error) {
    console.error("API test error:", error);
    assert("API tests executed without throwing", false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await runApiTests();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
