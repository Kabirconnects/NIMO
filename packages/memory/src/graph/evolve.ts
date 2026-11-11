// graph/evolve.ts
// Memory evolution — re-evaluate a memory when new evidence arrives, the user
// corrects it, or consolidation runs.
//
// Correctness rules (see graph/conflict.ts for the classifier):
//   - similarity is not contradiction; shared words can be compatible
//   - contradictory evidence preserves BOTH memories and records a
//     `contradicts` edge. It does not silently delete the old belief.
//   - supersession requires an explicit correction / verified evidence, so
//     plain "new evidence" and background consolidation never supersede.
//   - repetition never raises confidence.

import type { MemoryNode } from "../domain/memory.types.js";
import type { MemoryEdge } from "../domain/memory-edge.types.js";
import {
  findMemory,
  updateMemory,
  edgesFrom,
  insertEdge,
  insertRevision,
  recordAudit,
} from "../storage/db.js";
import { assessConflict, contradictionScore as scoreConflict } from "./conflict.js";

/**
 * Input to evolve() — triggers re-evaluation of a memory when new evidence
 * arrives, the user corrects it, or consolidation runs.
 */
export interface EvolutionInput {
  ownerId: string;
  memoryId: string;
  /** kind of new evidence driving the re-evaluation */
  cause: "new_evidence" | "user_correction" | "consolidation";
  /** Optional new evidence node being evaluated against target */
  newEvidenceNode?: MemoryNode;
}

/**
 * Output from evolve() — whether the memory was changed, and if so, what the
 * new state looks like.
 */
export interface EvolutionOutput {
  changed: boolean;
  /** The revised confidence, if it was updated */
  newConfidence?: number;
  /** A revised memory node, if content/beliefs were updated */
  revisedMemory?: MemoryNode;
  /** Optional: a new edge expressing the contradiction/supersession */
  newEdge?: MemoryEdge;
}

/**
 * Computes a contradiction score between two memories.
 * Score is 0 (no conflict) to 1 (direct contradiction/correction).
 * Similarity alone returns 0.
 */
export function contradictionScore(a: MemoryNode, b: MemoryNode): number {
  return scoreConflict(a, b);
}

export function evolve(input: EvolutionInput): EvolutionOutput {
  const { ownerId, memoryId, cause, newEvidenceNode } = input;

  const target = findMemory(memoryId, ownerId);
  if (!target) {
    return { changed: false };
  }

  let newEvidence = newEvidenceNode;
  if (!newEvidence) {
    if (cause === "consolidation") {
      const relatedEdges = edgesFrom(memoryId, ownerId);
      const relatedMemories: MemoryNode[] = [];
      for (const edge of relatedEdges) {
        const related = findMemory(edge.toMemoryId, ownerId);
        if (related && related.status === "active" && related.id !== memoryId) {
          relatedMemories.push(related);
        }
      }
      if (relatedMemories.length > 0) {
        relatedMemories.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        newEvidence = relatedMemories[0];
      }
    }
    if (!newEvidence) {
      return { changed: false };
    }
  }

  if (newEvidence.id === target.id) {
    return { changed: false };
  }

  const assessment = assessConflict(target, newEvidence);
  const isConflict =
    assessment.kind === "contradiction" || assessment.kind === "correction";

  // Explicit human correction: the only path that may override the old belief.
  if (cause === "user_correction") {
    const updated = updateMemory(memoryId, ownerId, { confidence: 0.1 });
    insertRevision({
      memoryId,
      ownerId,
      previousContent: target.content,
      newContent: updated!.content,
      reason: "user_correction",
      evidenceIds: (updated?.evidence ?? []).map((e) => e.experienceId),
    });
    recordAudit({
      ownerId,
      actor: "user",
      action: "update",
      targetId: memoryId,
      reason: `corrected ${target.type} per user instruction`,
    });
    const edge = insertEdge({
      ownerId,
      fromMemoryId: memoryId,
      toMemoryId: newEvidence.id,
      relation: "contradicts",
      confidence: 0.95,
      weight: 0.9,
      evidenceIds: [],
    });
    return {
      changed: true,
      newConfidence: 0.1,
      revisedMemory: updated ?? undefined,
      newEdge: edge,
    };
  }

  if (!isConflict) {
    // Compatible, duplicate, or unrelated evidence: preserve both, change
    // nothing. Repetition must never inflate confidence.
    return { changed: false };
  }

  // Contradiction. Preserve both memories; record the conflict explicitly.
  const learningRate = cause === "consolidation" ? 0.1 : 0.2;
  const blended =
    target.confidence * (1 - learningRate) +
    Math.min(newEvidence.confidence, target.confidence) * learningRate;
  // Never increase on contradiction/consolidation.
  const nextConfidence = Math.min(target.confidence, Math.max(0, blended));

  const updated =
    nextConfidence !== target.confidence
      ? updateMemory(memoryId, ownerId, { confidence: nextConfidence })
      : target;

  insertRevision({
    memoryId,
    ownerId,
    previousContent: target.content,
    newContent: target.content,
    reason: cause === "consolidation" ? "consolidation" : "new_evidence",
    evidenceIds: (newEvidence.evidence ?? []).map((e) => e.experienceId),
  });

  const edge = insertEdge({
    ownerId,
    fromMemoryId: newEvidence.id,
    toMemoryId: memoryId,
    relation: "contradicts",
    confidence: assessment.contradictionScore,
    weight: assessment.contradictionScore,
    evidenceIds: [],
  });

  recordAudit({
    ownerId,
    actor: "agent",
    action: "update",
    targetId: memoryId,
    reason: `${assessment.kind} detected (${assessment.reason}); both memories preserved`,
  });

  return {
    changed: true,
    newConfidence: nextConfidence,
    revisedMemory: updated ?? undefined,
    newEdge: edge,
  };
}
