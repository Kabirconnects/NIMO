/**
 * Policy settings test verifying:
 * - maxEvidenceAgeDays filter in isRetrievable
 * - maxMemoryConfidenceForAutoActivation filter in activate
 * - allowAutomaticEvolution check in evolve
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-policy-settings-"));
const dbPath = path.join(tmpDir, "pame.db");
process.env.PAME_DB_PATH = dbPath;

const { memoryService } = await import("../src/service.js");
const { setPolicy, getPolicy, insertEdge } = await import("../src/storage/db.js");
const { isRetrievable } = await import("../src/governance/policy.js");
const { activate } = await import("../src/retrieval/activate.js");
const { evolve } = await import("../src/graph/evolve.js");

console.log(`\n🔒 Policy Settings Test`);
console.log(`Isolated DB: ${dbPath}\n`);

const OWNER = "test-owner";

// 1. Evidence age test
setPolicy(OWNER, { maxEvidenceAgeDays: 5 });
const now = Date.now();
const recentDate = new Date(now - 2 * 24 * 60 * 60 * 1000); // 2 days ago
const oldDate = new Date(now - 10 * 24 * 60 * 60 * 1000); // 10 days ago

const memRecent = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Recent evidence memory",
  evidence: [{ experienceId: "exp-1", observedAt: recentDate, kind: "observed", quote: "recent" }],
});

const memOld = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Old evidence memory",
  evidence: [{ experienceId: "exp-2", observedAt: oldDate, kind: "observed", quote: "old" }],
});

const p5 = getPolicy(OWNER);
check(isRetrievable(memRecent, OWNER, p5) === true, "[EVIDENCE AGE] memory with recent evidence is retrievable");
check(isRetrievable(memOld, OWNER, p5) === false, "[EVIDENCE AGE] memory with evidence older than maxEvidenceAgeDays is NOT retrievable");

// Owner with no limits.
//
// The comparison has to be the SAME age of evidence, not the same node: a node
// belongs to one owner, and `isRetrievable` refuses a node to every other owner
// before it ever looks at the policy. Asserting that the owner-scoped node is
// retrievable for a second owner fails by construction, and "fixing" it by
// removing the owner check would open every memory to every owner.
const OWNER_NOLIMIT = "owner-nolimit";
const pNoLimit = getPolicy(OWNER_NOLIMIT);
const memOldNoLimit = memoryService.createMemory({
  ownerId: OWNER_NOLIMIT,
  type: "fact",
  content: "Old evidence memory, no limit",
  evidence: [{ experienceId: "exp-3", observedAt: oldDate, kind: "observed", quote: "old" }],
});
check(isRetrievable(memOldNoLimit, OWNER_NOLIMIT, pNoLimit) === true, "[EVIDENCE AGE] old evidence memory is retrievable for owner with no limits");
check(isRetrievable(memOld, OWNER_NOLIMIT, pNoLimit) === false, "[EVIDENCE AGE] a memory is never retrievable for an owner who does not own it");


// 2. Confidence floor - auto activation test
setPolicy(OWNER, { maxMemoryConfidenceForAutoActivation: 0.6 });
const seedNode = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Seed query match",
  confidence: 0.9,
});

const lowConfPeer = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "Low confidence neighbor",
  confidence: 0.4,
});

const highConfPeer = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "High confidence neighbor",
  confidence: 0.8,
});

insertEdge({
  ownerId: OWNER,
  fromMemoryId: seedNode.id,
  toMemoryId: lowConfPeer.id,
  relation: "enables",
  confidence: 0.9,
  weight: 0.9,
  evidenceIds: [],
});

insertEdge({
  ownerId: OWNER,
  fromMemoryId: seedNode.id,
  toMemoryId: highConfPeer.id,
  relation: "enables",
  confidence: 0.9,
  weight: 0.9,
  evidenceIds: [],
});

const activated = activate(OWNER, [{ memory: seedNode, score: 0.9, matchedBy: ["keyword"], relatedMemoryIds: [], evidence: [] }]);
const activatedIds = activated.map((a) => a.memory.id);

check(!activatedIds.includes(lowConfPeer.id), "[AUTO ACTIVATION] neighbour below confidence floor is not activated");
check(activatedIds.includes(highConfPeer.id), "[AUTO ACTIVATION] neighbour above confidence floor is activated");


// 3. Automatic evolution test
//
// The pair has to be one the conflict classifier calls a contradiction. Two
// memories that merely differ ("Original belief" vs "Contradictory new
// evidence") are classified `unrelated`, and a bare negation flip on otherwise
// identical text is classified `duplicate` (it scores >= 0.92 similarity before
// the polarity check runs) - in both cases `evolve` returns `changed: false` on
// the old code too, and the assertion would pass without the policy having any
// effect. A numeric conflict on the same subject is a real contradiction: the
// old code evolves, the policy-aware code refuses.
setPolicy(OWNER, { allowAutomaticEvolution: false });
const targetMem = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "the deploy timeout is 30 seconds",
  confidence: 0.8,
});

const newEvidenceMem = memoryService.createMemory({
  ownerId: OWNER,
  type: "fact",
  content: "the deploy timeout is 60 seconds",
  confidence: 0.8,
});

const resAuto = evolve({
  ownerId: OWNER,
  memoryId: targetMem.id,
  cause: "new_evidence",
  newEvidenceNode: newEvidenceMem,
});
check(resAuto.changed === false, "[EVOLUTION] evolve with cause 'new_evidence' changes nothing when allowAutomaticEvolution is false");

// The same contradiction, for an owner who allows it, must change. Without
// this pair the assertion above could pass because the two memories were
// never a conflict in the first place.
setPolicy(OWNER, { allowAutomaticEvolution: true });
const resAllowed = evolve({
  ownerId: OWNER,
  memoryId: targetMem.id,
  cause: "new_evidence",
  newEvidenceNode: newEvidenceMem,
});
check(resAllowed.changed === true, "[EVOLUTION] the same contradiction does change when the owner allows automatic evolution");

// Back to the restrictive policy: `user_correction` is the one path that must
// keep working regardless, because a human explicitly asked for it.
setPolicy(OWNER, { allowAutomaticEvolution: false });
const resUser = evolve({
  ownerId: OWNER,
  memoryId: targetMem.id,
  cause: "user_correction",
  newEvidenceNode: newEvidenceMem,
});
check(resUser.changed === true, "[EVOLUTION] evolve with cause 'user_correction' still works even when automatic evolution is off");

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
