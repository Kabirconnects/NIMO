/**
 * Retrieval filter (isRetrievable) test for owner, status, and policy parameter.
 *
 * Verifies that:
 * 1. A node belonging to another owner is not retrievable even when its visibility is "workspace" or "shared".
 * 2. An "active" node of the owner is retrievable.
 * 3. A "candidate" and an "archived" node of the owner are not retrievable.
 * 4. isRetrievable accepts the policy parameter (even if unused or used).
 */

const pass = (name: string, detail = "") => console.log(`PASS ${name}${detail ? "  " + detail : ""}`);
const fail = (name: string, detail = "") => console.log(`FAIL ${name}${detail ? "  " + detail : ""}`);

let passed = 0, failed = 0;
function check(cond: boolean, name: string, detail = "") {
  if (cond) { passed++; pass(name, detail); } else { failed++; fail(name, detail); }
}

const { isRetrievable, DEFAULT_POLICY } = await import("../src/governance/policy.js");
import type { MemoryNode } from "../src/domain/memory.types.js";

console.log(`\n🔍 isRetrievable Retrieval Filter Test\n`);

const ownerA = "owner-a";
const ownerB = "owner-b";

// Base node helper
function makeNode(overrides: Partial<MemoryNode>): MemoryNode {
  return {
    id: "mem-test-1",
    ownerId: ownerA,
    type: "fact",
    content: "Test memory",
    visibility: "private",
    status: "active",
    confidence: 0.9,
    importance: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    evidence: [],
    ...overrides,
  } as MemoryNode;
}

// 1. Owner check: node belonging to another owner is not retrievable even when visibility is "workspace" or "shared"
const nodeOtherPrivate = makeNode({ ownerId: ownerB, visibility: "private" });
check(isRetrievable(nodeOtherPrivate, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] other owner private node is not retrievable");

const nodeOtherWorkspace = makeNode({ ownerId: ownerB, visibility: "workspace" });
check(isRetrievable(nodeOtherWorkspace, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] other owner workspace node is not retrievable");

const nodeOtherShared = makeNode({ ownerId: ownerB, visibility: "shared" });
check(isRetrievable(nodeOtherShared, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] other owner shared node is not retrievable");

// 2. Active node of owner is retrievable
const nodeActiveOwner = makeNode({ ownerId: ownerA, status: "active" });
check(isRetrievable(nodeActiveOwner, ownerA, DEFAULT_POLICY) === true, "[RETRIEVAL] owner active node is retrievable");

// 3. Candidate and archived nodes of owner are not retrievable
const nodeCandidateOwner = makeNode({ ownerId: ownerA, status: "candidate" });
check(isRetrievable(nodeCandidateOwner, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] owner candidate node is not retrievable");

const nodeArchivedOwner = makeNode({ ownerId: ownerA, status: "archived" });
check(isRetrievable(nodeArchivedOwner, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] owner archived node is not retrievable");

const nodeDeletedOwner = makeNode({ ownerId: ownerA, status: "deleted" });
check(isRetrievable(nodeDeletedOwner, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] owner deleted node is not retrievable");

const nodeSupersededOwner = makeNode({ ownerId: ownerA, status: "superseded" });
check(isRetrievable(nodeSupersededOwner, ownerA, DEFAULT_POLICY) === false, "[RETRIEVAL] owner superseded node is not retrievable");

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
