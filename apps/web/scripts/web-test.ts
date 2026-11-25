// apps/web/scripts/web-test.ts
/**
 * Smoke tests for apps/web — run with `tsx scripts/web-test.ts`.
 * No test framework needed; failures throw and exit non-zero.
 */

import { initials } from "../src/lib/initials.js";

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

console.log("initials");
assert("full name gives two uppercase letters", initials("Ada Lovelace") === "AL");
assert("single word gives one uppercase letter", initials("nimo") === "N");
assert("empty string returns '?'", initials("") === "?");
assert("whitespace-only returns '?'", initials("   ") === "?");
assert("extra words are ignored (only first two)", initials("Ann Bob Cee") === "AB");
assert("already uppercase stays uppercase", initials("ADA LOVELACE") === "AL");
assert("leading/trailing whitespace is trimmed", initials("  Jane  Doe  ") === "JD");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
