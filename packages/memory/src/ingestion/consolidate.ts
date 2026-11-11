// ingestion/consolidate.ts
// Turn validated candidates into neurons: create new ones, merge duplicates,
// and create synapses between related neurons.
//
// No LLM — merging is HATE-based (shared keywords + same type + semantic
// keyword overlap). Dedupe key: contentHash — identical content reuses the
// existing neuron and appends evidence instead of duplicating.

import type { MemoryCandidate, MemoryNode, MemoryType, MemoryEvidence } from "../domain/memory.types.js";
import type { MemoryRelation } from "../domain/memory-edge.types.js";
import {
  insertMemory,
  insertEdge,
  updateMemory,
  insertRevision,
  recordAudit,
  listActiveMemories,
} from "../storage/db.js";
import { assessConflict, type ConflictAssessment } from "../graph/conflict.js";

export interface ConsolidationResult {
  created: number;
  updated: number;
  merged: number;
  linked: number;
  memoryIds: string[];
}

/** Find an active memory that semantically duplicates this candidate.
 *  Contradictory candidates are NEVER merged — they are kept as separate
 *  memories and linked with a `contradicts` edge. */
function findDuplicate(cand: MemoryCandidate, active: MemoryNode[]): MemoryNode | null {
  const candKey = cand.content.toLowerCase().replace(/\s+/g, " ").trim();
  for (const n of active) {
    const nKey = n.content.toLowerCase().replace(/\s+/g, " ").trim();
    const exactish =
      nKey === candKey ||
      (nKey.length >= 12 &&
        candKey.length >= 12 &&
        (nKey.includes(candKey) || candKey.includes(nKey)));
    if (!exactish) continue;
    const assessment = assessConflict(n, cand);
    if (assessment.kind === "duplicate" || assessment.kind === "compatible") {
      return n;
    }
  }
  // Keyword overlap fallback: same type, high overlap, but only when the
  // conflict classifier says the pair is actually the same belief.
  const keySet = new Set(cand.keywords);
  let best: MemoryNode | null = null;
  let bestRatio = 0;
  for (const n of active) {
    if (n.type !== cand.type) continue;
    if (n.content.length < 20) continue;
    const union = new Set([...keySet, ...n.keywords]);
    if (union.size === 0) continue;
    const inter = [...keySet].filter((k) => n.keywords.includes(k)).length;
    const ratio = inter / union.size;
    if (ratio <= bestRatio || ratio < 0.4) continue;
    const assessment = assessConflict(n, cand);
    if (assessment.kind !== "duplicate" && assessment.kind !== "compatible") continue;
    bestRatio = ratio;
    best = n;
  }
  return best;
}

export function consolidate(
  ownerId: string,
  candidates: MemoryCandidate[],
  experienceId: string,
): ConsolidationResult {
  const result: ConsolidationResult = { created: 0, updated: 0, merged: 0, linked: 0, memoryIds: [] };
  if (candidates.length === 0) return result;

  const active = listActiveMemories(ownerId, { limit: 200 });
  const createdNodes: MemoryNode[] = [];

  for (const cand of candidates) {
    const evidence: MemoryEvidence = {
      experienceId,
      kind: cand.evidence.kind,
      quote: cand.evidence.quote,
      observedAt: new Date(),
    };

    const dup = findDuplicate(cand, active);
    if (dup) {
      // Merge: append evidence, union keywords. Confidence is deliberately
      // NOT increased — repeating the same belief is not new evidence.
      const mergedEvidence = [...dup.evidence, evidence];
      updateMemory(dup.id, ownerId, {
        evidence: mergedEvidence,
        confidence: dup.confidence,
        importance: Math.max(dup.importance, cand.importance),
        keywords: [...new Set([...dup.keywords, ...cand.keywords])],
        concepts: [...new Set([...dup.concepts, ...cand.concepts])],
      });
      insertRevision({
        memoryId: dup.id,
        ownerId,
        previousContent: dup.content,
        newContent: cand.content,
        reason: "consolidation",
        evidenceIds: [experienceId],
      });
      result.merged++;
      result.memoryIds.push(dup.id);
      continue;
    }

    const node = insertMemory({
      ownerId,
      type: cand.type,
      status: "active",
      visibility: "private",
      content: cand.content,
      summary: cand.summary,
      concepts: cand.concepts,
      keywords: cand.keywords,
      tags: cand.tags,
      entities: cand.entities,
      confidence: cand.confidence,
      importance: cand.importance,
      retentionClass: cand.retentionClass,
      evidence: [evidence],
      supersedes: [],
    });
    active.push(node);
    createdNodes.push(node);
    result.created++;
    result.memoryIds.push(node.id);
    recordAudit({
      ownerId,
      actor: "agent",
      action: "create",
      targetId: node.id,
      reason: `consolidated ${node.type}`,
    });
  }

  // Associate: contradictions become explicit `contradicts` edges; otherwise
  // link new neurons to related existing ones by keyword overlap.
  for (const node of createdNodes) {
    const candidatesForLink = active.filter((a) => a.id !== node.id && a.status === "active");

    let conflictWith: { other: MemoryNode; assessment: ConflictAssessment } | null = null;
    for (const other of candidatesForLink) {
      const assessment = assessConflict(other, node);
      if (assessment.kind !== "contradiction" && assessment.kind !== "correction") continue;
      if (!conflictWith || assessment.contradictionScore > conflictWith.assessment.contradictionScore) {
        conflictWith = { other, assessment };
      }
    }
    if (conflictWith) {
      insertEdge({
        ownerId,
        fromMemoryId: node.id,
        toMemoryId: conflictWith.other.id,
        relation: "contradicts",
        confidence: conflictWith.assessment.contradictionScore,
        weight: conflictWith.assessment.contradictionScore,
        evidenceIds: [experienceId],
      });
      result.linked++;
      recordAudit({
        ownerId,
        actor: "agent",
        action: "link",
        targetId: node.id,
        reason: `contradicts ${conflictWith.other.id}: ${conflictWith.assessment.reason}`,
      });
      continue;
    }

    let bestLink: MemoryNode | null = null;
    let bestScore = 0;
    for (const other of candidatesForLink) {
      const score = keywordOverlap(node.keywords, other.keywords);
      // Boost for same-type or causally related pairs.
      const boosted = score + (node.type === other.type ? 0.1 : 0);
      if (boosted > bestScore && boosted > 0.15) { bestScore = boosted; bestLink = other; }
    }
    if (bestLink) {
      const relation = chooseRelation(node, bestLink);
      insertEdge({
        ownerId,
        fromMemoryId: node.id,
        toMemoryId: bestLink.id,
        relation,
        confidence: Math.min(1, bestScore + 0.3),
        weight: Math.min(1, bestScore + 0.2),
        evidenceIds: [experienceId],
      });
      result.linked++;

      // Bidirectional weak link so activation can also travel back.
      if (relation !== "supersedes" && relation !== "contradicts") {
        insertEdge({
          ownerId,
          fromMemoryId: bestLink.id,
          toMemoryId: node.id,
          relation: "related_to",
          confidence: Math.min(1, bestScore + 0.2),
          weight: Math.min(1, bestScore + 0.1),
          evidenceIds: [experienceId],
        });
        result.linked++;
      }
    }
  }

  return result;
}

function keywordOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  const inter = [...setA].filter((x) => setB.has(x)).length;
  return inter / Math.max(1, union.size);
}

function chooseRelation(from: MemoryNode, to: MemoryNode): MemoryRelation {
  const fromKw = new Set(from.keywords);
  const toKw = new Set(to.keywords);
  // Default: related_to. Link the NEW node -> OLD node with the most
  // specific relation we can justify.
  if (from.type === "decision" && to.type === "fact") return "depends_on";
  if (from.type === "event" && to.type === "decision") return "derived_from";
  if (from.type === "concept" && (to.type === "fact" || to.type === "decision")) return "supports";
  if (from.type === "observation" && to.type === "event") return "derived_from";
  return "related_to";
}
