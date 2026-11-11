/**
 * Evolution Test — PAME Stage 5 (src/graph/evolve.ts)
 *
 * Focused end-to-end coverage of contradiction detection, supersession,
 * confidence blending, revision history, and audit recording.
 * Runs against an isolated temp DB, never touches production.
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

// Isolated data dir — must be set before importing anything that touches the DB.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-evolve-test-"));
process.env.PAME_DATA_DIR = tmpDir;

const { memoryService } = await import("../src/service.js");
const { evolve, contradictionScore } = await import("../src/graph/evolve.js");
const { findMemory, revisionsFor, edgesFrom, getDb, listActiveMemories } = await import("../src/storage/db.js");

const OWNER = "evolve-test-owner";

console.log(`\n🧠 PAME Evolution Test`);
console.log(`Isolated DB: ${tmpDir}\n`);

// --- Contradiction scoring ---
console.log("--- [CONTRADICTION] Score computation ---");
const stableA = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "x uses mongodb", keywords: ["mongodb"] });
const stableB = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "x uses postgres", keywords: ["postgres"] });
// Manually set retentionClass to stable for test
const { updateMemory } = await import("../src/storage/db.js");
updateMemory(stableA.id, OWNER, { retentionClass: "stable" });
updateMemory(stableB.id, OWNER, { retentionClass: "stable" });
const updatedStableA = findMemory(stableA.id, OWNER)!;
const updatedStableB = findMemory(stableB.id, OWNER)!;
// Retention class is about decay, not truth: two stable facts that name
// incompatible values still contradict each other.
check(
  contradictionScore(updatedStableA, updatedStableB) >= 0.5,
  "stable facts with incompatible values still contradict",
  String(contradictionScore(updatedStableA, updatedStableB)),
);

const factA = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "we use mongodb", keywords: ["mongodb", "we"] });
const factB = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "we use postgres", keywords: ["postgres", "we"] });
check(
  contradictionScore(factA, factB) >= 0.5,
  "fact vs fact same value slot scores >= 0.5",
  String(contradictionScore(factA, factB)),
);

// --- Evolution: new_evidence preserves both sides and records the conflict ---
console.log("\n--- [CONFLICT] New contradictory evidence preserves both beliefs ---");
const oldDecision = memoryService.createMemory({
  ownerId: OWNER,
  type: "decision",
  content: "we decided to use PostgreSQL for the primary database",
  keywords: ["postgresql", "database"],
  confidence: 0.4,
});
const newDecision = memoryService.createMemory({
  ownerId: OWNER,
  type: "decision",
  content: "we decided to use MongoDB for the primary database",
  keywords: ["mongodb", "database"],
  confidence: 0.95,
});

console.log("OLD DECISION ID:", oldDecision.id, "conf:", oldDecision.confidence);
console.log("NEW DECISION ID:", newDecision.id, "conf:", newDecision.confidence);
console.log("SCORE:", contradictionScore(oldDecision, newDecision));

const supersedeOut = evolve({
  ownerId: OWNER,
  memoryId: oldDecision.id,
  cause: "new_evidence",
  newEvidenceNode: newDecision,
});
check(supersedeOut.changed === true, "contradictory new evidence is recorded (changed=true)");

const oldAfter = findMemory(oldDecision.id, OWNER);
check(oldAfter?.status === "active", "new evidence alone never supersedes the old belief");
check(oldAfter?.supersededBy === undefined, "old decision has no supersededBy link");
check(
  (oldAfter?.confidence ?? 1) <= oldDecision.confidence,
  "contradiction never raises confidence",
  `${oldAfter?.confidence}`,
);

const revisions = revisionsFor(oldDecision.id, OWNER);
check(
  revisions.some((r) => r.reason === "new_evidence"),
  "evidence revision recorded",
  `reasons=${revisions.map((r) => r.reason).join(",")}`,
);

const edges = edgesFrom(newDecision.id, OWNER);
check(edges.some((e) => e.relation === "contradicts" && e.toMemoryId === oldDecision.id), "contradicts edge created from new → old");
check(!edges.some((e) => e.relation === "supersedes"), "no unsupported supersedes edge");

// --- Evolution: consolidation keeps higher-confidence fact active ---
console.log("\n--- [RETAIN] Consolidation blends confidence without status change ---");
const strong = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "The memory engine stores neurons in SQLite",
  keywords: ["memory", "engine", "sqlite"],
  confidence: 0.8,
});
const weak = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "The memory engine stores neurons in flat files",
  keywords: ["memory", "engine", "flat files"],
  confidence: 0.3,
});

const retainOut = evolve({
  ownerId: OWNER,
  memoryId: strong.id,
  cause: "consolidation",
  newEvidenceNode: weak,
});
check(retainOut.changed === true, "retain path updates confidence");
const expectedBlend = 0.8 * 0.9 + 0.3 * 0.1;
check(
  Math.abs((retainOut.newConfidence ?? -1) - expectedBlend) < 0.01,
  "confidence blends 90/10",
  `blend=${retainOut.newConfidence?.toFixed(3)} expected≈${expectedBlend.toFixed(3)}`,
);
const strongAfter = findMemory(strong.id, OWNER);
check(strongAfter?.status === "active", "retained memory stays active");
const retainEdges = edgesFrom(weak.id, OWNER);
check(
  retainEdges.some((e) => e.relation === "contradicts" && e.toMemoryId === strong.id),
  "consolidation records a contradicts edge instead of merging",
);

// --- Evolution: user_correction sharply lowers confidence ---
console.log("\n--- [CORRECT] Explicit user correction ---");
const target = memoryService.createMemory({
  ownerId: OWNER,
  type: "preference",
  content: "User prefers tabs over spaces",
  keywords: ["tabs", "spaces"],
  confidence: 0.9,
});
const correction = memoryService.createMemory({
  ownerId: OWNER,
  type: "preference",
  content: "User prefers spaces over tabs",
  keywords: ["spaces", "tabs"],
  confidence: 0.99,
});

const corrOut = evolve({
  ownerId: OWNER,
  memoryId: target.id,
  cause: "user_correction",
  newEvidenceNode: correction,
});
check(corrOut.changed === true, "user_correction path marks changed");
const corrAfter = findMemory(target.id, OWNER);
check(corrAfter?.confidence === 0.1, "corrected memory confidence dropped to 0.1");
const corrRevisions = revisionsFor(target.id, OWNER);
check(corrRevisions.some((r) => r.reason === "user_correction"), "user_correction revision recorded");

// --- Evolution: unrelated evidence does nothing ---
console.log("\n--- [NOOP] Unrelated evidence leaves memory untouched ---");
const noopTarget = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Nimo uses SQLite",
  keywords: ["nimo", "sqlite"],
  confidence: 0.75,
});
const unrelated = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "The weather is nice today",
  keywords: ["weather"],
  confidence: 0.9,
});
const noopOut = evolve({
  ownerId: OWNER,
  memoryId: noopTarget.id,
  cause: "new_evidence",
  newEvidenceNode: unrelated,
});
check(noopOut.changed === false, "unrelated evidence does not supersede");
const noopAfter = findMemory(noopTarget.id, OWNER);
check(noopAfter?.confidence === 0.75, "unrelated evidence leaves confidence unchanged");

// --- Evolution: consolidation with no related memories is a no-op ---
console.log("\n--- [NOOP] Consolidation with no related memories ---");
const solo = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Solo fact with no edges",
  keywords: ["solo"],
  confidence: 0.6,
});
const soloOut = evolve({
  ownerId: OWNER,
  memoryId: solo.id,
  cause: "consolidation",
});
check(soloOut.changed === false, "consolidation without related memories is a no-op");

// --- Missing memory id ---
console.log("\n--- [NOOP] Unknown memory id ---");
const missing = evolve({ ownerId: OWNER, memoryId: "does-not-exist", cause: "new_evidence" });
check(missing.changed === false, "unknown memory id returns changed:false");

console.log(`\n${"=".repeat(60)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(60)}`);

// Cleanup temp DB.
try {
  getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

process.exit(failed > 0 ? 1 : 0);
