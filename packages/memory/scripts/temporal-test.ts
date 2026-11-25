/**
 * Temporal Memory Test — Item c-temporal-memory-03
 *
 * Verifies the invariant:
 * "Interval population is not automatic; only correction/supersession and deletion set validity."
 *
 * Checks:
 *   1. Non-automatic interval population: normal creation (createMemory, teach,
 *      remember/ingest), standard updates, and non-superseding contradictory
 *      evidence leave validFrom and validUntil undefined (null in SQLite).
 *   2. Deletion sets validity: forgetMemory sets validUntil to close validity.
 *   3. Supersession sets validity: linkMemories with "supersedes", dreamer
 *      duplicate merge, and update with status "superseded" set validUntil on
 *      the superseded memory and validFrom on the superseding memory.
 *   4. Correction sets validity: evolve with cause "user_correction" sets
 *      validUntil on the corrected memory and validFrom on the correcting evidence.
 *   5. Validity-aware retrieval: isRetrievable filters out memories outside their
 *      valid-time interval (expired validUntil, or future validFrom).
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-temporal-test-"));
const dbPath = path.join(tmpDir, "pame.db");
process.env.PAME_DB_PATH = dbPath;
delete process.env.PAME_MULTI_USER;
delete process.env.PAME_OWNER_ID;

const { memoryService } = await import("../src/service.js");
const { evolve } = await import("../src/graph/evolve.js");
const { runDreamer } = await import("../src/workers/dreamer.worker.js");
const { isRetrievable } = await import("../src/governance/policy.js");
const { findMemory, revisionsFor, closeDb, getDb } = await import("../src/storage/db.js");

const OWNER = "temporal-test-owner";

console.log(`\n⏳ PAME Temporal Memory Validity Suite`);
console.log(`Isolated DB: ${dbPath}\n`);

// ============================================================
// 1. Non-automatic interval population
// ============================================================
console.log("--- [NON-AUTOMATIC] New memories do not automatically populate validity intervals ---");

const createdFact = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Nimo stores knowledge in an associative graph",
  keywords: ["nimo", "graph"],
});

check(
  createdFact.validFrom === undefined,
  "[NON-AUTOMATIC] createMemory does not automatically populate validFrom",
  String(createdFact.validFrom),
);
check(
  createdFact.validUntil === undefined,
  "[NON-AUTOMATIC] createMemory does not automatically populate validUntil",
  String(createdFact.validUntil),
);

const rawCreatedRow = getDb()
  .prepare("SELECT valid_from, valid_until FROM memories WHERE id = ?")
  .get(createdFact.id) as { valid_from: number | null; valid_until: number | null };
check(
  rawCreatedRow.valid_from === null && rawCreatedRow.valid_until === null,
  "[NON-AUTOMATIC] database columns valid_from and valid_until are NULL for newly created memory",
  `valid_from=${rawCreatedRow.valid_from}, valid_until=${rawCreatedRow.valid_until}`,
);

const taughtLesson = memoryService.teach({
  ownerId: OWNER,
  type: "concept",
  content: "Associative memory retrieval uses reciprocal rank fusion",
  keywords: ["rrf", "fusion"],
});
check(
  taughtLesson.validFrom === undefined && taughtLesson.validUntil === undefined,
  "[NON-AUTOMATIC] teach does not automatically populate validity intervals",
);

const ingestRes = memoryService.remember({
  ownerId: OWNER,
  type: "message",
  content: "I prefer working in the terminal with Neovim",
});
check(ingestRes.created >= 1, "[NON-AUTOMATIC] remember created memory node from experience");
for (const id of ingestRes.memoryIds) {
  const node = findMemory(id, OWNER);
  check(
    node !== null && node.validFrom === undefined && node.validUntil === undefined,
    "[NON-AUTOMATIC] ingested memory has open validity intervals (validFrom/validUntil undefined)",
    `id=${id}`,
  );
}

// Normal update without supersession does not populate intervals
const updatedFact = memoryService.update(createdFact.id, OWNER, {
  summary: "Associative graph storage summary",
  importance: 0.9,
});
check(
  updatedFact.validFrom === undefined && updatedFact.validUntil === undefined,
  "[NON-AUTOMATIC] regular update does not populate validity intervals",
);

// Contradictory new evidence without explicit user correction preserves both and does NOT set validity
const factV1 = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Primary cluster runs PostgreSQL 15",
  keywords: ["postgresql", "cluster"],
  confidence: 0.8,
});
const factV2 = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Primary cluster runs PostgreSQL 16",
  keywords: ["postgresql", "cluster"],
  confidence: 0.85,
});
const evolveNewEvidence = evolve({
  ownerId: OWNER,
  memoryId: factV1.id,
  cause: "new_evidence",
  newEvidenceNode: factV2,
});
check(evolveNewEvidence.changed === true, "[NON-AUTOMATIC] new contradictory evidence triggers evolve update");
const factV1After = findMemory(factV1.id, OWNER)!;
const factV2After = findMemory(factV2.id, OWNER)!;
check(
  factV1After.status === "active" && factV1After.validUntil === undefined,
  "[NON-AUTOMATIC] contradictory new evidence does not set validUntil on target belief",
);
check(
  factV2After.validFrom === undefined,
  "[NON-AUTOMATIC] contradictory new evidence does not set validFrom on evidence belief",
);

// ============================================================
// 2. Deletion sets validity
// ============================================================
console.log("\n--- [DELETION] Deletion sets validUntil to close validity ---");

const toDelete = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Temporary token cache at /tmp/token_cache",
  keywords: ["token", "cache"],
});
check(isRetrievable(toDelete, OWNER) === true, "[DELETION] memory is retrievable before deletion");

memoryService.forget(toDelete.id, OWNER);

const rawDeletedRow = getDb()
  .prepare("SELECT status, valid_until FROM memories WHERE id = ?")
  .get(toDelete.id) as { status: string; valid_until: number | null };

check(
  rawDeletedRow.status === "deleted",
  "[DELETION] status is deleted after forget",
  rawDeletedRow.status,
);
check(
  typeof rawDeletedRow.valid_until === "number" && rawDeletedRow.valid_until <= Date.now(),
  "[DELETION] valid_until timestamp was set in database upon deletion",
  String(rawDeletedRow.valid_until),
);

const deletedNode = findMemory(toDelete.id, OWNER);
check(
  deletedNode !== null && deletedNode.validUntil instanceof Date,
  "[DELETION] findMemory returns validUntil as Date after deletion",
);
check(
  deletedNode !== null && isRetrievable(deletedNode, OWNER) === false,
  "[DELETION] deleted memory is no longer retrievable",
);

// ============================================================
// 3. Supersession sets validity
// ============================================================
console.log("\n--- [SUPERSESSION] Supersession sets validity intervals for both nodes ---");

// Part A: Explicit supersedes link
const supersededFact = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "API endpoint runs on port 3000",
  keywords: ["api", "port"],
});
const supersedingFact = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "API endpoint runs on port 8080",
  keywords: ["api", "port"],
});

check(
  supersededFact.validUntil === undefined && supersedingFact.validFrom === undefined,
  "[SUPERSESSION] neither memory has validity interval before linking",
);

memoryService.linkMemories(supersedingFact.id, supersededFact.id, OWNER, "supersedes", 0.95, 0.9);

const supersededAfter = findMemory(supersededFact.id, OWNER)!;
const supersedingAfter = findMemory(supersedingFact.id, OWNER)!;

check(
  supersededAfter.status === "superseded",
  "[SUPERSESSION] old memory status flipped to superseded",
  supersededAfter.status,
);
check(
  supersededAfter.supersededBy === supersedingFact.id,
  "[SUPERSESSION] old memory records supersededBy pointer",
  supersededAfter.supersededBy,
);
check(
  supersededAfter.validUntil instanceof Date && supersededAfter.validUntil.getTime() <= Date.now(),
  "[SUPERSESSION] old memory validity interval is closed (validUntil is set)",
  String(supersededAfter.validUntil?.toISOString()),
);
check(
  isRetrievable(supersededAfter, OWNER) === false,
  "[SUPERSESSION] superseded memory is not retrievable",
);

check(
  supersedingAfter.status === "active",
  "[SUPERSESSION] new memory remains active",
);
check(
  supersedingAfter.validFrom instanceof Date && supersedingAfter.validFrom.getTime() <= Date.now(),
  "[SUPERSESSION] new memory validity interval begins (validFrom is set)",
  String(supersedingAfter.validFrom?.toISOString()),
);
check(
  Array.isArray(supersedingAfter.supersedes) && supersedingAfter.supersedes.includes(supersededFact.id),
  "[SUPERSESSION] new memory records supersedes array containing old memory id",
  JSON.stringify(supersedingAfter.supersedes),
);
check(
  isRetrievable(supersedingAfter, OWNER) === true,
  "[SUPERSESSION] superseding memory is retrievable",
);

const supersessionRevs = revisionsFor(supersededFact.id, OWNER);
check(
  supersessionRevs.some((r) => r.reason === "supersession"),
  "[SUPERSESSION] revision recorded with reason 'supersession'",
);

// Part B: Dreamer duplicate consolidation
const dupA = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Development uses pnpm workspace package manager",
  keywords: ["pnpm", "workspace", "package"],
  confidence: 0.8,
});
const dupB = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Development uses pnpm workspace package manager",
  keywords: ["pnpm", "workspace", "package"],
  confidence: 0.8,
});

runDreamer(OWNER);

const dupAAfter = findMemory(dupA.id, OWNER)!;
const dupBAfter = findMemory(dupB.id, OWNER)!;
const oneSuperseded = (dupAAfter.status === "superseded" && dupBAfter.status === "active") ||
  (dupBAfter.status === "superseded" && dupAAfter.status === "active");
check(oneSuperseded, "[SUPERSESSION] dreamer duplicate merge marked one memory as superseded");

const mergedDuplicate = dupAAfter.status === "superseded" ? dupAAfter : dupBAfter;
const survivingMemory = dupAAfter.status === "active" ? dupAAfter : dupBAfter;
check(
  mergedDuplicate.validUntil instanceof Date,
  "[SUPERSESSION] dreamer duplicate merge sets validUntil on superseded duplicate",
  String(mergedDuplicate.validUntil?.toISOString()),
);
check(
  survivingMemory.validFrom instanceof Date,
  "[SUPERSESSION] dreamer duplicate merge sets validFrom on surviving memory",
  String(survivingMemory.validFrom?.toISOString()),
);
check(
  Array.isArray(survivingMemory.supersedes) && survivingMemory.supersedes.includes(mergedDuplicate.id),
  "[SUPERSESSION] surviving memory lists merged duplicate in supersedes",
);

// Part C: update with status 'superseded' automatically sets validUntil
const directSupersedeTarget = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Temporary server address is 10.0.0.1",
  keywords: ["server", "address"],
});
memoryService.update(directSupersedeTarget.id, OWNER, {
  status: "superseded",
  supersededBy: "new-server-id",
});
const directAfter = findMemory(directSupersedeTarget.id, OWNER)!;
check(
  directAfter.status === "superseded" && directAfter.validUntil instanceof Date,
  "[SUPERSESSION] update to status 'superseded' automatically sets validUntil",
  String(directAfter.validUntil?.toISOString()),
);

// ============================================================
// 4. Correction sets validity
// ============================================================
console.log("\n--- [CORRECT] Explicit human correction sets validity intervals ---");

const prefOld = memoryService.createMemory({
  ownerId: OWNER,
  type: "preference",
  content: "User prefers tabs over spaces",
  keywords: ["tabs", "spaces"],
  confidence: 0.9,
});
const prefNew = memoryService.createMemory({
  ownerId: OWNER,
  type: "preference",
  content: "User prefers spaces over tabs",
  keywords: ["spaces", "tabs"],
  confidence: 0.98,
});

check(
  prefOld.validUntil === undefined && prefNew.validFrom === undefined,
  "[CORRECT] neither preference has validity interval before correction",
);

const corrResult = evolve({
  ownerId: OWNER,
  memoryId: prefOld.id,
  cause: "user_correction",
  newEvidenceNode: prefNew,
});
check(corrResult.changed === true, "[CORRECT] user_correction evolution completed");

const prefOldAfter = findMemory(prefOld.id, OWNER)!;
const prefNewAfter = findMemory(prefNew.id, OWNER)!;

check(
  prefOldAfter.confidence === 0.1,
  "[CORRECT] corrected memory confidence dropped to 0.1",
  String(prefOldAfter.confidence),
);
check(
  prefOldAfter.validUntil instanceof Date && prefOldAfter.validUntil.getTime() <= Date.now(),
  "[CORRECT] corrected memory validity interval closed (validUntil is set)",
  String(prefOldAfter.validUntil?.toISOString()),
);
check(
  prefNewAfter.validFrom instanceof Date && prefNewAfter.validFrom.getTime() <= Date.now(),
  "[CORRECT] correcting evidence validity interval started (validFrom is set)",
  String(prefNewAfter.validFrom?.toISOString()),
);
check(
  isRetrievable(prefOldAfter, OWNER) === false,
  "[CORRECT] corrected memory with expired validUntil is not retrievable",
);
check(
  isRetrievable(prefNewAfter, OWNER) === true,
  "[CORRECT] correcting memory is retrievable",
);

const corrRevs = revisionsFor(prefOld.id, OWNER);
check(
  corrRevs.some((r) => r.reason === "user_correction"),
  "[CORRECT] revision recorded with reason 'user_correction'",
);

// ============================================================
// 5. Validity-aware retrieval filtering
// ============================================================
console.log("\n--- [RETRIEVAL-FILTER] Retrieval correctly enforces valid-time intervals ---");

const activeFact = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Baseline active fact with open validity",
});
check(isRetrievable(activeFact, OWNER) === true, "[RETRIEVAL-FILTER] open-interval memory is retrievable");

const pastExpiredNode = {
  ...activeFact,
  validUntil: new Date(Date.now() - 60_000), // expired 1 minute ago
};
check(
  isRetrievable(pastExpiredNode, OWNER) === false,
  "[RETRIEVAL-FILTER] memory with past validUntil is not retrievable even if status is active",
);

const futureNode = {
  ...activeFact,
  validFrom: new Date(Date.now() + 60_000), // starts 1 minute in the future
};
check(
  isRetrievable(futureNode, OWNER) === false,
  "[RETRIEVAL-FILTER] memory with future validFrom is not retrievable yet",
);

const validWindowNode = {
  ...activeFact,
  validFrom: new Date(Date.now() - 60_000), // started 1 min ago
  validUntil: new Date(Date.now() + 60_000), // ends 1 min in future
};
check(
  isRetrievable(validWindowNode, OWNER) === true,
  "[RETRIEVAL-FILTER] memory inside its valid-time interval is retrievable",
);

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`TEMPORAL VALIDITY RESULT: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(60)}`);

try {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
} catch (err) {
  console.warn("Cleanup warning:", err);
}

process.exit(failed > 0 ? 1 : 0);
