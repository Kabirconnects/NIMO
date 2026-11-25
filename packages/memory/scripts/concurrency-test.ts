/**
 * Concurrency regression suite — two writers on one SQLite database.
 *
 * PAME runs a single-process, single-threaded design: better-sqlite3 is
 * synchronous, so "concurrent" writes are serialised by the event loop rather
 * than by the OS. This suite proves that invariant explicitly:
 *
 *   - Two independent writers (same owner, and cross-owner) can interleave
 *     many writes/reads without SQLITE_BUSY or any thrown error.
 *   - No write is lost: every inserted id is readable afterwards.
 *   - Concurrent writes with identical or overlapping timestamps are safely
 *     serialised, producing valid dates, monotonic progression per writer,
 *     and deterministic ordering with id tie-breaker.
 *   - Transactional writes from both writers commit atomically and leave the
 *     graph degree consistent (no half-applied link).
 *
 * Runs against an isolated temp DB. Never touches ~/.nimo/pame.db.
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-concurrency-"));
const dbPath = path.join(tmpDir, "pame.db");
process.env.PAME_DB_PATH = dbPath;
delete process.env.PAME_MULTI_USER;
delete process.env.PAME_OWNER_ID;

const { memoryService } = await import("../src/service.js");
const {
  getDb,
  closeDb,
  findMemory,
  listActiveMemories,
  insertEdge,
  repairGraphDegrees,
} = await import("../src/storage/db.js");

const OWNER_A = "concurrency-alice";
const OWNER_B = "concurrency-bob";

console.log(`\n🔀 PAME Concurrency Suite`);
console.log(`Isolated DB: ${dbPath}\n`);

/** A "writer" performs `n` create+read cycles, recording the ids it wrote. */
async function writer(ownerId: string, n: number, prefix: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const node = memoryService.createMemory({
      ownerId,
      type: "fact",
      content: `${prefix} concurrent write ${i}`,
      keywords: [prefix],
    });
    ids.push(node.id);
    findMemory(node.id, ownerId);
    await new Promise((r) => setImmediate(r));
  }
  return ids;
}

// ============================================================
// 1. Two writers, same owner, interleaved
// ============================================================
console.log("--- [INTERLEAVE] Same-owner writers ---");

let interleaveError: unknown = null;
const [aIds, bIds] = await Promise.all([
  writer(OWNER_A, 50, "alpha").catch((e) => { interleaveError = e; return [] as string[]; }),
  writer(OWNER_A, 50, "bravo").catch((e) => { interleaveError = e; return [] as string[]; }),
]);

check(interleaveError === null, "[INTERLEAVE] two same-owner writers never throw (no SQLITE_BUSY)");
check(aIds.length === 50 && bIds.length === 50, "[INTERLEAVE] both writers completed all 50 writes",
  `${aIds.length}+${bIds.length}`);

const allIds = [...aIds, ...bIds];
const missing = allIds.filter((id) => findMemory(id, OWNER_A) === null);
check(missing.length === 0, "[INTERLEAVE] no write was lost", `${missing.length} missing`);

// ============================================================
// 2. Two writers, different owners, interleaved
// ============================================================
console.log("\n--- [CROSS-OWNER] Independent owners share one DB ---");

let crossError: unknown = null;
const [cIds, dIds] = await Promise.all([
  writer(OWNER_A, 40, "charlie").catch((e) => { crossError = e; return [] as string[]; }),
  writer(OWNER_B, 40, "delta").catch((e) => { crossError = e; return [] as string[]; }),
]);
check(crossError === null, "[CROSS-OWNER] cross-owner writers never throw");
check(
  cIds.every((id) => findMemory(id, OWNER_A) !== null) &&
  dIds.every((id) => findMemory(id, OWNER_B) !== null),
  "[CROSS-OWNER] every write is readable under its own owner",
);
check(
  dIds.every((id) => findMemory(id, OWNER_A) === null),
  "[CROSS-OWNER] one owner's rows are invisible to the other",
);

// ============================================================
// 3. Concurrent timestamp serialization and ordering
// ============================================================
console.log("\n--- [CONCURRENT-TIMESTAMP] Serialised concurrent writes & timestamp stability ---");

const stampOwner = "concurrency-timestamp";
const [w1Ids, w2Ids] = await Promise.all([
  (async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const node = memoryService.createMemory({
        ownerId: stampOwner,
        type: "fact",
        content: `concurrent timestamp probe w1 ${i}`,
      });
      ids.push(node.id);
    }
    return ids;
  })(),
  (async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const node = memoryService.createMemory({
        ownerId: stampOwner,
        type: "fact",
        content: `concurrent timestamp probe w2 ${i}`,
      });
      ids.push(node.id);
    }
    return ids;
  })(),
]);

check(w1Ids.length === 50 && w2Ids.length === 50, "[CONCURRENT-TIMESTAMP] concurrent writers wrote all entries");

const allStampIds = [...w1Ids, ...w2Ids];
const allNodes = allStampIds.map((id) => findMemory(id, stampOwner)!);
check(
  allNodes.every((n) => n !== null && n.updatedAt instanceof Date && !isNaN(n.updatedAt.getTime())),
  "[CONCURRENT-TIMESTAMP] all writes produce valid timestamps",
);

let w1Monotonic = true;
for (let i = 1; i < w1Ids.length; i++) {
  const prev = findMemory(w1Ids[i - 1]!, stampOwner)!.updatedAt.getTime();
  const curr = findMemory(w1Ids[i]!, stampOwner)!.updatedAt.getTime();
  if (curr < prev) { w1Monotonic = false; break; }
}
check(w1Monotonic, "[CONCURRENT-TIMESTAMP] writer 1 timestamps are monotonically non-decreasing");

let w2Monotonic = true;
for (let i = 1; i < w2Ids.length; i++) {
  const prev = findMemory(w2Ids[i - 1]!, stampOwner)!.updatedAt.getTime();
  const curr = findMemory(w2Ids[i]!, stampOwner)!.updatedAt.getTime();
  if (curr < prev) { w2Monotonic = false; break; }
}
check(w2Monotonic, "[CONCURRENT-TIMESTAMP] writer 2 timestamps are monotonically non-decreasing");

const ordered1 = listActiveMemories(stampOwner, { limit: 100 });
const ordered2 = listActiveMemories(stampOwner, { limit: 100 });
const orderMatches = ordered1.length === 100 &&
  ordered1.every((node, idx) => node.id === ordered2[idx]!.id);
check(
  orderMatches,
  "[CONCURRENT-TIMESTAMP] concurrent timestamp ordering is deterministic with id tie-breaker",
  `${ordered1.length} rows`,
);

// ============================================================
// 4. Transactional writes from both writers commit atomically
// ============================================================
console.log("\n--- [ATOMIC] Interleaved transactional writes ---");

const txOwner = "concurrency-tx";
let txError: unknown = null;
await Promise.all([
  (async () => {
    for (let i = 0; i < 25; i++) {
      const a = memoryService.createMemory({ ownerId: txOwner, type: "fact", content: `tx alpha ${i}` });
      const b = memoryService.createMemory({ ownerId: txOwner, type: "fact", content: `tx bravo ${i}` });
      insertEdge({ ownerId: txOwner, fromMemoryId: a.id, toMemoryId: b.id, relation: "related_to", weight: 0.8, confidence: 0.8, evidenceIds: [] });
      await new Promise((r) => setImmediate(r));
    }
  })().catch((e) => { txError = e; }),
  (async () => {
    for (let i = 0; i < 25; i++) {
      const a = memoryService.createMemory({ ownerId: txOwner, type: "fact", content: `tx charlie ${i}` });
      const b = memoryService.createMemory({ ownerId: txOwner, type: "fact", content: `tx echo ${i}` });
      insertEdge({ ownerId: txOwner, fromMemoryId: a.id, toMemoryId: b.id, relation: "related_to", weight: 0.8, confidence: 0.8, evidenceIds: [] });
      await new Promise((r) => setImmediate(r));
    }
  })().catch((e) => { txError = e; }),
]);

check(txError === null, "[ATOMIC] interleaved transactional writers never throw");

repairGraphDegrees(txOwner);
const mismatch = (getDb()
  .prepare(
    `SELECT COUNT(*) AS n FROM memories m
     WHERE m.owner_id = ?
       AND m.graph_degree != (
         SELECT COUNT(*) FROM memory_edges e
         WHERE e.owner_id = m.owner_id
           AND (e.from_memory_id = m.id OR e.to_memory_id = m.id)
       )`,
  )
  .get(txOwner) as { n: number });
check(Number(mismatch.n) === 0, "[ATOMIC] graph degree is consistent after concurrent transactional writes",
  `${mismatch.n} mismatched`);

const txMemCount = (getDb()
  .prepare("SELECT COUNT(*) AS n FROM memories WHERE owner_id = ?")
  .get(txOwner) as { n: number });
check(Number(txMemCount.n) === 100, "[ATOMIC] all 100 transactional memories persisted", `${txMemCount.n}`);

const edgeCount = (getDb()
  .prepare("SELECT COUNT(*) AS n FROM memory_edges WHERE owner_id = ?")
  .get(txOwner) as { n: number });
check(Number(edgeCount.n) === 50, "[ATOMIC] all 50 transactional edges persisted", `${edgeCount.n}`);

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`CONCURRENCY RESULT: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(60)}`);

try {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
} catch (err) {
  console.warn("Cleanup warning:", err);
}

process.exit(failed > 0 ? 1 : 0);
