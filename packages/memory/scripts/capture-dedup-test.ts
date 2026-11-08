/**
 * Capture dedup regression test — the experience-level UNIQUE(content_hash) bug.
 * Sending the same content twice in separate turns must NOT throw.
 * Memory-level dedupe (consolidate) is a separate path and is tested elsewhere.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-capture-"));
process.env.PAME_DATA_DIR = tmpDir;

let passed = 0, failed = 0;
const pass = (n: string, d = "") => { passed++; console.log(`PASS ${n}${d ? "  " + d : ""}`); };
const fail = (n: string, d = "") => { failed++; console.log(`FAIL ${n}${d ? "  " + d : ""}`); };
const check = (c: boolean, n: string, d = "") => { c ? pass(n, d) : fail(n, d); };

const { memoryService } = await import("../src/service.js");
const { capture } = await import("../src/ingestion/capture.js");
const { getDb } = await import("../src/storage/db.js");

const OWNER = "capture-owner";
console.log("\n🔧 Capture Dedup Regression Test\n");

// Test 1: same content twice via capture (the bug that crashed agent-loop)
console.log("--- [CAPTURE] Same content twice ---");
const e1 = capture({ ownerId: OWNER, content: "What database does Nimo use?", type: "message" });
check(e1.id.length > 0, "[CAPTURE] first capture succeeds", e1.id.slice(0, 8));
try {
  const e2 = capture({ ownerId: OWNER, content: "What database does Nimo use?", type: "message" });
  check(e2.id !== e1.id, "[CAPTURE] second identical capture gets a new id (no crash)", e2.id.slice(0, 8));
} catch (err: any) {
  fail("[CAPTURE] second identical capture should NOT throw", err.message);
}

// Test 2: same content 3 times — agent-loop does prompt + "Did: ..." + response
console.log("\n--- [CAPTURE] Same content 3 times (agent-loop pattern) ---");
let allOk = true;
for (let i = 0; i < 3; i++) {
  try {
    capture({ ownerId: OWNER, content: "Did: I answered the question about Nimo", type: "message" });
  } catch { allOk = false; }
}
check(allOk, "[CAPTURE] 3 identical 'Did:' captures all succeed");

// Test 3: remember() with identical content (ingest path)
console.log("\n--- [CAPTURE] remember() twice with same content ---");
try {
  const r1 = memoryService.remember({ ownerId: OWNER, content: "We prefer dark mode for coding", type: "message" });
  check(r1.memoryIds.length > 0, "[CAPTURE] first remember creates memory");
  const r2 = memoryService.remember({ ownerId: OWNER, content: "We prefer dark mode for coding", type: "message" });
  check(true, "[CAPTURE] second remember does not crash", `merged=${r2.merged} created=${r2.created}`);
} catch (err: any) {
  fail("[CAPTURE] remember() twice should not throw", err.message);
}

// Test 4: DB rows — experiences should be 5 (2+3), memories should deduplicate
console.log("\n--- [CAPTURE] DB row counts ---");
const expCount = (getDb().prepare("SELECT COUNT(*) as n FROM experiences WHERE owner_id = ?").get(OWNER) as any).n;
const memCount = (getDb().prepare("SELECT COUNT(*) as n FROM memories WHERE owner_id = ? AND status = 'active'").get(OWNER) as any).n;
check(expCount === 7, "[CAPTURE] 7 experience rows (2+3+2)", `exp=${expCount}`);
check(memCount <= 3, "[CAPTURE] memories deduplicated at memory layer (<=3)", `mem=${memCount}`);

console.log("\n============================================================");
console.log(`CAPTURE DEDUP TEST: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("============================================================");
try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(failed > 0 ? 1 : 0);
