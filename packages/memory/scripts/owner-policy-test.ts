/**
 * Per-owner policy enforcement test.
 *
 * Verifies that:
 * 1. A custom policy can be written for a specific owner (e.g. allowAutomaticCapture = false, or custom excludedCategories).
 * 2. Writes for that owner are correctly refused according to their policy.
 * 3. Another owner without a custom policy is unaffected and uses default policy behavior.
 * 4. containsExcludedContent respects excluded_categories adding to built-in detection without weakening built-in secret detection.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const pass = (name: string, detail = "") => console.log(`PASS ${name}${detail ? "  " + detail : ""}`);
const fail = (name: string, detail = "") => console.log(`FAIL ${name}${detail ? "  " + detail : ""}`);

let passed = 0, failed = 0;
function check(cond: boolean, name: string, detail = "") {
  if (cond) { passed++; pass(name, detail); } else { failed++; fail(name, detail); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-owner-policy-"));
const dbPath = path.join(tmpDir, "pame.db");
process.env.PAME_DB_PATH = dbPath;

const { memoryService, MemoryPolicyError } = await import("../src/service.js");
const { setPolicy, getPolicy } = await import("../src/storage/db.js");
const { containsExcludedContent, DEFAULT_POLICY } = await import("../src/governance/policy.js");

console.log(`\n🔒 Owner Policy Enforcement Test`);
console.log(`Isolated DB: ${dbPath}\n`);

const OWNER_RESTRICTED = "owner-restricted";
const OWNER_NORMAL = "owner-normal";

// 1. Set policy for restricted owner: allowAutomaticCapture = false, custom excluded category "classified"
setPolicy(OWNER_RESTRICTED, {
  allowAutomaticCapture: false,
  excludedCategories: [...DEFAULT_POLICY.excludedCategories, "classified"],
});

// 2. Verify policy is retrieved correctly
const pRestricted = getPolicy(OWNER_RESTRICTED);
check(pRestricted.allowAutomaticCapture === false, "[POLICY] restricted owner has allowAutomaticCapture = false");
check(pRestricted.excludedCategories.includes("classified"), "[POLICY] restricted owner includes custom excluded category");

const pNormal = getPolicy(OWNER_NORMAL);
check(pNormal.allowAutomaticCapture === true, "[POLICY] normal owner defaults to allowAutomaticCapture = true");

// 3. Test containsExcludedContent with policy
check(containsExcludedContent("This is normal text", pRestricted) === false, "[POLICY] normal text passes restricted policy");
check(containsExcludedContent("This is classified information", pRestricted) === true, "[POLICY] restricted category is blocked by restricted policy");
check(containsExcludedContent("This is classified information", pNormal) === false, "[POLICY] restricted category is allowed by normal policy (unless built-in secret)");
check(containsExcludedContent("sk-proj-1234567890abcdefghijklmnopqrstuv", pNormal) === true, "[POLICY] built-in secret is blocked even for normal policy");

// 4. Test ingestion / memory creation behavior for restricted owner vs normal owner
// Restricted owner has allowAutomaticCapture = false, so remember() should not create memories from candidates,
// and explicit createMemory should respect excludedCategories if we test custom category via evaluateWrite / service.
let rememberResult = memoryService.remember({
  ownerId: OWNER_RESTRICTED,
  content: "User stated: I like apples.",
  type: "message",
});
check(rememberResult.created === 0, "[POLICY] restricted owner with allowAutomaticCapture=false creates 0 memories on remember()");

let normalRememberResult = memoryService.remember({
  ownerId: OWNER_NORMAL,
  content: "User stated: I like apples.",
  type: "message",
});
check(normalRememberResult.created > 0, "[POLICY] normal owner with allowAutomaticCapture=true creates memories on remember()");

// Test custom excluded category via createMemory or teach
let caughtRestricted = false;
try {
  memoryService.createMemory({
    ownerId: OWNER_RESTRICTED,
    type: "fact",
    content: "Project classified details here",
  });
} catch (e) {
  if (e instanceof MemoryPolicyError) {
    caughtRestricted = true;
  }
}
check(caughtRestricted, "[POLICY] restricted owner write containing 'classified' is refused");

let caughtNormal = false;
try {
  memoryService.createMemory({
    ownerId: OWNER_NORMAL,
    type: "fact",
    content: "Project classified details here",
  });
} catch (e) {
  if (e instanceof MemoryPolicyError) {
    caughtNormal = true;
  }
}
check(!caughtNormal, "[POLICY] normal owner write containing 'classified' succeeds");

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
